// Number formats for the index pages, shared by server and client components.

export const fmtScore = (v: number | null) => (v === null ? '–' : v >= 99.95 ? '100' : v.toFixed(1));

export function fmtDuration(secs: number) {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.round(secs / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export const fmtMs = (ms: number | null) => (ms === null ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

export const fmtCost = (v: number | null) => (v === null ? '–' : v < 0.01 ? '<$0.01' : v < 10 ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`);

export const fmtTokens = (v: number | null) => (v === null ? '–' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(v));

/** Heat class for a 0-100 score, from red to green (globals.css .heat-N): bright fills carry dark text, pale ones the normal text colour. */
export function heat(v: number | null): string {
  if (v === null) return 'heat-na';
  if (v >= 80) return 'heat-5';
  if (v >= 60) return 'heat-4';
  if (v >= 40) return 'heat-3';
  if (v >= 20) return 'heat-2';
  if (v > 0) return 'heat-1';
  return 'heat-0';
}
