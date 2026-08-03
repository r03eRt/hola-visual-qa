/**
 * Structural port over the Anthropic Messages API (ADR-003). This is the
 * only shape `src/ai/anthropic/provider.ts` depends on — no
 * `@anthropic-ai/sdk` types leak in here, so the provider and its tests stay
 * hermetic. `src/ai/anthropic/real-client.ts` is the sole adapter that maps
 * this port onto the real SDK.
 */

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  mediaType: string;
  base64: string;
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export interface AnthropicMessageParams {
  model: string;
  maxOutputTokens: number;
  system: string;
  content: AnthropicContentBlock[];
}

export interface AnthropicMessageUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AnthropicMessageResult {
  text: string;
  usage?: AnthropicMessageUsage;
}

export interface AnthropicMessagesClient {
  createMessage(params: AnthropicMessageParams, signal?: AbortSignal): Promise<AnthropicMessageResult>;
}
