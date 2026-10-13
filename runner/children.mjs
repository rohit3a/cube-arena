// A model the runner starts must not outlive it. A Cursor session runs in its
// own process group (so the runner can stop the worker Cursor leaves behind),
// which a Ctrl-C, a closed terminal or a crash of the runner would otherwise
// leave playing on alone, with no heartbeat, until the site closed its suite:
// a Grok 4.7 suite went that way on 2026-10-13.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { constants } from 'node:os';
import { sep } from 'node:path';

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

/** Set on a coding agent, and so on everything it starts: the workspace it codes in. */
export const WORKSPACE_ENV = 'CUBE_ARENA_WORKSPACE';

/**
 * Ends what a model left running when its coding session ends: a build or
 * search it put in the background outlives the agent that started it. Three of
 * GPT-6-Luna's table builds ran on for a day after its run (2026-10-13), using
 * half of the machine under the runs that came next. A leftover is a process
 * of ours that carries WORKSPACE_ENV for `dir` (seen on Linux only), runs a
 * program inside `dir`, or works inside `dir` with no terminal (a shell you
 * opened there stays). The runner and its parents are spared. Linux and macOS.
 * Returns what it ended.
 */
export function endLeftovers(dir) {
  if (process.platform === 'win32') return [];
  let root;
  try {
    root = realpathSync(dir);
  } catch {
    return [];
  }
  const inside = (p) => !!p && (p === root || p.startsWith(root + sep));
  const marker = `${WORKSPACE_ENV}=${dir}`;
  const ended = [];
  // A leftover may start more while it is being ended: look again until none are left.
  for (let pass = 0; pass < 5; pass++) {
    const all = process.platform === 'linux' ? linuxProcesses() : psProcesses();
    const spared = parents(all);
    const left = all.filter((p) => !spared.has(p.pid) && (p.env.includes(marker) || inside(p.exe) || (inside(p.cwd) && !p.tty)));
    if (!left.length) break;
    for (const p of left) {
      try {
        process.kill(p.pid, 'SIGKILL');
        ended.push({ pid: p.pid, command: p.command });
      } catch {
        // gone already, or not ours
      }
    }
  }
  return ended;
}

/** The runner and every process above it. */
function parents(all) {
  const up = new Map(all.map((p) => [p.pid, p.ppid]));
  const spared = new Set();
  for (let pid = process.pid; pid > 1 && !spared.has(pid); pid = up.get(pid) ?? 0) spared.add(pid);
  return spared;
}

/** Our processes, from /proc. One we can't read the environment of isn't ours. */
function linuxProcesses() {
  const ps = [];
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const at = `/proc/${name}`;
    try {
      const stat = readFileSync(`${at}/stat`, 'utf8');
      // After "pid (comm) ": state, ppid, pgrp, session, tty_nr.
      const [state, ppid, , , tty] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      if (state === 'Z') continue;
      const env = readFileSync(`${at}/environ`, 'latin1').split('\0');
      const link = (l) => {
        try {
          return readlinkSync(`${at}/${l}`).replace(/ \(deleted\)$/, '');
        } catch {
          return null;
        }
      };
      const command = readFileSync(`${at}/cmdline`, 'utf8').split('\0').join(' ').trim();
      ps.push({ pid: Number(name), ppid: Number(ppid), tty: tty !== '0', env, exe: link('exe'), cwd: link('cwd'), command });
    } catch {
      // gone, or not ours
    }
  }
  return ps;
}

/** Our processes on macOS, from ps and lsof (macOS shows no other process's environment). */
function psProcesses() {
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).stdout ?? '';
  const cwds = new Map();
  let pid = 0;
  for (const l of run('lsof', ['-a', '-d', 'cwd', '-u', String(process.getuid()), '-Fpn']).split('\n')) {
    if (l[0] === 'p') pid = Number(l.slice(1));
    else if (l[0] === 'n') cwds.set(pid, l.slice(1));
  }
  return run('ps', ['-xww', '-o', 'pid=,ppid=,tty=,command='])
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, tty, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      tty: !tty.startsWith('?'),
      env: [],
      exe: command.split(' ')[0],
      cwd: cwds.get(Number(pid)) ?? null,
      command,
    }));
}
