'use client';

// A card that can be saved as an image ready to post: the chart or table as
// it looks on the page, in the current theme, set in a Cube Arena frame (the
// mark, a title, the site and the date) at the size a social network wants.
// The card is copied into the frame off screen, so the page never moves; it
// is laid out again at whichever width fills the frame best. Bits marked
// data-noexport (the button, its menu) stay out of the image.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { MARK } from '@/lib/brand';

const SITE = 'cube.krnl.studio';

/** Frame sizes in CSS pixels; the image is twice that. 0 × 0 fits the card. */
const FORMATS = [
  { key: 'x', label: 'Landscape', note: 'X, LinkedIn · 16:9', w: 960, h: 540 },
  { key: 'square', label: 'Square', note: 'Instagram · 1:1', w: 720, h: 720 },
  { key: 'portrait', label: 'Portrait', note: 'Instagram · 4:5', w: 720, h: 900 },
  { key: 'story', label: 'Story', note: 'Stories, Reels · 9:16', w: 720, h: 1280 },
  { key: 'full', label: 'Full size', note: 'Everything, any shape', w: 0, h: 0 },
] as const;
type Format = (typeof FORMATS)[number];
const SIZED = FORMATS.filter((f) => f.w > 0);

const PIXEL_RATIO = 2;
/** Widths the card is tried at, besides its own. */
const WIDTHS = [480, 560, 640, 720, 820, 920, 1040, 1160, 1280];
/** What SVG parts take from the page's CSS. */
const SVG_STYLE = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
];
/** Never blow a small card up more than this. */
const MAX_SCALE = 1.8;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'chart';

const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const e = document.createElement(tag);
  e.className = className;
  if (text) e.textContent = text;
  return e;
}

/**
 * The share frame for `node`, built off screen: the mark, the site and the
 * date, a title, and the card scaled into the rest. Returns it, how much the
 * card was scaled, and a cleanup. Ancestors are copied as
 * display:contents wrappers so the page's CSS (and inherited variables)
 * still reach the copy without their layout.
 */
function buildFrame(node: HTMLElement, title: string, f: Format) {
  const holder = el('div', 'share-holder');
  const frame = el('div', `share-frame share-${f.key}`);
  if (f.w) {
    frame.style.width = `${f.w}px`;
    frame.style.height = `${f.h}px`;
  }

  const head = el('div', 'share-head');
  const brand = el('div', 'share-brand');
  const mark = el('span', 'brand-mark');
  for (const c of MARK) mark.appendChild(el('i', '')).style.background = c;
  brand.append(mark, el('span', '', 'Cube Arena'));
  const meta = el('div', 'share-meta');
  meta.append(el('span', 'share-date', today()), el('span', 'share-url', SITE));
  head.append(brand, meta);
  // Names stay whole: a line breaks between them, never at a hyphen inside one.
  const heading = el('div', 'share-title');
  for (const part of title.split(/( vs | · )/)) heading.appendChild(el('span', / vs | · /.test(part) ? '' : 'share-nowrap', part));

  const stage = el('div', 'share-stage');
  const sizer = el('div', 'share-sizer');
  const scaler = el('div', 'share-scaler');

  // The ancestors, outermost first, as layout-free wrappers.
  const chain: HTMLElement[] = [];
  for (let a = node.parentElement; a && a !== document.body; a = a.parentElement) chain.unshift(a);
  let inner: HTMLElement = scaler;
  for (const a of chain) {
    const w = document.createElement(a.tagName === 'TABLE' || a.tagName === 'TBODY' ? 'div' : a.tagName.toLowerCase());
    w.className = a.className;
    const style = a.getAttribute('style');
    if (style) w.setAttribute('style', style);
    w.style.setProperty('display', 'contents', 'important');
    inner.appendChild(w);
    inner = w;
  }

  const copy = node.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  copy.dataset.exporting = '';
  for (const n of copy.querySelectorAll('[data-noexport]')) n.remove();
  copy.style.margin = '0';
  // A bare section (no border of its own, no cards inside) gets a card's frame.
  const cs = getComputedStyle(node);
  if (cs.borderTopWidth === '0px' && !node.querySelector('.card')) copy.classList.add('share-boxed');
  inner.appendChild(copy);

  sizer.appendChild(scaler);
  stage.appendChild(sizer);
  frame.append(head, heading, stage);
  holder.appendChild(frame);
  document.body.appendChild(holder);

  // The image library copies an <svg> as it is, without the page's CSS, so
  // its parts get their looks inline.
  for (const n of copy.querySelectorAll<SVGElement>('svg *')) {
    const c = getComputedStyle(n);
    for (const p of SVG_STYLE) n.style.setProperty(p, c.getPropertyValue(p));
  }

  // A chart drawn wider than a width makes that width fail the check below.
  const own = Math.round(node.getBoundingClientRect().width);
  const widths = [...new Set([own, ...WIDTHS])];
  // What must not spill or scroll sideways, or cut a name short with an ellipsis.
  const scrollers = [copy, ...copy.querySelectorAll<HTMLElement>('*')].filter((n) => {
    const c = getComputedStyle(n);
    return /auto|scroll/.test(c.overflowX) || c.textOverflow === 'ellipsis';
  });

  const fit = (width: number, strict = true) => {
    copy.style.width = `${width}px`;
    const w = copy.offsetWidth;
    const h = copy.offsetHeight;
    // Something that scrolls or spills sideways at this width can't shrink that far.
    if (strict && (copy.scrollWidth > w + 2 || scrollers.some((n) => n.scrollWidth > n.clientWidth + 2))) return null;
    const scale = f.w ? Math.min(stage.clientWidth / w, stage.clientHeight / h, MAX_SCALE) : 1;
    return { width, w, h, scale };
  };

  let best: NonNullable<ReturnType<typeof fit>> | null = null;
  if (f.w) {
    for (const width of widths) {
      const r = fit(width);
      // Bigger text wins; within 3%, the card's own width (it was designed for it).
      if (r && (!best || r.scale > best.scale * 1.03 || (r.scale > best.scale * 0.97 && width === own))) best = r;
    }
  } else {
    best = fit(Math.max(own, 720)) ?? fit(1040);
  }
  best ??= fit(own, false)!;
  fit(best.width, false);

  scaler.style.width = `${best.w}px`;
  scaler.style.transform = `scale(${best.scale})`;
  sizer.style.width = `${Math.floor(best.w * best.scale)}px`;
  sizer.style.height = `${Math.floor(best.h * best.scale)}px`;
  if (!f.w) frame.style.width = `${best.w + 2 * 40}px`;

  return { frame, scale: best.scale, cleanup: () => holder.remove() };
}

export default function Exportable({
  as = 'section',
  name,
  caption,
  className = '',
  id,
  children,
}: {
  as?: 'section' | 'article' | 'div';
  /** What it is: the file name and the button's label. */
  name: string;
  /** The image's title; the name when not given. */
  caption?: string;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  // One element type for the ref; section, article and div all render the same way.
  const Tag = as as 'div';
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const title = (caption ?? name).replace(/^Cube Arena\s+/, '');

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  async function save(f: Format | 'best') {
    const node = ref.current;
    if (!node || state === 'busy') return;
    setOpen(false);
    setState('busy');
    let built: ReturnType<typeof buildFrame> | null = null;
    try {
      const { toPng } = await import('html-to-image');
      if (f === 'best') {
        // The shape the card comes out biggest in; landscape when it's close.
        let pick: { f: Format; scale: number } | null = null;
        for (const g of SIZED) {
          const t = buildFrame(node, title, g);
          t.cleanup();
          const scale = g.key === 'x' ? t.scale * 1.08 : t.scale;
          if (!pick || scale > pick.scale) pick = { f: g, scale };
        }
        f = pick!.f;
      }
      built = buildFrame(node, title, f);
      const url = await toPng(built.frame, {
        pixelRatio: PIXEL_RATIO,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `cube-arena-${slug(name)}${f.key === 'full' ? '' : `-${f.key}`}.png`;
      a.click();
      setState('idle');
    } catch {
      setState('failed');
      setTimeout(() => setState('idle'), 2500);
    } finally {
      built?.cleanup();
    }
  }

  return (
    <Tag ref={ref} id={id} className={`exportable ${className}`}>
      <div className="export-menu" data-noexport ref={menuRef}>
        <button
          type="button"
          className="export-btn"
          onClick={() => setOpen((o) => !o)}
          disabled={state === 'busy'}
          aria-expanded={open}
          aria-haspopup="menu"
          title={`Save “${title}” as an image`}
        >
          {state === 'busy' ? 'Saving…' : state === 'failed' ? 'Failed, retry' : 'Image'}
        </button>
        {open && (
          <div className="export-pop" role="menu">
            <button type="button" role="menuitem" onClick={() => save('best')}>
              <span className="export-shape export-shape-best" aria-hidden />
              <span>
                <strong>Best fit</strong>
                <small>The shape this looks biggest in</small>
              </span>
            </button>
            {FORMATS.map((f) => (
              <button type="button" role="menuitem" key={f.key} onClick={() => save(f)}>
                <span className={`export-shape export-shape-${f.key}`} aria-hidden />
                <span>
                  <strong>{f.label}</strong>
                  <small>
                    {f.note}
                    {f.w ? ` · ${f.w * PIXEL_RATIO}×${f.h * PIXEL_RATIO}` : ''}
                  </small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </Tag>
  );
}
