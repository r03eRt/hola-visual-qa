import type { Page, TestInfo } from '@playwright/test';

export function collectDiagnostics(page: Page, testInfo: TestInfo): void {
  page.on('console', async message => {
    if (message.type() === 'error') await testInfo.attach('console-error', { body: Buffer.from(message.text()), contentType: 'text/plain' });
  });
  page.on('pageerror', async error => {
    await testInfo.attach('page-error', { body: Buffer.from(error.stack ?? error.message), contentType: 'text/plain' });
  });
  page.on('requestfailed', async request => {
    const body = `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'Unknown error'}`;
    await testInfo.attach('failed-request', { body: Buffer.from(body), contentType: 'text/plain' });
  });
}
