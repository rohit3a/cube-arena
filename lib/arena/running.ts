// What counts as "running now" on the Index, model and contributor pages.
import type { SuiteEntry } from './index-data';
import { GAUNTLET } from './rules';
import { SUITES } from './suites';

/** Still being played: a suite in progress, or a closed Fast suite playing the 4×4 Gauntlet it unlocked. */
export const isRunning = (e: SuiteEntry) => e.status === 'active' || e.gauntlet === 'playing';

/** "test 2 of 3", or "4×4 Gauntlet 1 of 2" once a perfect suite has moved on to it. */
export function testLabel(e: SuiteEntry): string {
  if (e.status !== 'active' && e.gauntlet === 'playing') {
    const g = e.tests.filter((t) => t.gauntlet);
    return `${GAUNTLET.size}×${GAUNTLET.size} ${GAUNTLET.name} ${Math.max(1, g.filter((t) => t.played > 0).length)} of ${g.length}`;
  }
  return `test ${Math.max(1, e.progress.started)} of ${e.progress.of}`;
}

/** "Fast, test 2 of 3" or "Fast, 4×4 Gauntlet 1 of 2". */
export const runningLabel = (e: SuiteEntry) => `${SUITES[e.kind].name}, ${testLabel(e)}`;
