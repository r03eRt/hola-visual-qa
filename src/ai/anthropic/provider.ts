import type { AiAnalysis } from '../analysis.js';
import { AiProviderError, type AiAnalysisRequest, type AiProvider, type AiRequestOptions } from '../contract.js';
import type { RedactedEvidence } from '../../evidence/contract.js';
import type { AnthropicContentBlock, AnthropicMessageResult, AnthropicMessagesClient } from './client-port.js';
import type { ImageLoader } from './image-port.js';
import { buildAnalysisPrompt } from './prompt.js';
import { parseAnalysisResponse } from './parse.js';

/**
 * Real Anthropic (Claude) adapter for the `AiProvider` contract (ADR-003,
 * SPEC-008). Depends only on the local `AnthropicMessagesClient` /
 * `ImageLoader` ports — no `@anthropic-ai/sdk` import, no direct fs/network
 * I/O — so this module and its tests stay hermetic. `src/ai/factory.ts`
 * wires the real client/loader from `src/ai/anthropic/real-client.ts` and
 * `src/ai/anthropic/fs-image-loader.ts`.
 */

// Best-effort, approximate flat per-token USD pricing used only for the
// `maxCostUsd` guard. The exact figure is not load-bearing — it only needs
// to make the guard trip when reported usage is large. Exported so tests can
// deliberately construct a tripping case.
export const ANTHROPIC_INPUT_PRICE_PER_TOKEN_USD = 0.000_003;
export const ANTHROPIC_OUTPUT_PRICE_PER_TOKEN_USD = 0.000_015;

// Default cumulative decoded image byte budget attached to a single
// analysis request (5 MiB). Images beyond this budget are simply skipped.
export const DEFAULT_IMAGE_BUDGET_BYTES = 5 * 1024 * 1024;

export interface AnthropicProviderDeps {
  client: AnthropicMessagesClient;
  model: string;
  imageLoader?: ImageLoader;
  imageBudgetBytes?: number;
}

function estimateCostUsd(usage: NonNullable<AnthropicMessageResult['usage']>): number {
  return usage.inputTokens * ANTHROPIC_INPUT_PRICE_PER_TOKEN_USD + usage.outputTokens * ANTHROPIC_OUTPUT_PRICE_PER_TOKEN_USD;
}

function decodedBase64ByteLength(base64: string): number {
  // Approximate decoded size from a base64 string length, without decoding.
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

async function callWithTimeout(
  client: AnthropicMessagesClient,
  params: Parameters<AnthropicMessagesClient['createMessage']>[0],
  timeoutMs: number
): Promise<AnthropicMessageResult> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new AiProviderError('Anthropic analysis timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([client.createMessage(params, controller.signal), timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  private readonly client: AnthropicMessagesClient;
  private readonly model: string;
  private readonly imageLoader: ImageLoader | undefined;
  private readonly imageBudgetBytes: number;

  constructor(deps: AnthropicProviderDeps) {
    this.client = deps.client;
    this.model = deps.model;
    this.imageLoader = deps.imageLoader;
    this.imageBudgetBytes = deps.imageBudgetBytes ?? DEFAULT_IMAGE_BUDGET_BYTES;
  }

  async analyze(request: AiAnalysisRequest): Promise<AiAnalysis> {
    const { evidence, options } = request;
    const { system, userText } = buildAnalysisPrompt(evidence);
    const content = await this.buildContent(userText, evidence);

    const scenarioId = evidence.scenario.id;
    let lastError: unknown;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      try {
        const result = await callWithTimeout(
          this.client,
          { model: this.model, maxOutputTokens: options.maxOutputTokens, system, content },
          options.timeoutMs
        );

        this.enforceCostBudget(result, options);

        return parseAnalysisResponse(result.text, evidence);
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof AiProviderError) throw lastError;
    throw new AiProviderError('Anthropic analysis failed', { scenarioId });
  }

  private enforceCostBudget(result: AnthropicMessageResult, options: AiRequestOptions): void {
    if (!result.usage) return;
    const estimatedCostUsd = estimateCostUsd(result.usage);
    if (estimatedCostUsd > options.maxCostUsd) {
      throw new AiProviderError('Anthropic analysis exceeded the cost budget');
    }
  }

  private async buildContent(userText: string, evidence: RedactedEvidence): Promise<AnthropicContentBlock[]> {
    const content: AnthropicContentBlock[] = [{ type: 'text', text: userText }];

    if (!this.imageLoader || !evidence.artifacts) return content;

    let budgetRemaining = this.imageBudgetBytes;
    const refs: Array<{ label: string; ref: string | undefined }> = [
      { label: 'expected', ref: evidence.artifacts.expected },
      { label: 'actual', ref: evidence.artifacts.actual },
      { label: 'diff', ref: evidence.artifacts.diff }
    ];

    for (const { label, ref } of refs) {
      if (!ref) continue;

      const image = await this.imageLoader.load(ref);
      if (!image) continue;

      const size = decodedBase64ByteLength(image.base64);
      if (size > budgetRemaining) continue;
      budgetRemaining -= size;

      content.push({ type: 'text', text: `${label} image:` });
      content.push({ type: 'image', mediaType: image.mediaType, base64: image.base64 });
    }

    return content;
  }
}
