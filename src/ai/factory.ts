import { env } from '../config/env.js';
import { AnthropicProvider } from './anthropic-provider.js';
import type { AiProvider } from './provider.js';

export function createAiProvider(): AiProvider | null {
  if (!env.ENABLE_AI_ANALYSIS || env.AI_PROVIDER === 'none') return null;
  return new AnthropicProvider();
}
