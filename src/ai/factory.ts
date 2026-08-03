import { env } from '../config/env.js';
import type { AiPolicy } from '../config/schema.js';
import { AiProviderError, type AiProvider } from './contract.js';
import { DisabledAiProvider } from './disabled-provider.js';
import { isAiEnabled } from './resolve.js';
import { AnthropicProvider } from './anthropic/provider.js';
import { createAnthropicClient } from './anthropic/real-client.js';
import { FsImageLoader } from './anthropic/fs-image-loader.js';
import type { AnthropicMessagesClient } from './anthropic/client-port.js';
import type { ImageLoader } from './anthropic/image-port.js';

/**
 * Builds the `AiProvider` for the resolved `ai` policy (ADR-003, feature
 * #27). Returns the safe `DisabledAiProvider` unless AI is enabled and the
 * configured provider is `anthropic`; never throws for the disabled path.
 * The Anthropic API key is always read from `env` (or injected for tests),
 * never from `config` — it never appears in the resolved `AiPolicy`.
 */
export interface CreateAiProviderDeps {
  client?: AnthropicMessagesClient;
  imageLoader?: ImageLoader;
  model?: string;
  apiKey?: string;
}

export function createAiProvider(policy: AiPolicy, deps?: CreateAiProviderDeps): AiProvider {
  if (!isAiEnabled(policy) || policy.provider !== 'anthropic') {
    return new DisabledAiProvider();
  }

  const model = deps?.model ?? policy.model ?? env.CLAUDE_MODEL;
  if (!model) {
    throw new AiProviderError('Anthropic model is not configured; set CLAUDE_MODEL or ai.model');
  }

  const apiKey = deps?.apiKey ?? env.ANTHROPIC_API_KEY;
  if (!deps?.client && !apiKey) {
    throw new AiProviderError('ANTHROPIC_API_KEY is not configured');
  }

  const client = deps?.client ?? createAnthropicClient({ apiKey: apiKey as string });
  const imageLoader = deps?.imageLoader ?? new FsImageLoader();

  return new AnthropicProvider({ client, model, imageLoader });
}
