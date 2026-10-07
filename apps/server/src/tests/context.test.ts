import { describe, it, expect } from 'vitest';
import { buildContext, estimateTokens } from '../llm/context.js';
describe('context', () => {
  it('keeps the order of instructions and wraps project files', () => {
    const result = buildContext({
      base: 'base',
      user: 'user',
      project: 'project',
      files: [{ filename: 'notes.md', textContent: 'knowledge' }],
      history: [{ role: 'user', content: 'hello' }],
    });
    expect(result[0].content).toBe(
      'base\n\nuser\n\nproject\n\n<documento nome="notes.md">\nknowledge\n</documento>',
    );
    expect(result.at(-1)?.content).toBe('hello');
  });
  it('trims old history while preserving latest message and system', () => {
    const history = [
      { role: 'user' as const, content: 'old'.repeat(100) },
      { role: 'assistant' as const, content: 'reply'.repeat(100) },
      { role: 'user' as const, content: 'current' },
    ];
    const result = buildContext({
      base: 'system',
      history,
      contextWindow: 100,
    });
    expect(result[0].role).toBe('system');
    expect(result.at(-1)?.content).toBe('current');
    expect(result).toHaveLength(2);
  });
  it('estimates characters in token units', () =>
    expect(estimateTokens('12345')).toBe(2));
});
