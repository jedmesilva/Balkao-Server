import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { verifyWhatsappSignature } from "../middlewares/verify-whatsapp-signature";
import { processMessage, type IncomingMessage } from "../services/agent";

const router: IRouter = Router();

interface WebhookVerificationQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

router.get("/whatsapp/webhook", (req: Request, res: Response): void => {
  const query = req.query as WebhookVerificationQuery;
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    req.log.info("WhatsApp webhook verified successfully");
    res.status(200).send(challenge);
    return;
  }

  req.log.warn({ mode, token }, "WhatsApp webhook verification failed");
  res.status(403).json({ error: "Forbidden" });
});

router.post(
  "/whatsapp/webhook",
  verifyWhatsappSignature,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as WhatsAppWebhookPayload;

    if (body.object !== "whatsapp_business_account") {
      res.status(404).json({ error: "Not a WhatsApp Business Account event" });
      return;
    }

    res.status(200).json({ status: "ok" });

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;

        for (const message of value.messages) {
          const from = message.from;
          const messageId = message.id;
          const timestamp = message.timestamp;

          let parsed: IncomingMessage | null = null;

          if (message.type === "text" && message.text?.body) {
            parsed = {
              type: "text",
              from,
              messageId,
              timestamp,
              body: message.text.body,
            };
          } else if (
            (message.type === "image" ||
              message.type === "audio" ||
              message.type === "video" ||
              message.type === "document" ||
              message.type === "sticker") &&
            message[message.type]?.id
          ) {
            const mediaObj = message[message.type] as { id: string; caption?: string; mime_type?: string };
            parsed = {
              type: message.type as "image" | "audio" | "video" | "document" | "sticker",
              from,
              messageId,
              timestamp,
              mediaId: mediaObj.id,
              caption: mediaObj.caption,
              mimeType: mediaObj.mime_type,
            };
          } else if (
            message.type === "interactive" &&
            message.interactive?.type === "button_reply"
          ) {
            parsed = {
              type: "interactive",
              from,
              messageId,
              timestamp,
              replyId: message.interactive.button_reply.id,
              replyTitle: message.interactive.button_reply.title,
            };
          } else if (message.type === "location" && message.location) {
            parsed = {
              type: "location",
              from,
              messageId,
              timestamp,
              latitude: message.location.latitude,
              longitude: message.location.longitude,
              name: message.location.name,
              address: message.location.address,
            };
          } else {
            logger.info({ type: message.type, messageId }, "Unhandled message type, skipping");
            continue;
          }

          processMessage(parsed).catch((err: unknown) => {
            logger.error({ err, messageId, from }, "Agent failed to process message");
          });
        }
      }
    }
  },
);

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  audio?: { id: string; mime_type?: string };
  video?: { id: string; caption?: string; mime_type?: string };
  document?: { id: string; caption?: string; mime_type?: string; filename?: string };
  sticker?: { id: string; mime_type?: string };
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  interactive?: {
    type: string;
    button_reply: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  [key: string]: unknown;
}

interface WhatsAppWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: WhatsAppMessage[];
        statuses?: Array<{
          id: string;
          status: string;
          timestamp: string;
          recipient_id: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

export default router;
