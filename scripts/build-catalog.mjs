#!/usr/bin/env node
// Builds data/catalog.json: the models Cube Arena can run, with the exact
// name used on the boards and every way to reach each one.
//
//   node scripts/build-catalog.mjs
//
// Sources: data/aa-models.json (Artificial Analysis's model list, refreshed by
// hand), OpenRouter's public model list (fetched), the Claude Code and Codex
// model ids in runner/models.mjs, Cursor's model list in
// data/cursor-models.txt (refreshed by hand: cursor-agent models > data/cursor-models.txt),
// and the Muse Code ids below (checked by hand against Muse Code's model list).
//
//   node scripts/build-catalog.mjs --cursor-only   just redo the Cursor and Muse Code ids in the current catalog
//
// A model is in the catalog when it can
// read images and call tools somewhere we can run it. "wanted" marks the ones
// Artificial Analysis lists as current: those are what we ask people to run.

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModels, parseSlug } from '../runner/cursor.mjs';
import { CLAUDE_EFFORT_LIMITS, EFFORTS, SWEEP_MODELS, claudeName, codexModels, codexName, effortsOf } from '../runner/models.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(root, 'data/catalog.json');
const order = (a, b) => Number(b.wanted) - Number(a.wanted) || (b.released ?? '').localeCompare(a.released ?? '') || a.name.localeCompare(b.name);

// Models only Cursor has, by their Cursor id.
const CURSOR_ONLY = { 'composer-2.5': { id: 'composer-2-5', name: 'Composer 2.5', maker: 'Cursor' } };

// Meta's models in Muse Code: its id for each catalog model, and the models
// only Muse Code has so far (priced at Meta's API list price).
const MUSE = { 'muse-spark-1-3': 'muse-spark-1.3', 'muse-spark-1-2': 'muse-spark-1.2' };
const MUSE_ONLY = {
  'muse-wonder-1.0': { id: 'muse-wonder', name: 'Muse Wonder', maker: 'Meta', released: '2026-10-12', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], price: { input: 4, output: 20, cached: 0.2 } },
};

/** Adds via.muse: a model's Muse Code id. */
function withMuse(models) {
  for (const m of models) {
    delete m.via.muse;
    if (MUSE[m.id]) m.via.muse = MUSE[m.id];
  }
  for (const [museId, extra] of Object.entries(MUSE_ONLY)) {
    const known = models.find((m) => m.id === extra.id);
    if (known) known.via.muse = museId;
    else models.push({ id: extra.id, name: extra.name, maker: extra.maker, released: extra.released, wanted: true, efforts: extra.efforts, via: { muse: museId }, price: extra.price, aa: null });
  }
  return models.sort(order);
}

/**
 * Adds via.cursor: a model's Cursor id without its effort ("gpt-5.6-terra"),
 * matched on the catalog id. The runner finds the full id for an effort from
 * the user's own list. Cursor writes older Claude ids family-last
 * ("claude-4.6-opus") and some Grok ones with a "cursor-" prefix.
 */
function withCursor(models) {
  const key = (base) => base.replace(/^cursor-/, '').replace(/^claude-(\d+(?:\.\d+)?)-(opus|sonnet|haiku|fable)\b/, 'claude-$2-$1').replace(/\./g, '-');
  const bases = new Map();
  for (const { slug } of parseModels(readFileSync(join(root, 'data/cursor-models.txt'), 'utf8'))) {
    const { base } = parseSlug(slug);
    if (base !== 'auto' && !bases.has(key(base))) bases.set(key(base), base);
  }
  for (const m of models) {
    delete m.via.cursor;
    const base = bases.get(m.id.replace(/\./g, '-'));
    if (base) m.via.cursor = base;
  }
  for (const [base, extra] of Object.entries(CURSOR_ONLY)) {
    if (bases.has(key(base)) && !models.some((m) => m.id === extra.id)) models.push({ ...extra, released: null, wanted: true, efforts: [], via: { cursor: base }, price: null, aa: null });
  }
  return models.sort(order);
}

if (process.argv.includes('--cursor-only')) {
  const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
  const models = withMuse(withCursor(catalog.models));
  writeFileSync(CATALOG, `${JSON.stringify({ ...catalog, models }, null, 1)}\n`);
  console.log(`${models.filter((m) => m.via.cursor).length} of ${models.length} models reachable in Cursor`);
  for (const m of models.filter((x) => x.wanted && x.via.cursor)) console.log(`  ${m.id.padEnd(28)} ${m.via.cursor}`);
  process.exit(0);
}
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

// New models Artificial Analysis doesn't list yet, added by hand until it does.
// OpenRouter's route is used once it lists a paid one (its ":free" ones are
// rate-limited and may train on the cubes); until then they run with --via api
// on the maker's own endpoint, at the maker's list price.
const NOT_ON_AA = {
  'minimax-m3-1-flash': {
    name: 'MiniMax-M3.1-Flash',
    maker: 'MiniMax',
    released: '2026-10-19',
    openrouter: 'minimax/minimax-m3.1-flash',
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    price: { input: 0.15, output: 0.6, cached: 0.015 },
  },
};
for (const [id, extra] of Object.entries(NOT_ON_AA)) {
  if (entries.has(id)) continue;
  const orm = byId.get(extra.openrouter);
  const viaOr = usable(orm) ? orm.id : null;
  entries.set(id, {
    id,
    name: extra.name,
    maker: extra.maker,
    released: extra.released,
    wanted: true,
    efforts: viaOr ? orEfforts(orm) : extra.efforts,
    via: viaOr ? { openrouter: viaOr } : {},
    price: viaOr ? { input: perMillion(orm.pricing.prompt), output: perMillion(orm.pricing.completion), cached: perMillion(orm.pricing.input_cache_read) } : extra.price,
    aa: null,
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

const models = withMuse(withCursor([...entries.values()]));
writeFileSync(
  CATALOG,
  `${JSON.stringify({ built: new Date().toISOString().slice(0, 10), models }, null, 1)}\n`,
);
const wanted = models.filter((m) => m.wanted);
console.log(`${models.length} models (${wanted.length} wanted, ${wanted.reduce((n, m) => n + Math.max(1, m.efforts.length), 0)} model × effort pairs)`);
for (const m of wanted) console.log(`  ${m.id.padEnd(28)} ${m.name.padEnd(26)} ${m.maker.padEnd(18)} ${Object.keys(m.via).join(', ').padEnd(30)} ${m.efforts.join(' ') || '-'}`);
