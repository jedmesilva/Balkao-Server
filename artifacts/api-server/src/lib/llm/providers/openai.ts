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

function toOpenAIMessages(
  messages: LLMMessage[],
  systemPrompt?: string,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    result.push({ role: "system", content: systemPrompt });
  }

  for (const msg of messages) {
    if (msg.role === "tool") {
      result.push({
        role: "tool",
        tool_call_id: msg.toolCallId ?? "",
        content: msg.content,
      });
    } else if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length > 0) {
      result.push({
        role: "assistant",
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        })),
      });
    } else {
      result.push({ role: msg.role as "user" | "assistant" | "system", content: msg.content });
    }
  }

  return result;
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
    const openAIMessages = toOpenAIMessages(messages, options?.systemPrompt);

    const tools: OpenAI.Chat.ChatCompletionTool[] | undefined =
      options?.tools && options.tools.length > 0
        ? options.tools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters as unknown as Record<string, unknown>,
            },
          }))
        : undefined;

    logger.debug(
      { model, messageCount: openAIMessages.length, toolCount: tools?.length ?? 0 },
      "OpenAI: sending chat request",
    );

    const completion = await this.client.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages: openAIMessages,
      ...(tools ? { tools, tool_choice: "auto" } : {}),
    });

    const choice = completion.choices[0];
    const message = choice?.message;
    const content = message?.content ?? "";

    type FunctionToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
    const toolCalls =
      message?.tool_calls
        ?.filter((tc): tc is FunctionToolCall => tc.type === "function")
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        })) ?? undefined;

    return {
      content,
      provider: this.name,
      model,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
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
