import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import type { AiProvider, VisualAnalysisInput } from './provider.js';

export class AnthropicProvider implements AiProvider {
  private readonly client: Anthropic;

  constructor() {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required');
    if (!env.CLAUDE_MODEL) throw new Error('CLAUDE_MODEL is required; set a model available in your Anthropic account');
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }

  async analyzeVisualFailure(input: VisualAnalysisInput): Promise<string> {
    const content: Anthropic.MessageCreateParams['messages'][number]['content'] = [
      { type: 'text', text: `Analyze this deterministic visual test failure. Do not decide pass/fail. Explain likely UI regression, severity, affected area and useful debugging steps. Scenario: ${input.scenarioId}. Evidence: ${input.summary}` }
    ];
    for (const [label, data] of [['expected', input.expectedImageBase64], ['actual', input.actualImageBase64], ['diff', input.diffImageBase64]] as const) {
      if (data) {
        content.push({ type: 'text', text: `${label} image:` });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } });
      }
    }
    const response = await this.client.messages.create({ model: env.CLAUDE_MODEL, max_tokens: 1000, messages: [{ role: 'user', content }] });
    return response.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
  }
}
