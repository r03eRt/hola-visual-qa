import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  BASE_URL: z.string().url().default('https://example.com'),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_MODEL: z.string().optional(),
  AI_PROVIDER: z.enum(['anthropic', 'none']).default('anthropic'),
  ENABLE_AI_ANALYSIS: z.coerce.boolean().default(false),
  TEST_COUNTRY: z.string().default('ES'),
  CONSENT_COOKIE_NAME: z.string().default('consent_status'),
  CONSENT_COOKIE_DOMAIN: z.string().default('example.com')
});

export const env = schema.parse(process.env);
