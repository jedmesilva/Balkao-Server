import { createHmac, timingSafeEqual } from "crypto";
import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";

/**
 * Pluggy signs webhook requests with HMAC-SHA256 of the raw body using the
 * clientSecret. The signature arrives in the `pluggy-request-signature` header.
 *
 * Reference: https://docs.pluggy.ai/docs/webhooks#security
 *
 * If PLUGGY_CLIENT_SECRET is not set (misconfiguration) we fail closed.
 * If the env var PLUGGY_WEBHOOK_SKIP_SIGNATURE=true is set, verification is
 * skipped — use ONLY in local development / sandbox testing where Pluggy cannot
 * reach the server and you need to test with forged payloads.
 */
export function verifyPluggySignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env.PLUGGY_WEBHOOK_SKIP_SIGNATURE === "true") {
    logger.warn("Pluggy webhook signature verification is DISABLED (dev/sandbox mode)");
    next();
    return;
  }

  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientSecret) {
    logger.error("PLUGGY_CLIENT_SECRET is not configured — cannot verify webhook signature");
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  const signature = req.headers["pluggy-request-signature"];
  if (!signature || typeof signature !== "string") {
    logger.warn({ headers: Object.keys(req.headers) }, "Missing pluggy-request-signature header");
    res.status(401).json({ error: "Missing Pluggy webhook signature" });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.warn("Raw body not available for Pluggy signature verification");
    res.status(400).json({ error: "Cannot verify signature" });
    return;
  }

  const expected = createHmac("sha256", clientSecret).update(rawBody).digest("hex");

  try {
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      sigBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      logger.warn({ received: signature }, "Invalid Pluggy webhook signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  } catch {
    logger.warn("Pluggy signature comparison failed");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  next();
}
