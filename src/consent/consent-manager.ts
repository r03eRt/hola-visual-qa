import type { BrowserContext, Page } from '@playwright/test';
import { env } from '../config/env.js';
import type { ConsentMode } from '../scenarios/scenarios.js';

export async function setConsentCookie(context: BrowserContext, mode: ConsentMode): Promise<void> {
  await context.addCookies([{ name: env.CONSENT_COOKIE_NAME, value: mode, domain: env.CONSENT_COOKIE_DOMAIN, path: '/', secure: true, sameSite: 'Lax' }]);
}

export async function setConsentThroughUi(page: Page, mode: ConsentMode): Promise<void> {
  const matcher = mode === 'accepted' ? /accept|aceptar/i : /reject|rechazar/i;
  const button = page.getByRole('button', { name: matcher }).first();
  if (await button.isVisible().catch(() => false)) await button.click();
}
