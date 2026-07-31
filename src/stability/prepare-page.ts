import type { Page } from '@playwright/test';

export async function preparePage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.addStyleTag({ content: `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    video, [data-visual-ignore], [data-testid="dynamic-clock"] { visibility: hidden !important; }
  ` });
  await page.waitForTimeout(500);
}
