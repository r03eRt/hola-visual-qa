// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "reports",
      "test-results",
      "blob-report",
      "playwright/",
      "dist",
    ],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.{js,mjs,ts}", "*.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
);
