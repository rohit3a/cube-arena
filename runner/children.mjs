// A model the runner starts must not outlive it. A Cursor session runs in its
// own process group (so the runner can stop the worker Cursor leaves behind),
// which a Ctrl-C, a closed terminal or a crash of the runner would otherwise
// leave playing on alone, with no heartbeat, until the site closed its suite:
// a Grok 4.7 suite went that way on 2026-10-13.

import { spawnSync } from 'node:child_process';
import { constants } from 'node:os';

const live = new Set();
let armed = false;

/** Ends a child and everything under it with a signal (on Windows, the whole tree outright). */
export function treeKiller(child, group) {
  return (signal) => {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else if (group) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // already gone
    }
  };
}

/** Ends the child with `kill` if the runner exits first. Returns the function that lets it go. */
export function tieToRunner(kill) {
  live.add(kill);
  if (!armed) {
    armed = true;
    process.on('exit', () => {
      for (const k of live) k('SIGKILL');
    });
    // Exiting runs the 'exit' handler above; the codes are the ones Node uses for these signals.
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(128 + constants.signals[sig]));
  }
  return () => live.delete(kill);
}
