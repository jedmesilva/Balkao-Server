import { createHmac, timingSafeEqual } from "crypto";
import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

export function verifyWhatsappSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    logger.error("WHATSAPP_APP_SECRET is not configured");
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const signature = req.headers["x-hub-signature-256"];
  if (!signature || typeof signature !== "string") {
    logger.warn("Missing X-Hub-Signature-256 header");
    res.status(401).json({ error: "Missing signature" });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.warn("Raw body not available for signature verification");
    res.status(400).json({ error: "Cannot verify signature" });
    return;
  }

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;

  try {
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      logger.warn({ received: signature }, "Invalid webhook signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  } catch {
    logger.warn("Signature comparison failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  next();
}
