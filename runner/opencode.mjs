// OpenCode Go (https://opencode.ai/docs/go/): one subscription to many open
// models behind an OpenAI-compatible endpoint. The runner reaches it with an
// OpenCode API key, or else with the OpenCode sign-in on this machine. Go asks
// other clients to name themselves in User-Agent and to send one
// x-opencode-session per conversation; the API harness does both.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const GO_BASE = 'https://opencode.ai/inference/go/openai/v1';
const GO_MODELS = 'https://opencode.ai/inference/go/v1/models';
// Go's own list has ids only; models.dev, which OpenCode itself reads, has each one's output limit.
const MODELS_DEV = 'https://models.dev/api.json';

/**
 * The key for Go: OPENCODE_API_KEY, else the token OpenCode keeps for its own
 * sign-in (opencode auth login), which carries the same subscription.
 * @returns {Promise<{ key: string, from: string } | { error: string }>}
 */
export async function goKey() {
  if (process.env.OPENCODE_API_KEY) return { key: process.env.OPENCODE_API_KEY, from: 'OPENCODE_API_KEY' };
  const missing = 'Set OPENCODE_API_KEY (from https://opencode.ai/console), or sign in to OpenCode on this machine (opencode auth login).';
  const db = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode', 'opencode.db');
  if (!existsSync(db)) return { error: missing };
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    return { error: `${missing} Reading the sign-in needs Node 22.5 or later.` };
  }
  let row;
  try {
    const conn = new sqlite.DatabaseSync(db, { readOnly: true });
    try {
      row = conn.prepare("select value from credential where integration_id = 'opencode' order by active desc").get();
    } finally {
      conn.close();
    }
  } catch {
    return { error: missing };
  }
  let cred;
  try {
    cred = JSON.parse(String(row?.value));
  } catch {
    return { error: missing };
  }
  if (typeof cred?.access !== 'string' || !cred.access) return { error: missing };
  // A suite can take hours: leave a day's margin rather than run out part way.
  if (Number(cred.expires) < Date.now() + 24 * 3600_000) return { error: 'The OpenCode sign-in is about to expire: open OpenCode once to refresh it, or set OPENCODE_API_KEY.' };
  return { key: cred.access, from: 'the OpenCode sign-in' };
}

/**
 * A catalog model's id on Go ("deepseek-v4-1-flash" → deepseek-v4.1-flash),
 * preferring a paid one to a "-free" one; null when Go doesn't have it.
 * @param {string} catalogId
 * @param {string[]} ids
 */
export function goModelId(catalogId, ids) {
  const key = (id) => id.toLowerCase().replace(/\./g, '-');
  const want = key(catalogId);
  return ids.find((id) => key(id) === want) ?? ids.find((id) => key(id) === `${want}-free`) ?? null;
}

/** Every model id Go serves now. */
export async function goModels() {
  const res = await fetch(GO_MODELS, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`OpenCode Go's model list: HTTP ${res.status}`);
  return (await res.json()).data.map((m) => m.id);
}

/** The most a Go model can write in one reply, from models.dev; null when it doesn't say. */
export async function goOutputLimit(id) {
  try {
    const res = await fetch(MODELS_DEV, { signal: AbortSignal.timeout(60_000) });
    const n = res.ok ? (await res.json())['opencode-go']?.models?.[id]?.limit?.output : null;
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
