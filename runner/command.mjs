// Starting Claude Code or Codex. On Windows, npm installs command-line tools
// as .cmd shims, which Node can't start without a shell, and a shell would
// mangle the runner's long prompts (and cuts a command line at 8191
// characters). So a shim's script runs under Node directly; an .exe as it is.

import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';

/** The script an npm .cmd shim runs: `"%dp0%\node_modules\...\codex.js" %*` (older shims say %~dp0). */
const SHIM_TARGET = /"%~?dp0%?\\([^"]+)"\s*%\*/i;

/**
 * { file, args } that start `name` with `args` here. `env` is for tests:
 * { platform, path, exists, read, node }.
 */
export function commandFor(name, args = [], env = {}) {
  const { platform = process.platform, path = process.env.PATH ?? '', exists = existsSync, read = (f) => readFileSync(f, 'utf8'), node = process.execPath } = env;
  if (platform !== 'win32') return { file: name, args };
  for (const dir of path.split(';').filter(Boolean)) {
    for (const ext of ['.exe', '.com']) {
      const exe = win32.join(dir, name + ext);
      if (exists(exe)) return { file: exe, args };
    }
    const shim = win32.join(dir, `${name}.cmd`);
    if (!exists(shim)) continue;
    const target = read(shim).match(SHIM_TARGET)?.[1];
    if (!target) continue;
    const script = win32.join(dir, target);
    return /\.(exe|com)$/i.test(script) ? { file: script, args } : { file: node, args: [script, ...args] };
  }
  return { file: name, args };
}
