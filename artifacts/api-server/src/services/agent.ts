import { logger } from "../lib/logger";
import { sendMessage, markAsRead } from "./whatsapp-api";
import { config } from "../lib/config";
import { routeMessage, type AgentContext } from "../lib/agents";

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

function toAgentContext(message: IncomingMessage): AgentContext {
  const base = {
    from: message.from,
    messageId: message.messageId,
    timestamp: message.timestamp,
    metadata: {},
  };

  switch (message.type) {
    case "text":
      return { ...base, messageType: "text", text: message.body };

    case "interactive":
      return {
        ...base,
        messageType: "interactive",
        interactiveReplyId: message.replyId,
        interactiveReplyTitle: message.replyTitle,
      };

    case "location":
      return {
        ...base,
        messageType: "location",
        location: {
          latitude: message.latitude,
          longitude: message.longitude,
          name: message.name,
          address: message.address,
        },
      };

    default:
      return {
        ...base,
        messageType: message.type,
        mediaId: message.mediaId,
        mediaMimeType: message.mimeType,
        mediaCaption: message.caption,
      };
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

  const context = toAgentContext(message);
  const result = await routeMessage(context);

  if (result.handled && result.reply) {
    await sendMessage(
      { type: "text", to: message.from, body: result.reply },
      config.whatsapp.phoneNumberId,
      config.whatsapp.token,
      config.whatsapp.apiVersion,
    );
  } else if (!result.handled) {
    logger.warn({ from: message.from, messageId: message.messageId }, "Message was not handled by any agent");
  }
}
