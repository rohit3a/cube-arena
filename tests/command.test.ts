import { describe, expect, it } from 'vitest';
import { commandFor } from '../runner/command.mjs';

// What npm 7+ writes for `npm install -g @openai/codex` on Windows.
const NPM_SHIM = String.raw`@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
`;

// Older npm (cmd-shim 2.x).
const OLD_SHIM = String.raw`@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\node_modules\@anthropic-ai\claude-code\cli.js" %*
)
`;

const NPM = String.raw`C:\Users\k\AppData\Roaming\npm`;
const LOCAL = String.raw`C:\Users\k\.local\bin`;
const NODE = String.raw`C:\Program Files\nodejs\node.exe`;
const machine = (files: Record<string, string>) => ({
  platform: 'win32',
  path: `C:\\Windows\\system32;${LOCAL};${NPM}`,
  exists: (f: string) => f in files,
  read: (f: string) => files[f],
  node: NODE,
});

describe('commandFor', () => {
  it('runs commands as they are off Windows', () => {
    expect(commandFor('codex', ['exec'], { platform: 'darwin' })).toEqual({ file: 'codex', args: ['exec'] });
  });

  it("runs an npm shim's script under Node on Windows", () => {
    expect(commandFor('codex', ['exec', '--json'], machine({ [`${NPM}\\codex.cmd`]: NPM_SHIM }))).toEqual({
      file: NODE,
      args: [`${NPM}\\node_modules\\@openai\\codex\\bin\\codex.js`, 'exec', '--json'],
    });
    expect(commandFor('claude', ['-p'], machine({ [`${NPM}\\claude.cmd`]: OLD_SHIM }))).toEqual({
      file: NODE,
      args: [`${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`, '-p'],
    });
  });

  it('prefers the first .exe on the path, like Windows does', () => {
    const files = { [`${LOCAL}\\claude.exe`]: '', [`${NPM}\\claude.cmd`]: OLD_SHIM };
    expect(commandFor('claude', ['-p'], machine(files))).toEqual({ file: `${LOCAL}\\claude.exe`, args: ['-p'] });
  });

  it('falls back to the bare name when nothing is found', () => {
    expect(commandFor('codex', [], machine({}))).toEqual({ file: 'codex', args: [] });
  });
});
