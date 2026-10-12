#!/usr/bin/env node
// Packs runner/ into public/runner/cube-arena-runner-<version>.tgz, which the
// site serves so people can install the runner without npm's registry:
//   npm install -g https://cube.krnl.studio/runner/cube-arena-runner-<version>.tgz
// Runs before every build (package.json prebuild). The version is in the file
// name because npm caches installs by URL: a new runner needs a new URL.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version, files } = JSON.parse(readFileSync(join(root, 'runner/package.json'), 'utf8'));
const cli = readFileSync(join(root, 'runner/cli.mjs'), 'utf8');
const stated = cli.match(/const VERSION = '([^']+)'/)?.[1];
if (stated !== version) throw new Error(`runner/cli.mjs says ${stated} but runner/package.json says ${version}; bump both together.`);

// Every file the shipped code imports must ship too: a missing one only shows up
// when someone installs the package and it fails to start.
for (const f of files.filter((x) => x.endsWith('.mjs'))) {
  for (const [, dep] of readFileSync(join(root, 'runner', f), 'utf8').matchAll(/(?:from|import\()\s*'\.\/([^']+)'/g)) {
    if (!files.includes(dep)) throw new Error(`runner/${f} imports ./${dep}, which is not in runner/package.json "files".`);
    if (!existsSync(join(root, 'runner', dep))) throw new Error(`runner/${f} imports ./${dep}, which does not exist.`);
  }
}

const out = join(root, 'public/runner');
mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.tgz')) rmSync(join(out, f));
// The npm running this script (npm_execpath), not whatever "npm" is first on the PATH: under `npm run` that is
// node_modules/.bin, where a dependency ships npm 6, which has no --pack-destination.
const npm = process.env.npm_execpath ? [process.execPath, [process.env.npm_execpath]] : ['npm', []];
const [{ filename }] = JSON.parse(
  execFileSync(npm[0], [...npm[1], 'pack', '--pack-destination', out, '--json'], { cwd: join(root, 'runner'), encoding: 'utf8' }),
);
console.log(`runner: public/runner/${filename}`);
