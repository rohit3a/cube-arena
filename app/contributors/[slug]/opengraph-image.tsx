import { ImageResponse } from 'next/og';
import { contributor } from '@/lib/arena/contributors';
import { fmtDuration } from '@/lib/arena/format';

export const alt = 'A Cube Arena contributor';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const FACE = ['#ffffff', '#f2545b', '#2bb673', '#ffd23f', '#ff9f1c', '#3d7bff', '#2bb673', '#ffffff', '#ffd23f'];
const INK = '#18181d';

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const p = await contributor((await params).slug).catch(() => null);
  const stats: [string, string][] = p
    ? [
        [String(p.tests), p.tests === 1 ? 'test played' : 'tests played'],
        [String(p.firsts), p.firsts === 1 ? 'new result' : 'new results'],
        [String(p.models), p.models === 1 ? 'model' : 'models'],
        [fmtDuration(p.secs), 'on the cube'],
      ]
    : [];
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#fff8ec', padding: 64, fontFamily: 'sans-serif', color: INK }}>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 30, fontWeight: 700, color: '#464752' }}>
            Cube Arena · Contributor{p ? ` #${p.rank}` : ''}
          </div>
          <div style={{ display: 'flex', fontSize: 92, fontWeight: 800, lineHeight: 1.05, marginTop: 30 }}>{p?.name ?? 'Contributor'}</div>
          {p?.x ? <div style={{ display: 'flex', fontSize: 38, fontWeight: 600, color: '#464752', marginTop: 10 }}>@{p.x}</div> : null}
          <div style={{ display: 'flex', gap: 18, marginTop: 'auto' }}>
            {stats.map(([value, label], i) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '18px 24px',
                  border: `5px solid ${INK}`,
                  borderRadius: 20,
                  background: i === 0 ? '#ffd23f' : '#ffffff',
                  boxShadow: `6px 6px 0 ${INK}`,
                }}
              >
                <div style={{ display: 'flex', fontSize: 52, fontWeight: 800 }}>{value}</div>
                <div style={{ display: 'flex', fontSize: 22, color: '#464752' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 280 }}>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              width: 240,
              height: 240,
              padding: 10,
              gap: 8,
              background: INK,
              borderRadius: 28,
              transform: 'rotate(8deg)',
              boxShadow: '10px 10px 0 #ffd23f',
            }}
          >
            {FACE.map((c, i) => (
              <div key={i} style={{ width: 66, height: 66, background: c, borderRadius: 12 }} />
            ))}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
