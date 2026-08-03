import Anthropic from '@anthropic-ai/sdk';
import type {
  AnthropicContentBlock,
  AnthropicMessageParams,
  AnthropicMessageResult,
  AnthropicMessagesClient
} from './client-port.js';

/**
 * The ONLY module in this codebase that imports `@anthropic-ai/sdk`
 * (ADR-003). Adapts the SDK to the local `AnthropicMessagesClient` port so
 * every other module (and all unit tests) depends solely on that port. The
 * API key is passed in by the caller (`src/ai/factory.ts`, sourced from
 * `env.ANTHROPIC_API_KEY`) — never read from env here, never logged.
 */

function toSdkContentBlock(block: AnthropicContentBlock): Anthropic.ContentBlockParam {
  if (block.type === 'text') return { type: 'text', text: block.text };
  return {
    type: 'image',
    source: { type: 'base64', media_type: block.mediaType as 'image/png', data: block.base64 }
  };
}

export function createAnthropicClient({ apiKey }: { apiKey: string }): AnthropicMessagesClient {
  const client = new Anthropic({ apiKey });

  return {
    async createMessage(params: AnthropicMessageParams, signal?: AbortSignal): Promise<AnthropicMessageResult> {
      const response = await client.messages.create(
        {
          model: params.model,
          max_tokens: params.maxOutputTokens,
          system: params.system,
          messages: [{ role: 'user', content: params.content.map(toSdkContentBlock) }]
        },
        { signal }
      );

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      const usage = response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
        : undefined;

      return { text, usage };
    }
  };
}
