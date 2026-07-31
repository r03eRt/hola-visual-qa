import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Intake helper: classify a request and open the matching ticket.
// See docs/REQUEST_INTAKE.md.

const TYPES = ["feature", "bug", "docs", "chore", "spike", "security"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    'Usage: npm run ticket:new -- --type <feature|bug|docs|chore|spike|security> \\\n' +
      '  --title "Short imperative title" [--slug <slug>] [--body "..."] [--dry-run]'
  );
  process.exit(message ? 1 : 0);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) usage();

const type = args.type;
if (!type || !TYPES.includes(type)) usage(`--type must be one of: ${TYPES.join(", ")}`);

const title = typeof args.title === "string" ? args.title.trim() : "";
if (!title) usage("--title is required");

const body = typeof args.body === "string" ? args.body : "";
const dryRun = Boolean(args["dry-run"]);

const labels = [`type:${type}`];
if (type === "feature") labels.push("needs-spec");

let slug;
if (type === "feature") {
  slug = slugify(args.slug || title);
  if (!slug) usage("feature slug is empty after normalization");
}

// 1. Create the GitHub Issue (the ticket).
const ghArgs = ["issue", "create", "--title", title, "--label", labels.join(",")];
if (body) ghArgs.push("--body", body);
else ghArgs.push("--body", `Created via intake helper. Type: ${type}. Complete details before implementation.`);

if (dryRun) {
  console.log(`[dry-run] gh ${ghArgs.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`);
} else {
  try {
    const out = execFileSync("gh", ghArgs, { encoding: "utf8" });
    console.log(out.trim());
  } catch (error) {
    console.error("Failed to create GitHub issue. Is `gh` authenticated? Falling back to manual command:");
    console.error(`gh ${ghArgs.join(" ")}`);
    process.exit(1);
  }
}

// 2. For features, scaffold the local spec and branch.
if (type === "feature") {
  const dir = join("docs", "features", slug);
  const specPath = join(dir, "SPEC.md");
  if (dryRun) {
    console.log(`[dry-run] would scaffold ${specPath} and branch feature/${slug}`);
  } else {
    mkdirSync(dir, { recursive: true });
    if (!existsSync(specPath)) {
      writeFileSync(
        specPath,
        `# Feature: ${slug}\n\n## Goal\n\n## Context and linked canonical specs\n\n## Non-goals\n\n## Proposed interfaces and files\n\n## Acceptance criteria\n\n- [ ] \n\n## Test plan\n\n## Security/privacy impact\n\n## Baseline impact\n\n## Dependencies and risks\n\n## Handover notes\n`
      );
      console.log(`Feature specification: ${specPath}`);
    } else {
      console.log(`Feature specification already exists: ${specPath}`);
    }
    try {
      execFileSync("git", ["switch", "-c", `feature/${slug}`], { stdio: "inherit" });
    } catch {
      console.warn(`Could not create branch automatically. Use: git switch -c feature/${slug}`);
    }
  }
  console.log(`Remember to add a line for feature/${slug} in docs/roadmap/IMPLEMENTATION_PLAN.md.`);
}
