import type { ToolParametersSchema, ToolCallRequest } from "../tools/types";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCallRequest[];
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
}

export interface LLMOptions {
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  tools?: LLMTool[];
}

export interface LLMResponse {
  content: string;
  provider: string;
  model: string;
  toolCalls?: ToolCallRequest[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  readonly name: string;
  readonly defaultModel: string;
  chat(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
}
