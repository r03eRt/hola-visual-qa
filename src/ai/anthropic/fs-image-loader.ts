import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { ImageLoader } from './image-port.js';

/**
 * Real, fs-backed `ImageLoader` used only by `src/ai/factory.ts`. Never
 * imported by `src/ai/anthropic/provider.ts` tests directly — the provider
 * only depends on the `ImageLoader` port so its tests stay hermetic.
 *
 * Defence-in-depth: artifact refs are internal/trusted today, but since this
 * loader's bytes are base64-encoded and sent to an external API, it refuses
 * any absolute path or `..` traversal segment before touching the filesystem
 * so a future untrusted ref can never exfiltrate an out-of-tree file.
 */
function hasUnsafePath(ref: string): boolean {
  if (isAbsolute(ref) || /^[A-Za-z]:[\\/]/.test(ref)) return true;
  return ref.split(/[\\/]/).includes('..');
}

export class FsImageLoader implements ImageLoader {
  async load(ref: string): Promise<{ base64: string; mediaType: string } | null> {
    if (hasUnsafePath(ref)) return null;
    try {
      const buffer = await readFile(ref);
      return { base64: buffer.toString('base64'), mediaType: 'image/png' };
    } catch {
      return null;
    }
  }
}
