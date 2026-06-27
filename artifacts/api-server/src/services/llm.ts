import { getDefaultProvider, type LLMMessage, type LLMResponse, type LLMTool } from "../lib/llm";
import { getTools } from "../lib/tools";
import { executeTools } from "../lib/tools/executor";
import { logger } from "../lib/logger";

const BALKAO_SYSTEM_PROMPT = `Você é o Balkao, um assistente virtual de atendimento via WhatsApp.

Suas características:
- Tom amigável, direto e profissional
- Respostas concisas e adaptadas ao formato WhatsApp (sem markdown extenso, use *negrito* e _itálico_ com moderação)
- Responde sempre em português brasileiro, a menos que o usuário escreva em outro idioma
- Nunca inventa informações que não conhece — prefere dizer que não sabe e oferecer ajuda alternativa
- Quando uma ferramenta está disponível e é relevante para a pergunta do usuário, use-a

Limitações que você deve comunicar com transparência:
- Você é um agente automatizado e pode transferir para um humano quando necessário
- Não tem acesso a sistemas externos além das ferramentas disponíveis

Mantenha as respostas curtas — idealmente até 3 parágrafos. Evite listas longas.`;

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export async function generateReply(
  userMessage: string,
  history: ConversationMessage[] = [],
  providerOverride?: string,
): Promise<LLMResponse> {
  const provider = providerOverride
    ? (await import("../lib/llm")).getProvider(providerOverride)
    : getDefaultProvider();

  const availableTools = getTools();
  const llmTools: LLMTool[] = availableTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const messages: LLMMessage[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
  ];

  logger.info(
    { provider: provider.name, model: provider.defaultModel, tools: llmTools.map((t) => t.name) },
    "LLM: generating reply",
  );

  let response = await provider.chat(messages, {
    systemPrompt: BALKAO_SYSTEM_PROMPT,
    maxTokens: 1024,
    tools: llmTools.length > 0 ? llmTools : undefined,
  });

  let iterations = 0;
  const maxIterations = 5;

  while (response.toolCalls && response.toolCalls.length > 0 && iterations < maxIterations) {
    iterations++;
    logger.info(
      { toolCalls: response.toolCalls.map((tc) => tc.name), iteration: iterations },
      "LLM: executing tool calls",
    );

    const results = await executeTools(response.toolCalls);

    messages.push({ role: "assistant", content: response.content || "", toolCalls: response.toolCalls });

    for (const result of results) {
      const content = result.error
        ? `Error: ${result.error}`
        : JSON.stringify(result.result);
      messages.push({
        role: "tool",
        content,
        toolCallId: result.id,
        toolName: result.name,
      });
    }

    response = await provider.chat(messages, {
      systemPrompt: BALKAO_SYSTEM_PROMPT,
      maxTokens: 1024,
      tools: llmTools.length > 0 ? llmTools : undefined,
    });
  }

  logger.info(
    { provider: response.provider, model: response.model, usage: response.usage, iterations },
    "LLM: reply generated",
  );

  return response;
}
