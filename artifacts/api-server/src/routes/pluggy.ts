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

const router: IRouter = Router();

function isValidDocumentType(v: unknown): v is "CPF" | "CNPJ" {
  return v === "CPF" || v === "CNPJ";
}

function isUuid(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

router.post("/pluggy/connect-token", async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber, declaredDocument, documentType, webhookUrl } = req.body as Record<string, unknown>;

  if (!phoneNumber || typeof phoneNumber !== "string") {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }
  if (!declaredDocument || typeof declaredDocument !== "string") {
    res.status(400).json({ error: "declaredDocument is required" });
    return;
  }
  if (!isValidDocumentType(documentType)) {
    res.status(400).json({ error: "documentType must be 'CPF' or 'CNPJ'" });
    return;
  }
  if (webhookUrl !== undefined && typeof webhookUrl !== "string") {
    res.status(400).json({ error: "webhookUrl must be a string URL" });
    return;
  }

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
      webhookUrl: webhookUrl as string | undefined,
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
  const { phoneNumber, itemId } = req.body as Record<string, unknown>;

  if (!phoneNumber || typeof phoneNumber !== "string") {
    res.status(400).json({ error: "phoneNumber is required" });
    return;
  }
  if (!isUuid(itemId)) {
    res.status(400).json({ error: "itemId must be a valid UUID" });
    return;
  }

  const itemIdStr = itemId as string;

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

    const item = await getItem(itemIdStr);

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
          pluggyItemId: itemIdStr,
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

    const identity = await getIdentity(itemIdStr);
    const now = new Date();

    if (!documentsMatch(record.declaredDocument, identity.document)) {
      await db
        .update(identityVerificationsTable)
        .set({
          status: "identity_mismatch",
          pluggyItemId: itemIdStr,
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
        pluggyItemId: itemIdStr,
        verifiedAt: now,
        lastBankReauthAt: now,
        updatedAt: now,
      })
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));

    req.log.info(
      { phoneNumber, documentType: record.documentType, itemId: itemIdStr },
      "Identity verified successfully via Pluggy",
    );

    res.json({
      status: "identity_verified",
      verifiedAt: now.toISOString(),
      fullName: identity.fullName,
      documentType: record.documentType,
    });
  } catch (err) {
    req.log.error({ err, phoneNumber, itemId: itemIdStr }, "Pluggy identity verification failed");
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
  const body = req.body as Record<string, unknown>;
  const event = body.event;

  if (typeof event !== "string") {
    res.status(400).json({ error: "Invalid webhook payload: event is required" });
    return;
  }

  req.log.info({ event }, "Received Pluggy webhook event");
  res.status(200).json({ received: true });

  try {
    const data = body.data as Record<string, unknown> | undefined;
    const itemId = (data?.itemId as string | undefined) ?? (body.id as string | undefined);
    if (!itemId) return;

    if (event === "item/error" || event === "item/login_error") {
      logger.warn({ itemId, event }, "Pluggy item connection error via webhook");
    }

    if (event === "item/updated" || event === "item/created") {
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
          .set({ status: "identity_verified", verifiedAt: now, lastBankReauthAt: now, updatedAt: now })
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
