import { logger } from "../lib/logger";
import { sendMessage, markAsRead } from "./whatsapp-api";
import { config } from "../lib/config";
import { generateReply } from "./llm";

export interface IncomingTextMessage {
  type: "text";
  from: string;
  messageId: string;
  body: string;
  timestamp: string;
}

export interface IncomingMediaMessage {
  type: "image" | "audio" | "video" | "document" | "sticker";
  from: string;
  messageId: string;
  mediaId: string;
  caption?: string;
  mimeType?: string;
  timestamp: string;
}

export interface IncomingInteractiveReply {
  type: "interactive";
  from: string;
  messageId: string;
  replyId: string;
  replyTitle: string;
  timestamp: string;
}

export interface IncomingLocationMessage {
  type: "location";
  from: string;
  messageId: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  timestamp: string;
}

export type IncomingMessage =
  | IncomingTextMessage
  | IncomingMediaMessage
  | IncomingInteractiveReply
  | IncomingLocationMessage;

async function reply(to: string, body: string): Promise<void> {
  await sendMessage(
    { type: "text", to, body },
    config.whatsapp.phoneNumberId,
    config.whatsapp.token,
    config.whatsapp.apiVersion,
  );
}

async function handleTextMessage(message: IncomingTextMessage): Promise<void> {
  const { from, messageId, body } = message;

  logger.info({ from, messageId }, "Balkao: processing text message via LLM");

  try {
    const response = await generateReply(body);
    await reply(from, response.content);
  } catch (err) {
    logger.error({ err, from, messageId }, "LLM generation failed");
    await reply(
      from,
      "Desculpe, estou com uma instabilidade no momento. Tente novamente em instantes. 🙏",
    );
  }
}

async function handleInteractiveReply(message: IncomingInteractiveReply): Promise<void> {
  const { from, messageId, replyId, replyTitle } = message;

  logger.info({ from, messageId, replyId }, "Balkao: processing interactive reply via LLM");

  try {
    const response = await generateReply(`Usuário selecionou a opção: "${replyTitle}"`);
    await reply(from, response.content);
  } catch (err) {
    logger.error({ err, from, messageId }, "LLM generation failed for interactive reply");
    await reply(from, "Entendido! Como posso te ajudar?");
  }
}

async function handleMediaMessage(message: IncomingMediaMessage): Promise<void> {
  const { from, type } = message;

  const mediaLabels: Record<string, string> = {
    image: "imagem",
    audio: "áudio",
    video: "vídeo",
    document: "documento",
    sticker: "figurinha",
  };

  await reply(
    from,
    `Recebi seu ${mediaLabels[type] ?? type}! No momento só consigo processar mensagens de texto. Como posso te ajudar? 😊`,
  );
}

async function handleLocationMessage(message: IncomingLocationMessage): Promise<void> {
  const { from, latitude, longitude, name } = message;

  const locationName = name ? `*${name}*` : "essa localização";

  try {
    const response = await generateReply(
      `Usuário enviou a localização ${locationName} (lat: ${latitude}, lon: ${longitude}). Confirme o recebimento de forma amigável.`,
    );
    await reply(from, response.content);
  } catch {
    await reply(from, `📍 Recebi ${locationName}! Como posso te ajudar com isso?`);
  }
}

export async function processMessage(message: IncomingMessage): Promise<void> {
  try {
    await markAsRead(
      message.messageId,
      config.whatsapp.phoneNumberId,
      config.whatsapp.token,
      config.whatsapp.apiVersion,
    );
  } catch (err) {
    logger.warn({ err, messageId: message.messageId }, "Failed to mark message as read");
  }

  switch (message.type) {
    case "text":
      await handleTextMessage(message);
      break;
    case "interactive":
      await handleInteractiveReply(message);
      break;
    case "image":
    case "audio":
    case "video":
    case "document":
    case "sticker":
      await handleMediaMessage(message);
      break;
    case "location":
      await handleLocationMessage(message);
      break;
    default:
      logger.warn({ message }, "Balkao: unhandled message type");
  }
}
