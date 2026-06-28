import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, identityVerificationsTable } from "@workspace/db";
import {
  createConnectToken,
  getItem,
  getIdentity,
  deleteItem,
  documentsMatch,
  normalizeDocument,
} from "../services/pluggy";
import { logger } from "../lib/logger";
import { z } from "zod/v4";

const router: IRouter = Router();

const StartVerificationBody = z.object({
  phoneNumber: z.string().min(1),
  declaredDocument: z.string().min(1),
  documentType: z.enum(["CPF", "CNPJ"]),
  webhookUrl: z.string().url().optional(),
});

const VerifyIdentityBody = z.object({
  phoneNumber: z.string().min(1),
  itemId: z.string().uuid(),
});

const WebhookBody = z.object({
  event: z.string(),
  id: z.string().optional(),
  data: z.record(z.unknown()).optional(),
}).passthrough();

router.post("/pluggy/connect-token", async (req: Request, res: Response): Promise<void> => {
  const parsed = StartVerificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { phoneNumber, declaredDocument, documentType, webhookUrl } = parsed.data;
  const normalizedDoc = normalizeDocument(declaredDocument);
  const clientUserId = `${phoneNumber}|${documentType}|${normalizedDoc}`;

  try {
    const existing = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber))
      .limit(1);

    const record = existing[0];
    const itemId = record?.pluggyItemId ?? undefined;

    const connectToken = await createConnectToken({
      clientUserId,
      webhookUrl,
      itemId,
    });

    if (record) {
      await db
        .update(identityVerificationsTable)
        .set({
          status: "pluggy_widget_opened",
          declaredDocument: normalizedDoc,
          documentType,
          pluggyClientUserId: clientUserId,
          updatedAt: new Date(),
        })
        .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
    } else {
      await db.insert(identityVerificationsTable).values({
        phoneNumber,
        declaredDocument: normalizedDoc,
        documentType,
        status: "pluggy_widget_opened",
        pluggyClientUserId: clientUserId,
      });
    }

    req.log.info({ phoneNumber, documentType }, "Pluggy connect token issued");
    res.json({ connectToken });
  } catch (err) {
    req.log.error({ err, phoneNumber }, "Failed to create Pluggy connect token");
    res.status(500).json({ error: "Failed to create connect token" });
  }
});

router.post("/pluggy/verify", async (req: Request, res: Response): Promise<void> => {
  const parsed = VerifyIdentityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { phoneNumber, itemId } = parsed.data;

  try {
    const existing = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber))
      .limit(1);

    const record = existing[0];
    if (!record) {
      res.status(404).json({ error: "Verification record not found. Call /pluggy/connect-token first." });
      return;
    }

    const item = await getItem(itemId);

    if (!item.connector.isOpenFinance) {
      await db
        .update(identityVerificationsTable)
        .set({ status: "identity_mismatch", updatedAt: new Date() })
        .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
      res.status(422).json({
        error: "Connector is not Open Finance regulated. Only Open Finance connectors are accepted.",
        status: "identity_mismatch",
      });
      return;
    }

    if (item.executionStatus === "WAITING_USER_INPUT" || item.executionStatus === "LOGIN_IN_PROGRESS") {
      await db
        .update(identityVerificationsTable)
        .set({
          status: "pending_multi_approval",
          pluggyItemId: itemId,
          updatedAt: new Date(),
        })
        .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
      res.status(202).json({
        status: "pending_multi_approval",
        message: "Connection pending authorization. Please check back after all parties have approved.",
      });
      return;
    }

    if (item.executionStatus !== "SUCCESS") {
      res.status(422).json({
        error: `Item not ready for identity fetch (executionStatus: ${item.executionStatus})`,
        executionStatus: item.executionStatus,
        itemError: item.error,
      });
      return;
    }

    const identity = await getIdentity(itemId);

    const returnedDocument = identity.document;
    const now = new Date();

    if (!documentsMatch(record.declaredDocument, returnedDocument)) {
      await db
        .update(identityVerificationsTable)
        .set({
          status: "identity_mismatch",
          pluggyItemId: itemId,
          updatedAt: now,
        })
        .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));

      req.log.warn(
        { phoneNumber, documentType: record.documentType },
        "Identity mismatch: declared document does not match Pluggy identity",
      );

      res.status(422).json({
        status: "identity_mismatch",
        error: "The document returned by the bank does not match the declared document. Please connect the correct bank account.",
      });
      return;
    }

    await db
      .update(identityVerificationsTable)
      .set({
        status: "identity_verified",
        pluggyItemId: itemId,
        verifiedAt: now,
        lastBankReauthAt: now,
        updatedAt: now,
      })
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));

    req.log.info(
      { phoneNumber, documentType: record.documentType, itemId },
      "Identity verified successfully via Pluggy",
    );

    res.json({
      status: "identity_verified",
      verifiedAt: now.toISOString(),
      fullName: identity.fullName,
      documentType: record.documentType,
    });
  } catch (err) {
    req.log.error({ err, phoneNumber, itemId }, "Pluggy identity verification failed");
    res.status(500).json({ error: "Identity verification failed" });
  }
});

router.get("/pluggy/status/:phoneNumber", async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber } = req.params;

  try {
    const existing = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber))
      .limit(1);

    const record = existing[0];
    if (!record) {
      res.status(404).json({ error: "No verification record found for this phone number" });
      return;
    }

    res.json({
      phoneNumber: record.phoneNumber,
      status: record.status,
      documentType: record.documentType,
      verifiedAt: record.verifiedAt,
      lastSmsVerificationAt: record.lastSmsVerificationAt,
      lastBankReauthAt: record.lastBankReauthAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    req.log.error({ err, phoneNumber }, "Failed to fetch pluggy status");
    res.status(500).json({ error: "Failed to fetch verification status" });
  }
});

router.delete("/pluggy/revoke/:phoneNumber", async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber } = req.params;

  try {
    const existing = await db
      .select()
      .from(identityVerificationsTable)
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber))
      .limit(1);

    const record = existing[0];
    if (!record) {
      res.status(404).json({ error: "No verification record found" });
      return;
    }

    if (record.pluggyItemId) {
      await deleteItem(record.pluggyItemId);
      req.log.info({ phoneNumber, itemId: record.pluggyItemId }, "Pluggy item revoked");
    }

    await db
      .update(identityVerificationsTable)
      .set({
        status: "pending_identity_verification",
        pluggyItemId: null,
        verifiedAt: null,
        lastBankReauthAt: null,
        updatedAt: new Date(),
      })
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));

    res.json({ message: "Verification revoked. User must re-verify." });
  } catch (err) {
    req.log.error({ err, phoneNumber }, "Failed to revoke Pluggy verification");
    res.status(500).json({ error: "Failed to revoke verification" });
  }
});

router.post("/pluggy/webhook", async (req: Request, res: Response): Promise<void> => {
  const parsed = WebhookBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid webhook payload" });
    return;
  }

  const payload = parsed.data;
  req.log.info({ event: payload.event }, "Received Pluggy webhook event");

  res.status(200).json({ received: true });

  try {
    const itemId = (payload.data as { itemId?: string })?.itemId ?? payload.id;
    if (!itemId) return;

    if (payload.event === "item/error" || payload.event === "item/login_error") {
      logger.warn({ itemId, event: payload.event }, "Pluggy item connection error via webhook");
    }

    if (payload.event === "item/updated" || payload.event === "item/created") {
      const existing = await db
        .select()
        .from(identityVerificationsTable)
        .where(eq(identityVerificationsTable.pluggyItemId, itemId))
        .limit(1);

      if (!existing[0]) return;

      const item = await getItem(itemId);
      if (item.executionStatus !== "SUCCESS") return;

      const record = existing[0];
      const identity = await getIdentity(itemId);

      const now = new Date();
      if (documentsMatch(record.declaredDocument, identity.document)) {
        await db
          .update(identityVerificationsTable)
          .set({
            status: "identity_verified",
            verifiedAt: now,
            lastBankReauthAt: now,
            updatedAt: now,
          })
          .where(eq(identityVerificationsTable.pluggyItemId, itemId));
        logger.info({ itemId, phoneNumber: record.phoneNumber }, "Identity auto-verified via webhook");
      } else {
        await db
          .update(identityVerificationsTable)
          .set({ status: "identity_mismatch", updatedAt: now })
          .where(eq(identityVerificationsTable.pluggyItemId, itemId));
        logger.warn({ itemId, phoneNumber: record.phoneNumber }, "Identity mismatch detected via webhook");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error processing Pluggy webhook event");
  }
});

export default router;
