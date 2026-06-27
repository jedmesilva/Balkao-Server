import { logger } from "../lib/logger";

const BASE_URL = "https://graph.facebook.com";

export interface TextMessage {
  type: "text";
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface TemplateMessage {
  type: "template";
  to: string;
  templateName: string;
  languageCode: string;
  components?: unknown[];
}

export interface InteractiveButtonMessage {
  type: "interactive_buttons";
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  header?: string;
  footer?: string;
}

export interface MediaMessage {
  type: "image" | "document" | "audio" | "video";
  to: string;
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
}

export type OutgoingMessage =
  | TextMessage
  | TemplateMessage
  | InteractiveButtonMessage
  | MediaMessage;

function buildPayload(message: OutgoingMessage): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: message.to };

  if (message.type === "text") {
    return {
      ...base,
      type: "text",
      text: { body: message.body, preview_url: message.previewUrl ?? false },
    };
  }

  if (message.type === "template") {
    return {
      ...base,
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        components: message.components ?? [],
      },
    };
  }

  if (message.type === "interactive_buttons") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        ...(message.header ? { header: { type: "text", text: message.header } } : {}),
        body: { text: message.body },
        ...(message.footer ? { footer: { text: message.footer } } : {}),
        action: {
          buttons: message.buttons.map((btn) => ({
            type: "reply",
            reply: { id: btn.id, title: btn.title },
          })),
        },
      },
    };
  }

  const mediaType = message.type;
  const mediaObj: Record<string, unknown> = {};
  if (message.mediaId) mediaObj.id = message.mediaId;
  else if (message.mediaUrl) mediaObj.link = message.mediaUrl;
  if (message.caption) mediaObj.caption = message.caption;
  if (message.filename) mediaObj.filename = message.filename;

  return { ...base, type: mediaType, [mediaType]: mediaObj };
}

export async function sendMessage(
  message: OutgoingMessage,
  phoneNumberId: string,
  token: string,
  apiVersion: string,
): Promise<{ messageId: string }> {
  const url = `${BASE_URL}/${apiVersion}/${phoneNumberId}/messages`;
  const payload = buildPayload(message);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error, to: message.to }, "WhatsApp API error");
    throw new Error(`WhatsApp API error ${response.status}: ${error}`);
  }

  const data = (await response.json()) as { messages?: Array<{ id: string }> };
  const messageId = data.messages?.[0]?.id ?? "unknown";
  logger.info({ messageId, to: message.to, type: message.type }, "Message sent");
  return { messageId };
}

export async function markAsRead(
  messageId: string,
  phoneNumberId: string,
  token: string,
  apiVersion: string,
): Promise<void> {
  const url = `${BASE_URL}/${apiVersion}/${phoneNumberId}/messages`;
  const payload = { messaging_product: "whatsapp", status: "read", message_id: messageId };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.warn({ status: response.status, error, messageId }, "Failed to mark message as read");
  }
}

export async function getMediaUrl(
  mediaId: string,
  token: string,
  apiVersion: string,
): Promise<string | null> {
  const url = `${BASE_URL}/${apiVersion}/${mediaId}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    logger.warn({ mediaId, status: response.status }, "Failed to get media URL");
    return null;
  }

  const data = (await response.json()) as { url?: string };
  return data.url ?? null;
}
