/**
 * Injected image byte source for the Anthropic provider (ADR-003). Keeps
 * `src/ai/anthropic/provider.ts` and its unit tests free of direct fs I/O;
 * `src/ai/anthropic/fs-image-loader.ts` is the real, fs-backed
 * implementation used only by `src/ai/factory.ts`.
 */
export interface ImageLoader {
  load(ref: string): Promise<{ base64: string; mediaType: string } | null>;
}
