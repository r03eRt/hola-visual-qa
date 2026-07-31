import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: npm run feature:new -- <feature-slug>");
  process.exit(1);
}

const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
if (!slug) throw new Error("Feature slug is empty after normalization");

const dir = join("docs", "features", slug);
mkdirSync(dir, { recursive: true });
const specPath = join(dir, "SPEC.md");
if (!existsSync(specPath)) {
  writeFileSync(specPath, `# Feature: ${slug}\n\n## Goal\n\n## Context and linked canonical specs\n\n## Non-goals\n\n## Proposed interfaces and files\n\n## Acceptance criteria\n\n- [ ] \n\n## Test plan\n\n## Security/privacy impact\n\n## Baseline impact\n\n## Dependencies and risks\n\n## Handover notes\n`);
}

try {
  execFileSync("git", ["switch", "-c", `feature/${slug}`], { stdio: "inherit" });
} catch {
  console.warn(`Could not create branch automatically. Use: git switch -c feature/${slug}`);
}
console.log(`Feature specification: ${specPath}`);
