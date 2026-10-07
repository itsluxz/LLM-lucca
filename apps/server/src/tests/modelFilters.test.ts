import { describe, expect, it } from 'vitest';
import {
  latestGeneration,
  withinAge,
  withoutDatedSnapshots,
} from '../llm/modelFilters.js';
import type { ModelInfo } from '../llm/types.js';

const model = (id: string, createdAt?: number): ModelInfo => ({
  id,
  provider: id.split(':')[0],
  name: id,
  createdAt,
});
const ids = (models: ModelInfo[]) => models.map((m) => m.id);
const now = Date.parse('2026-10-06');

describe('model filters', () => {
  it('hides models older than the age limit, keeping undated and custom ones', () => {
    const models = [
      model('openai:gpt-4o', Date.parse('2024-05-13')),
      model('openai:gpt-5.2', Date.parse('2025-12-11')),
      model('openai:sem-data'),
      model('custom:llama', Date.parse('2023-01-01')),
    ];
    expect(ids(withinAge(models, 12, now))).toEqual([
      'openai:gpt-5.2',
      'openai:sem-data',
      'custom:llama',
    ]);
    expect(withinAge(models, 0, now)).toHaveLength(4);
  });

  it('drops dated snapshots only when the alias exists', () => {
    expect(
      ids(
        withoutDatedSnapshots([
          model('openai:gpt-5.4'),
          model('openai:gpt-5.4-2026-03-05'),
          model('openai:gpt-5.5-2026-04-23'),
          model('anthropic:claude-x'),
          model('anthropic:claude-x-20251001'),
        ]),
      ),
    ).toEqual(['openai:gpt-5.4', 'openai:gpt-5.5-2026-04-23', 'anthropic:claude-x']);
  });

  it('keeps only the newest Gemini generation and aliases', () =>
    expect(
      ids(
        latestGeneration([
          model('google:gemini-2.5-flash'),
          model('google:gemini-3.8-flash'),
          model('google:gemini-3-flash-preview'),
          model('google:gemini-flash-latest'),
          model('google:gemma-4-31b-it'),
        ]),
      ),
    ).toEqual([
      'google:gemini-3.8-flash',
      'google:gemini-3-flash-preview',
      'google:gemini-flash-latest',
      'google:gemma-4-31b-it',
    ]));
});
