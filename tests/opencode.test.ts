import { describe, expect, it } from 'vitest';
import { goModelId } from '../runner/opencode.mjs';

describe('OpenCode Go model ids', () => {
  const ids = ['deepseek-v4.1-flash', 'kimi-k3', 'minimax-m3', 'minimax-m3.1-flash-free', 'glm-5.3-flash', 'glm-5.3-flash-free'];

  it('finds a catalog model under its Go id', () => {
    expect(goModelId('deepseek-v4-1-flash', ids)).toBe('deepseek-v4.1-flash');
    expect(goModelId('kimi-k3', ids)).toBe('kimi-k3');
  });

  it('takes the free one only when Go has no paid one', () => {
    expect(goModelId('minimax-m3-1-flash', ids)).toBe('minimax-m3.1-flash-free');
    expect(goModelId('glm-5-3-flash', ids)).toBe('glm-5.3-flash');
  });

  it('never matches a different model', () => {
    expect(goModelId('minimax-m3-1', ids)).toBeNull();
    expect(goModelId('kimi-k3-5', ids)).toBeNull();
  });
});
