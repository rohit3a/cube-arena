import { describe, expect, it } from 'vitest';
import { cursorSlug, parseModels, parseSlug, sameModelName } from '../runner/cursor.mjs';

// Lines as `cursor-agent models` prints them (2026.08 CLI).
const LISTING = `Available models

auto - Auto (default)
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex - Codex 5.3
gpt-5.3-codex-high - Codex 5.3 High
gpt-5.3-codex-high-fast - Codex 5.3 High Fast
composer-2.5 - Composer 2.5
composer-2.5-fast - Composer 2.5 Fast
claude-haiku-5-5-high - Claude Haiku 5.5  High No Thinking
claude-haiku-5-5-thinking-high - Claude Haiku 5.5  High
claude-4.6-opus-max-thinking - Claude Opus 4.6 1M Max Thinking
gpt-5.5-extra-high - GPT-5.5 1M Extra High
gemini-3.8-flash-low - Gemini 3.8 Flash Low
gemini-3.8-flash-high - Gemini 3.8 Flash High

Tip: use --model <id> (or /model <id> in interactive mode) to switch.`;

describe('Cursor model ids', () => {
  const list = parseModels(LISTING);

  it('reads the model list and nothing else', () => {
    expect(list).toHaveLength(13);
    expect(list[0]).toEqual({ slug: 'auto', name: 'Auto (default)' });
    expect(list.find((m) => m.slug === 'claude-haiku-5-5-high')?.name).toBe('Claude Haiku 5.5 High No Thinking');
  });

  it('splits an id into model, effort, thinking and fast', () => {
    expect(parseSlug('claude-opus-5-thinking-high-fast')).toEqual({ base: 'claude-opus-5', effort: 'high', thinking: true, fast: true });
    expect(parseSlug('claude-4.6-opus-max-thinking')).toEqual({ base: 'claude-4.6-opus', effort: 'max', thinking: true, fast: false });
    expect(parseSlug('gpt-5.5-extra-high')).toMatchObject({ base: 'gpt-5.5', effort: 'xhigh' });
    expect(parseSlug('gpt-5-mini')).toMatchObject({ base: 'gpt-5-mini', effort: null });
    expect(parseSlug('kimi-k2.7-code')).toMatchObject({ base: 'kimi-k2.7-code', effort: null });
  });

  it('picks the thinking variant and never a fast one', () => {
    expect(cursorSlug('claude-haiku-5-5', 'high', list).slug).toBe('claude-haiku-5-5-thinking-high');
    expect(cursorSlug('gpt-5.3-codex', 'high', list).slug).toBe('gpt-5.3-codex-high');
    expect(cursorSlug('composer-2.5', null, list)).toMatchObject({ slug: 'composer-2.5', name: 'Composer 2.5' });
  });

  it("takes an id with no effort as the default between others' efforts", () => {
    expect(cursorSlug('gpt-5.3-codex', 'medium', list).slug).toBe('gpt-5.3-codex');
    expect(cursorSlug('gpt-5.5', 'xhigh', list).slug).toBe('gpt-5.5-extra-high');
  });

  it('says which efforts there are when the one asked for is missing', () => {
    expect(cursorSlug('gemini-3.8-flash', 'medium', list)).toEqual({ slug: null, name: null, efforts: ['low', 'high'] });
    expect(cursorSlug('grok-4.7', 'high', list)).toEqual({ slug: null, name: null, efforts: [] });
  });

  it('compares model names loosely', () => {
    expect(sameModelName('Claude Haiku 5.5  High', 'Claude Haiku 5.5 High')).toBe(true);
    expect(sameModelName('Composer 2.5', 'Gemini 3.8 Flash Low')).toBe(false);
  });
});
