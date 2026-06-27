import OpenAI from "openai";
import { logger } from "../../logger";
import type { LLMMessage, LLMOptions, LLMProvider, LLMResponse } from "../types";

function createClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing required environment variable: OPENAI_API_KEY");
  }
  return new OpenAI({ apiKey });
}

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  readonly defaultModel = "gpt-4o-mini";

  private client: OpenAI;

  constructor() {
    this.client = createClient();
  }

  async chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const model = options?.model ?? this.defaultModel;
    const maxTokens = options?.maxTokens ?? 1024;

    const fullMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (options?.systemPrompt) {
      fullMessages.push({ role: "system", content: options.systemPrompt });
    }

    for (const msg of messages) {
      fullMessages.push({ role: msg.role, content: msg.content });
    }

    logger.debug({ model, messageCount: fullMessages.length }, "OpenAI: sending chat request");

    const completion = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: fullMessages,
    });

    const choice = completion.choices[0];
    const content = choice?.message?.content ?? "";

    return {
      content,
      provider: this.name,
      model,
      usage: completion.usage
        ? {
            promptTokens: completion.usage.prompt_tokens,
            completionTokens: completion.usage.completion_tokens,
            totalTokens: completion.usage.total_tokens,
          }
        : undefined,
    };
  }
}
