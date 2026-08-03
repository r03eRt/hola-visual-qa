/**
 * The ONLY impure layer of the custom HTML report (SPEC-009 /
 * docs/features/custom-html-report/SPEC.md). Renders the model with the pure
 * `renderHtmlReport` and writes the string via an injectable `writeFile` port
 * so unit tests never touch the real filesystem.
 */

import { writeFile as nodeWriteFile } from 'node:fs/promises';
import type { ReportModel } from './report-model.js';
import { renderHtmlReport } from './render.js';

export interface WriteHtmlReportDeps {
  writeFile?: (path: string, data: string) => Promise<void>;
}

async function defaultWriteFile(path: string, data: string): Promise<void> {
  await nodeWriteFile(path, data, 'utf8');
}

export async function writeHtmlReport(
  model: ReportModel,
  outPath: string,
  deps: WriteHtmlReportDeps = {}
): Promise<void> {
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const html = renderHtmlReport(model);
  await writeFile(outPath, html);
}
