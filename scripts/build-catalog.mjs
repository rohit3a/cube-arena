#!/usr/bin/env node
// Builds data/catalog.json: the models Cube Arena can run, with the exact
// name used on the boards and every way to reach each one.
//
//   node scripts/build-catalog.mjs
//
// Sources: data/aa-models.json (Artificial Analysis's model list, refreshed by
// hand), OpenRouter's public model list (fetched), and the Claude Code and
// Codex model ids in runner/models.mjs. A model is in the catalog when it can
// read images and call tools somewhere we can run it. "wanted" marks the ones
// Artificial Analysis lists as current: those are what we ask people to run.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_EFFORT_LIMITS, EFFORTS, SWEEP_MODELS, claudeName, codexModels, codexName, effortsOf } from '../runner/models.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const aa = JSON.parse(readFileSync(join(root, 'data/aa-models.json'), 'utf8')).models;
const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) throw new Error(`OpenRouter: ${res.status}`);
const openrouter = (await res.json()).data.filter((m) => !m.id.includes(':') && !m.id.startsWith('~'));
const codex = codexModels(join(homedir(), '.codex-bench'));

// Artificial Analysis name → OpenRouter id, where the names differ. Checked by hand.
const ALIASES = {
  'Nova 2.0 Lite': 'amazon/nova-2-lite-v1',
  'Nova Premier': 'amazon/nova-premier-v1',
  'Ministral 3 14B': 'mistralai/ministral-14b-2512',
  'Ministral 3 8B': 'mistralai/ministral-8b-2512',
  'Ministral 3 3B': 'mistralai/ministral-3b-2512',
  'Mistral Large 4 Preview': 'mistralai/mistral-large-4-0',
  'Muse Glimmer': 'meta/muse-glimmer-30b',
  'DeepSeek V4 Flash Vision': 'deepseek/deepseek-v4-flash-vision-exp',
};

const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9.+]+/g, ' ').trim();
const byName = new Map(openrouter.map((m) => [norm(m.name.split(': ').slice(1).join(': ') || m.name), m]));
const byId = new Map(openrouter.map((m) => [m.id, m]));
const usable = (m) => m && m.architecture.input_modalities.includes('image') && m.supported_parameters.includes('tools');
const orEfforts = (m) => EFFORTS.filter((e) => m?.reasoning?.supported_efforts?.includes(e));
const perMillion = (v) => (v === undefined || v === null ? null : Math.round(Number(v) * 1e6 * 1000) / 1000);
const slugOf = (name) => name.toLowerCase().replace(/\+/g, '-plus').replace(/[^a-z0-9.]+/g, '-').replace(/\./g, '-').replace(/^-|-$/g, '');

// Claude Code ids from Artificial Analysis names: "Claude Opus 5.5" → claude-opus-5-5.
const claudeId = (name) => {
  const m = name.match(/^Claude (Opus|Sonnet|Haiku|Fable) (\d+)(?:\.(\d+))?$/);
  return m ? `claude-${m[1].toLowerCase()}-${m[2]}${m[3] ? `-${m[3]}` : ''}` : null;
};
// Codex ids: "GPT-6.1 Sol" → gpt-6.1-sol, when Codex lists it.
const codexId = (name) => {
  const id = name.toLowerCase().replace(/\s+/g, '-');
  return codex?.some((m) => m.slug === id) ? id : null;
};

const entries = new Map();
const bases = new Map();
for (const r of aa) {
  const key = `${r.creator}|${r.base_model}`;
  if (!bases.has(key)) bases.set(key, { ...r, variants: [] });
  bases.get(key).variants.push(r);
}

for (const b of bases.values()) {
  const cl = b.creator === 'Anthropic' ? claudeId(b.base_model) : null;
  const cx = b.creator === 'OpenAI' ? codexId(b.base_model) : null;
  const orm = ALIASES[b.base_model] ? byId.get(ALIASES[b.base_model]) : byName.get(norm(b.base_model));
  const viaOr = usable(orm) ? orm.id : null;
  if (!cl && !cx && !viaOr) continue;

  // OpenAI ids keep their dots, like Codex's (gpt-5.5-pro); others are slugs of the name.
  const id = cl ?? cx ?? (b.creator === 'OpenAI' && viaOr ? viaOr.replace(/^openai\//, '') : slugOf(b.base_model));
  const name = cl ? claudeName(cl) : cx ? codexName(cx, codex) : b.base_model;
  const efforts = cl ? effortsOf(cl, null) : cx ? effortsOf(cx, codex) : orEfforts(orm);
  const current = b.variants.some((v) => !v.deprecated);
  const prev = entries.get(id);
  if (prev && prev.wanted && !current) continue;
  entries.set(id, {
    id,
    name,
    maker: b.creator,
    released: b.release_date,
    wanted: current,
    efforts,
    via: { ...(cl && { 'claude-code': cl }), ...(cx && { codex: cx }), ...(viaOr && { openrouter: viaOr }) },
    price: orm ? { input: perMillion(orm.pricing.prompt), output: perMillion(orm.pricing.completion), cached: perMillion(orm.pricing.input_cache_read) } : null,
    aa: b.aa_url.replace(/\/models\/[^/]+$/, `/models/${b.release_slug ?? b.aa_slug}`),
  });
}

// Older Claude and GPT models Rohit's own sweep still runs, so their names match too.
for (const id of SWEEP_MODELS) {
  if (entries.has(id)) continue;
  const name = id.startsWith('claude-') ? claudeName(id) : codexName(id, codex);
  if (!name) continue;
  entries.set(id, {
    id,
    name,
    maker: id.startsWith('claude-') ? 'Anthropic' : 'OpenAI',
    released: null,
    wanted: false,
    efforts: id.startsWith('claude-') ? (CLAUDE_EFFORT_LIMITS[id] ?? EFFORTS) : effortsOf(id, codex),
    via: id.startsWith('claude-') ? { 'claude-code': id } : { codex: id },
    price: null,
    aa: null,
  });
}

const models = [...entries.values()].sort((a, b) => Number(b.wanted) - Number(a.wanted) || (b.released ?? '').localeCompare(a.released ?? '') || a.name.localeCompare(b.name));
writeFileSync(
  join(root, 'data/catalog.json'),
  `${JSON.stringify({ built: new Date().toISOString().slice(0, 10), models }, null, 1)}\n`,
);
const wanted = models.filter((m) => m.wanted);
console.log(`${models.length} models (${wanted.length} wanted, ${wanted.reduce((n, m) => n + Math.max(1, m.efforts.length), 0)} model × effort pairs)`);
for (const m of wanted) console.log(`  ${m.id.padEnd(28)} ${m.name.padEnd(26)} ${m.maker.padEnd(18)} ${Object.keys(m.via).join(', ').padEnd(30)} ${m.efforts.join(' ') || '-'}`);
