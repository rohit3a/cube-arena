'use client';

// A card that can be saved as an image ready to post: the chart or table as
// it looks on the page, in the current theme, in a Cube Arena frame (the
// mark, a title, the site and the date) that hugs the card: the same margin
// on every side, the header and title spanning exactly the card's width. The
// card is copied into the frame off screen, so the page never moves. Bits
// marked data-noexport (the button) stay out of the image.

import { type ReactNode, useRef, useState } from 'react';
import { MARK } from '@/lib/brand';

const SITE = 'cube.krnl.studio';

const PIXEL_RATIO = 2;
/** Wider widths the card is tried at when widening it by what spills isn't enough. */
const WIDTHS = [720, 820, 920, 1040, 1160, 1280];
/** What SVG parts take from the page's CSS. */
const SVG_STYLE = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
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
 * date, a title, and the card, at the card's own width (or the first wider one
 * where nothing scrolls sideways). Returns it and a cleanup. Ancestors are
 * copied as display:contents wrappers so the page's CSS (and inherited
 * variables) still reach the copy without their layout.
 */
function buildFrame(node: HTMLElement, title: string) {
  const holder = el('div', 'share-holder');
  const frame = el('div', 'share-frame');

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

  // The ancestors, outermost first, as layout-free wrappers.
  const chain: HTMLElement[] = [];
  for (let a = node.parentElement; a && a !== document.body; a = a.parentElement) chain.unshift(a);
  let inner: HTMLElement = stage;
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

  frame.append(head, heading, stage);
  holder.appendChild(frame);
  document.body.appendChild(holder);

  // The image library copies an <svg> as it is, without the page's CSS, so
  // its parts get their looks inline.
  for (const n of copy.querySelectorAll<SVGElement>('svg *')) {
    const c = getComputedStyle(n);
    for (const p of SVG_STYLE) n.style.setProperty(p, c.getPropertyValue(p));
  }

  // The card's own width, unless something scrolls or spills sideways there (a chart drawn wider than the
  // card); then the first wider width where nothing does.
  const own = Math.round(node.getBoundingClientRect().width);
  const scrollers = [copy, ...copy.querySelectorAll<HTMLElement>('*')].filter((n) => {
    const c = getComputedStyle(n);
    return /auto|scroll/.test(c.overflowX) || c.textOverflow === 'ellipsis';
  });
  const fits = (width: number) => {
    copy.style.width = `${width}px`;
    return copy.scrollWidth <= copy.offsetWidth + 2 && scrollers.every((n) => n.scrollWidth <= n.clientWidth + 2);
  };
  // Widened by exactly what spills, so a chart a little wider than its card leaves no gap beside it.
  copy.style.width = `${own}px`;
  const spill = Math.max(0, copy.scrollWidth - copy.offsetWidth, ...scrollers.map((n) => n.scrollWidth - n.clientWidth));
  const snug = own + Math.ceil(spill);
  const width = fits(snug) ? snug : (WIDTHS.find((w) => w > snug && fits(w)) ?? own);
  copy.style.width = `${width}px`;
  // Header, title and card share one column, so their edges line up.
  frame.style.width = `${copy.offsetWidth}px`;
  frame.style.boxSizing = 'content-box';

  return { frame, cleanup: () => holder.remove() };
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
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  const title = (caption ?? name).replace(/^Cube Arena\s+/, '');

  async function save() {
    const node = ref.current;
    if (!node || state === 'busy') return;
    setState('busy');
    let built: ReturnType<typeof buildFrame> | null = null;
    try {
      const { toPng } = await import('html-to-image');
      built = buildFrame(node, title);
      const url = await toPng(built.frame, {
        pixelRatio: PIXEL_RATIO,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
      });
      const a = document.createElement('a');
      a.href = url;
      a.download = `cube-arena-${slug(name)}.png`;
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
      <div className="export-menu" data-noexport>
        <button type="button" className="export-btn" onClick={save} disabled={state === 'busy'} title={`Save “${title}” as an image`}>
          {state === 'busy' ? 'Saving…' : state === 'failed' ? 'Failed, retry' : 'Image'}
        </button>
      </div>
      {children}
    </Tag>
  );
}
