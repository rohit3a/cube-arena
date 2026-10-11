// Bits shared by the contributors board and profile pages.

import Link from 'next/link';
import { xUrl } from '@/lib/arena/contributors';

/** "@handle", linked to their X profile. */
export function Handle({ x }: { x: string | null }) {
  if (!x) return null;
  return (
    <a href={xUrl(x)} className="handle" rel="noopener" target="_blank">
      @{x}
    </a>
  );
}

/** A contributor's name, linked to their profile, with their handle after it. */
export function PersonName({ slug, name, x }: { slug: string; name: string; x: string | null }) {
  return (
    <span className="person-name">
      <Link href={`/contributors/${slug}`}>{name}</Link> <Handle x={x} />
    </span>
  );
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
