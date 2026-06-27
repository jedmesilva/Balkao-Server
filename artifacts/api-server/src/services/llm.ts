import { getDefaultProvider, type LLMMessage, type LLMResponse } from "../lib/llm";
import { logger } from "../lib/logger";

const BALKAO_SYSTEM_PROMPT = `Você é o Balkao, um assistente virtual de atendimento via WhatsApp.

Suas características:
- Tom amigável, direto e profissional
- Respostas concisas e adaptadas ao formato WhatsApp (sem markdown extenso, use *negrito* e _itálico_ com moderação)
- Responde sempre em português brasileiro, a menos que o usuário escreva em outro idioma
- Nunca inventa informações que não conhece — prefere dizer que não sabe e oferecer ajuda alternativa

Limitações que você deve comunicar com transparência:
- Você é um agente automatizado e pode transferir para um humano quando necessário
- Não tem acesso a sistemas externos (pedidos, cadastros, etc.) por padrão

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

  const messages: LLMMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  messages.push({ role: "user", content: userMessage });

  logger.info(
    { provider: provider.name, model: provider.defaultModel, historyLength: history.length },
    "LLM: generating reply",
  );

  const response = await provider.chat(messages, {
    systemPrompt: BALKAO_SYSTEM_PROMPT,
    maxTokens: 1024,
  });

  logger.info(
    { provider: response.provider, model: response.model, usage: response.usage },
    "LLM: reply generated",
  );

  return response;
}
