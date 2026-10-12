// A gzipped tar of a folder, written here rather than by the system's tar so
// it comes out the same on macOS, Linux and Windows: plain files and folders
// only (links are skipped), no owners or timestamps, Python caches left out.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const SKIP = new Set(['__pycache__', '.DS_Store', '.git']);
const BLOCK = 512;

function header(path, size, mode, dir) {
  const h = Buffer.alloc(BLOCK);
  let name = path;
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    // ustar splits a long path at a slash: up to 155 bytes before it, 100 after.
    const cut = path.lastIndexOf('/', path.length - 1 - (dir ? 1 : 0));
    let at = -1;
    for (let i = cut; i > 0; i = path.lastIndexOf('/', i - 1)) {
      if (Buffer.byteLength(path.slice(i + 1)) <= 100 && Buffer.byteLength(path.slice(0, i)) <= 155) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new Error(`path too long for the archive: ${path}`);
    prefix = path.slice(0, at);
    name = path.slice(at + 1);
  }
  const put = (s, off, len) => h.write(s, off, len, 'utf8');
  const oct = (n, off, len) => put(`${n.toString(8).padStart(len - 1, '0')}\0`, off, len);
  put(name, 0, 100);
  oct(mode, 100, 8);
  oct(0, 108, 8);
  oct(0, 116, 8);
  oct(size, 124, 12);
  oct(0, 136, 12);
  h.fill(0x20, 148, 156);
  put(dir ? '5' : '0', 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  put(prefix, 345, 155);
  let sum = 0;
  for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return h;
}

/** Every file under `dir`, as a gzipped tar with paths relative to it. Throws past `maxBytes` unpacked. */
export function tarGz(dir, maxBytes = 64 * 1024 * 1024) {
  const parts = [];
  let total = 0;
  const walk = (rel) => {
    const entries = readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.endsWith('.pyc')) continue;
      const path = rel ? `${rel}/${e.name}` : e.name;
      const st = lstatSync(join(dir, path));
      if (st.isDirectory()) {
        parts.push(header(`${path}/`, 0, 0o755, true));
        walk(path);
      } else if (st.isFile()) {
        const data = readFileSync(join(dir, path));
        total += data.length;
        if (total > maxBytes) throw new Error(`solver/ is over ${maxBytes} bytes; build big tables in build.py instead`);
        parts.push(header(path, data.length, st.mode & 0o111 ? 0o755 : 0o644, false), data, Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK));
      }
    }
  };
  walk('');
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}
