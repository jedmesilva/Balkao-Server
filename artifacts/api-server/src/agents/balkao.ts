import type { Agent, AgentContext, AgentResult } from "../lib/agents";
import { generateReply } from "../services/llm";
import { logger } from "../lib/logger";

export class BalkaoAgent implements Agent {
  readonly name = "balkao";
  readonly description = "Agente principal Balkao — responde qualquer mensagem via LLM (fallback)";
  readonly priority = 0;

  canHandle(_context: AgentContext): boolean {
    return true;
  }

  async process(context: AgentContext): Promise<AgentResult> {
    const { from, messageId, messageType } = context;

    if (
      messageType === "image" ||
      messageType === "audio" ||
      messageType === "video" ||
      messageType === "document" ||
      messageType === "sticker"
    ) {
      const labels: Record<string, string> = {
        image: "imagem",
        audio: "áudio",
        video: "vídeo",
        document: "documento",
        sticker: "figurinha",
      };
      return {
        handled: true,
        reply: `Recebi seu ${labels[messageType] ?? messageType}! No momento só consigo processar mensagens de texto. Como posso te ajudar? 😊`,
      };
    }

    let userMessage: string;

    if (messageType === "text" && context.text) {
      userMessage = context.text;
    } else if (messageType === "interactive" && context.interactiveReplyTitle) {
      userMessage = `Usuário selecionou a opção: "${context.interactiveReplyTitle}"`;
    } else if (messageType === "location" && context.location) {
      const { latitude, longitude, name } = context.location;
      const label = name ? `*${name}*` : "uma localização";
      userMessage = `Usuário enviou ${label} (lat: ${latitude}, lon: ${longitude}). Confirme o recebimento de forma amigável.`;
    } else {
      return { handled: false };
    }

    logger.info({ from, messageId, agent: this.name }, "Balkao agent processing via LLM");

    try {
      const response = await generateReply(userMessage);
      return { handled: true, reply: response.content };
    } catch (err) {
      logger.error({ err, from, messageId }, "Balkao agent LLM call failed");
      return {
        handled: true,
        reply: "Desculpe, estou com uma instabilidade no momento. Tente novamente em instantes. 🙏",
      };
    }
  }
}
