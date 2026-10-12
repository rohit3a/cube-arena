// Cursor's CLI (cursor-agent; newer installs also call it agent) as a harness:
// the model runs on your Cursor plan. Its config, chats and data go in a folder
// of the runner's own (CURSOR_CONFIG_DIR, CURSOR_DATA_DIR), so your Cursor
// settings, history and default model are left alone. The sign-in is Cursor's
// usual one (cursor-agent login), which those folders don't move.
//
// Cursor names a model and its effort in one id ("gpt-5.6-terra-high",
// "claude-haiku-5-5-thinking-max"). The catalog keeps the part before the
// effort (via.cursor); the runner finds the full id in your account's model
// list when it starts.

import { execFileSync } from 'node:child_process';
import { commandFor } from './command.mjs';

/** The CLI's name on this machine, or null when Cursor's CLI isn't installed. */
export function cursorBin() {
  for (const bin of ['cursor-agent', 'agent']) {
    try {
      const run = commandFor(bin, ['--version']);
      // Cursor's versions are dates: 2026.08.11-e8db854. Another "agent" isn't Cursor.
      if (/^\d{4}\.\d{2}\.\d{2}/.test(execFileSync(run.file, run.args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())) return bin;
    } catch {
      // not this one
    }
  }
  return null;
}

/** Runs the CLI and returns what it printed (stderr too), or throws with it. */
function cli(bin, args, env) {
  const run = commandFor(bin, args);
  return execFileSync(run.file, run.args, { encoding: 'utf8', env, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Signed in? Cursor's own sign-in, outside the runner's folders. */
export function cursorSignedIn(bin, env) {
  try {
    return /logged in/i.test(cli(bin, ['status'], env));
  } catch {
    return false;
  }
}

/** The models this account can use, from `cursor-agent models`: [{ slug, name }]. */
export function cursorModels(bin, env) {
  return parseModels(cli(bin, ['models'], env));
}

/**
 * Lines of `cursor-agent models`: "gpt-5.6-terra-high - GPT-5.6 Terra 1M High".
 * @param {string} text
 * @returns {{ slug: string, name: string }[]}
 */
export function parseModels(text) {
  const models = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^([a-z0-9][a-z0-9.-]*) - (.+)$/i);
    if (m) models.push({ slug: m[1], name: m[2].replace(/\s+/g, ' ').trim() });
  }
  return models;
}

const EFFORT_WORDS = { none: 'none', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', 'extra-high': 'xhigh', max: 'max' };

/** A Cursor id's parts: "claude-opus-5-thinking-high-fast" → base claude-opus-5, effort high, thinking, fast. */
export function parseSlug(slug) {
  let s = slug;
  const fast = s.endsWith('-fast');
  if (fast) s = s.slice(0, -'-fast'.length);
  let thinking = false;
  const dropThinking = () => {
    if (s.endsWith('-thinking')) {
      thinking = true;
      s = s.slice(0, -'-thinking'.length);
    }
  };
  dropThinking();
  const m = s.match(/-(none|minimal|low|medium|high|xhigh|extra-high|max)$/);
  const effort = m ? EFFORT_WORDS[m[1]] : null;
  if (m) s = s.slice(0, -m[0].length);
  dropThinking();
  return { base: s, effort, thinking, fast };
}

/**
 * The full Cursor id for a model (its via.cursor base) at an effort (null: the
 * model has no effort setting), from the account's list. Prefers the thinking
 * variant, as Claude Code and Codex think at every effort, and never a fast one
 * (the same model, served faster at a higher price). Also returns the efforts
 * Cursor has for it, to say so when the one asked for isn't there.
 */
export function cursorSlug(base, effort, list) {
  const family = list.map((m) => ({ ...m, ...parseSlug(m.slug) })).filter((m) => m.base === base && !m.fast);
  let pick = family.filter((m) => m.effort === effort);
  // The default effort often has no suffix of its own: "gpt-5.3-codex" sits between -low and -high.
  if (!pick.length && effort === 'medium' && family.some((m) => m.effort)) pick = family.filter((m) => m.effort === null);
  pick.sort((a, b) => Number(b.thinking) - Number(a.thinking));
  const efforts = [...new Set(family.map((m) => m.effort ?? (family.some((x) => x.effort) ? 'medium' : 'default')))];
  return { slug: pick[0]?.slug ?? null, name: pick[0]?.name ?? null, efforts };
}

/** Model names compared loosely: Cursor pads some with double spaces. */
export const sameModelName = (a, b) => String(a ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim() === String(b ?? '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();
