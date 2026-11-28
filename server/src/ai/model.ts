// The one place that talks to the model provider. Everything else uses ModelClient,
// so tests can swap in a scripted model and the provider can change without touching the coordinator.
import Anthropic from '@anthropic-ai/sdk';

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type UserBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export type ChatTurn =
  | { role: 'user'; content: UserBlock[] }
  | { role: 'assistant'; content: AssistantBlock[] };

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: { type: 'object'; [key: string]: unknown };
}

export interface ModelRequest {
  system: string;
  tools: ToolSpec[];
  messages: ChatTurn[];
}

export interface ModelResponse {
  content: AssistantBlock[];
  stopReason: string;
}

export interface ModelClient {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

// Thrown for anything that means "the model could not answer": no key, network, provider error.
// The route turns it into a recoverable 503. Saved tickets are never touched by it.
export class AiUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export class AnthropicModel implements ModelClient {
  readonly name: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey: string; model?: string; timeoutMs?: number }) {
    this.name = opts.model ?? DEFAULT_MODEL;
    this.client = new Anthropic({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 30_000, maxRetries: 1 });
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    try {
      const res = await this.client.messages.create({
        model: this.name,
        max_tokens: 1024,
        system: request.system,
        tools: request.tools as Anthropic.Tool[],
        messages: request.messages as Anthropic.MessageParam[],
      });
      const content: AssistantBlock[] = [];
      for (const block of res.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'tool_use') content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
      }
      return { content, stopReason: res.stop_reason ?? 'end_turn' };
    } catch (err) {
      throw new AiUnavailableError('The model request failed.', err);
    }
  }
}

// Returns null when no key is set, so the server still starts and the assistant reports itself unavailable.
export function createModelFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return new AnthropicModel({ apiKey, model: env.RESOLVE_AI_MODEL?.trim() || DEFAULT_MODEL });
}
