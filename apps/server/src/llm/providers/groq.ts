import { OpenAiCompatible } from './openaiCompatible.js';
export const groq = new OpenAiCompatible(
  'groq',
  'Groq',
  'https://api.groq.com/openai/v1',
);
