import { logger } from "../lib/logger";
import { sendMessage, markAsRead } from "./whatsapp-api";
import { config } from "../lib/config";

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

async function handleTextMessage(message: IncomingTextMessage): Promise<void> {
  const { from, messageId, body } = message;
  const lowerBody = body.trim().toLowerCase();

  logger.info({ from, messageId, body }, "Balkao: processing text message");

  if (lowerBody === "oi" || lowerBody === "olá" || lowerBody === "ola" || lowerBody === "hello" || lowerBody === "hi") {
    await sendMessage(
      {
        type: "text",
        to: from,
        body: `Olá! 👋 Sou o *Balkao*, seu assistente virtual. Como posso te ajudar hoje?`,
      },
      config.whatsapp.phoneNumberId,
      config.whatsapp.token,
      config.whatsapp.apiVersion,
    );
    return;
  }

  if (lowerBody === "ajuda" || lowerBody === "help" || lowerBody === "menu") {
    await sendMessage(
      {
        type: "interactive_buttons",
        to: from,
        header: "Balkao — Menu de Ajuda",
        body: "Selecione uma das opções abaixo para continuar:",
        buttons: [
          { id: "info", title: "ℹ️ Informações" },
          { id: "contact", title: "📞 Falar com humano" },
          { id: "status", title: "📋 Status" },
        ],
        footer: "Balkao v1.0",
      },
      config.whatsapp.phoneNumberId,
      config.whatsapp.token,
      config.whatsapp.apiVersion,
    );
    return;
  }

  await sendMessage(
    {
      type: "text",
      to: from,
      body: `Recebi sua mensagem: _"${body}"_\n\nEnvie *ajuda* para ver as opções disponíveis.`,
    },
    config.whatsapp.phoneNumberId,
    config.whatsapp.token,
    config.whatsapp.apiVersion,
  );
}

async function handleInteractiveReply(message: IncomingInteractiveReply): Promise<void> {
  const { from, messageId, replyId } = message;

  logger.info({ from, messageId, replyId }, "Balkao: processing interactive reply");

  if (replyId === "info") {
    await sendMessage(
      {
        type: "text",
        to: from,
        body: `*Balkao* é um agente de atendimento automatizado via WhatsApp.\n\nPowered by Meta WhatsApp Business API.`,
      },
      config.whatsapp.phoneNumberId,
      config.whatsapp.token,
      config.whatsapp.apiVersion,
    );
    return;
  }

  if (replyId === "contact") {
    await sendMessage(
      {
        type: "text",
        to: from,
        body: `Entendido! Um de nossos atendentes entrará em contato em breve. ⏳`,
      },
      config.whatsapp.phoneNumberId,
      config.whatsapp.token,
      config.whatsapp.apiVersion,
    );
    return;
  }

  if (replyId === "status") {
    await sendMessage(
      {
        type: "text",
        to: from,
        body: `✅ *Status do sistema*: Operando normalmente.\n🤖 Balkao está ativo e pronto para atender.`,
      },
      config.whatsapp.phoneNumberId,
      config.whatsapp.token,
      config.whatsapp.apiVersion,
    );
    return;
  }

  await sendMessage(
    {
      type: "text",
      to: from,
      body: `Opção não reconhecida. Envie *ajuda* para ver o menu.`,
    },
    config.whatsapp.phoneNumberId,
    config.whatsapp.token,
    config.whatsapp.apiVersion,
  );
}

async function handleMediaMessage(message: IncomingMediaMessage): Promise<void> {
  const { from, messageId, type } = message;

  logger.info({ from, messageId, type }, "Balkao: received media message");

  const mediaLabels: Record<string, string> = {
    image: "imagem",
    audio: "áudio",
    video: "vídeo",
    document: "documento",
    sticker: "figurinha",
  };

  await sendMessage(
    {
      type: "text",
      to: from,
      body: `Recebi seu ${mediaLabels[type] ?? type}! No momento só consigo processar mensagens de texto. Envie *ajuda* para ver o menu.`,
    },
    config.whatsapp.phoneNumberId,
    config.whatsapp.token,
    config.whatsapp.apiVersion,
  );
}

async function handleLocationMessage(message: IncomingLocationMessage): Promise<void> {
  const { from, messageId, latitude, longitude, name } = message;

  logger.info({ from, messageId, latitude, longitude }, "Balkao: received location");

  const locationName = name ? `*${name}*` : "essa localização";
  await sendMessage(
    {
      type: "text",
      to: from,
      body: `📍 Recebi ${locationName}!\n\nCoordenadas: ${latitude}, ${longitude}`,
    },
    config.whatsapp.phoneNumberId,
    config.whatsapp.token,
    config.whatsapp.apiVersion,
  );
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
