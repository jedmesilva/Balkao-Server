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
import { verifyPluggySignature } from "../middlewares/verify-pluggy-signature";

const router: IRouter = Router();

function isValidDocumentType(v: unknown): v is "CPF" | "CNPJ" {
  return v === "CPF" || v === "CNPJ";
}

function isUuid(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

router.get("/pluggy/widget", async (req: Request, res: Response): Promise<void> => {
  const phoneNumber = req.query["phone"] as string | undefined;
  const isReturn = req.query["return"] === "1";

  if (!phoneNumber) {
    res.status(400).send("<h2>Parâmetro 'phone' ausente.</h2>");
    return;
  }

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "";

  const existing = await db
    .select()
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.phoneNumber, phoneNumber))
    .limit(1);

  const record = existing[0];
  if (!record) {
    res.status(404).send("<h2>Nenhum processo de verificação encontrado para este número. Inicie pelo WhatsApp.</h2>");
    return;
  }

  const commonStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 420px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.10);
    }
    .logo { font-size: 2rem; margin-bottom: 8px; }
    h1 { font-size: 1.3rem; color: #111; margin-bottom: 8px; }
    p { color: #555; font-size: 0.95rem; line-height: 1.5; margin-bottom: 20px; }
    .btn {
      display: block;
      background: #1a73e8;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 14px 28px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn:hover { background: #1557b0; }
    .status {
      margin-top: 20px;
      padding: 14px;
      border-radius: 10px;
      font-size: 0.95rem;
    }
    .status.success { background: #e6f4ea; color: #1e7e34; }
    .status.error   { background: #fce8e6; color: #c5221f; }
    .status.info    { background: #e8f0fe; color: #1a56db; }
    .lock { font-size: 0.8rem; color: #aaa; margin-top: 16px; }
    .spinner { display: inline-block; width: 18px; height: 18px; border: 3px solid rgba(255,255,255,.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (isReturn) {
    const statusNow = record.status;
    if (statusNow === "identity_verified") {
      res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Balkao — Verificado</title><style>${commonStyles}</style></head>
<body><div class="card">
  <div class="logo">✅</div>
  <h1>Identidade verificada!</h1>
  <p>Sua identidade foi confirmada com sucesso. Pode fechar esta aba e voltar ao WhatsApp para continuar.</p>
  <p class="lock">🔒 Seus dados bancários nunca são compartilhados com o Balkao</p>
</div></body></html>`);
      return;
    }

    const apiBase = `${baseUrl}/api`;
    res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Balkao — Verificando…</title><style>${commonStyles}</style></head>
<body><div class="card">
  <div class="logo">🏦</div>
  <h1>Verificando sua identidade…</h1>
  <div class="status info" id="statusBox">⏳ Aguardando confirmação do banco. Isso pode levar alguns segundos…</div>
  <p class="lock" style="margin-top:24px">🔒 Seus dados bancários nunca são compartilhados com o Balkao</p>
</div>
<script>
  const PHONE = ${JSON.stringify(phoneNumber)};
  const API = ${JSON.stringify(apiBase)};
  let attempts = 0;
  const MAX = 30;

  async function poll() {
    attempts++;
    try {
      const r = await fetch(API + '/pluggy/status/' + encodeURIComponent(PHONE));
      if (r.ok) {
        const d = await r.json();
        if (d.status === 'identity_verified') {
          document.getElementById('statusBox').className = 'status success';
          document.getElementById('statusBox').textContent = '✅ Identidade verificada! Pode fechar esta aba e voltar ao WhatsApp.';
          return;
        }
        if (d.status === 'identity_mismatch') {
          document.getElementById('statusBox').className = 'status error';
          document.getElementById('statusBox').textContent = '❌ Documento não confere com o cadastrado no banco. Entre em contato pelo WhatsApp.';
          return;
        }
      }
    } catch(e) {}
    if (attempts < MAX) {
      setTimeout(poll, 3000);
    } else {
      document.getElementById('statusBox').className = 'status info';
      document.getElementById('statusBox').textContent = '⏳ A verificação ainda está em andamento. Aguarde a confirmação pelo WhatsApp.';
    }
  }
  setTimeout(poll, 2000);
</script>
</body></html>`);
    return;
  }

  let connectToken: string;
  try {
    const redirectUrl = `${baseUrl}/api/pluggy/widget?phone=${encodeURIComponent(phoneNumber)}&return=1`;
    const webhookUrl = `${baseUrl}/api/pluggy/webhook`;
    // Only forward itemId if it is a valid UUID — Pluggy rejects anything else
    const existingItemId =
      record.pluggyItemId && isUuid(record.pluggyItemId) ? record.pluggyItemId : undefined;
    connectToken = await createConnectToken({
      clientUserId: record.pluggyClientUserId ?? phoneNumber,
      itemId: existingItemId,
      webhookUrl,
      redirectUrl,
    });
  } catch (err) {
    logger.error({ err, phoneNumber }, "Widget: failed to generate connect token");
    res.status(500).send("<h2>Erro ao gerar token de conexão. Tente novamente.</h2>");
    return;
  }

  const pluggyUrl = `https://connect.pluggy.ai?connectToken=${encodeURIComponent(connectToken)}&language=pt&sandbox=true`;

  res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Balkao — Verificação de Identidade</title><style>${commonStyles}</style></head>
<body><div class="card">
  <div class="logo">🏦</div>
  <h1>Verificação de Identidade</h1>
  <p>Conecte sua conta bancária via Open Finance (regulado pelo Banco Central) para confirmar sua identidade no Balkao.</p>
  <a class="btn" href="${pluggyUrl}">Conectar conta bancária</a>
  <p class="lock" style="margin-top:16px">🔒 Sua senha bancária nunca é compartilhada com o Balkao</p>
</div></body></html>`);
});

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
    // Only pass itemId if it is a valid UUID — Pluggy rejects non-UUID values
    const itemId = record?.pluggyItemId && isUuid(record.pluggyItemId) ? record.pluggyItemId : undefined;

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
  const phoneNumber = req.params.phoneNumber as string;

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
  const phoneNumber = req.params.phoneNumber as string;

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

    if (record.pluggyItemId && isUuid(record.pluggyItemId)) {
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

router.post("/pluggy/webhook", verifyPluggySignature, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const event = body.event;

  if (typeof event !== "string") {
    res.status(400).json({ error: "Invalid webhook payload: event is required" });
    return;
  }

  req.log.info({ event, body }, "Received Pluggy webhook event");
  res.status(200).json({ received: true });

  try {
    const data = body.data as Record<string, unknown> | undefined;
    const itemId = (data?.itemId as string | undefined) ?? (body.id as string | undefined);
    const clientUserId = (data?.clientUserId as string | undefined);

    if (!itemId) return;

    if (event === "item/error" || event === "item/login_error") {
      logger.warn({ itemId, event }, "Pluggy item connection error via webhook");
      return;
    }

    if (event === "item/updated" || event === "item/created") {
      let existing = await db
        .select()
        .from(identityVerificationsTable)
        .where(eq(identityVerificationsTable.pluggyItemId, itemId))
        .limit(1);

      if (!existing[0] && clientUserId) {
        existing = await db
          .select()
          .from(identityVerificationsTable)
          .where(eq(identityVerificationsTable.phoneNumber, clientUserId))
          .limit(1);

        if (!existing[0]) {
          const byPluggyClientUserId = await db
            .select()
            .from(identityVerificationsTable)
            .where(eq(identityVerificationsTable.pluggyClientUserId, clientUserId))
            .limit(1);
          if (byPluggyClientUserId[0]) existing = byPluggyClientUserId;
        }
      }

      if (!existing[0]) {
        logger.warn({ itemId, clientUserId }, "Webhook: no matching verification record found");
        return;
      }

      const record = existing[0];

      // Fetch the item from Pluggy first — validate it exists and is trustworthy
      // before persisting anything or touching verification status.
      const item = await getItem(itemId);

      // Enforce Open Finance requirement — same rule as /pluggy/verify.
      // Non-OF connectors cannot be used for identity verification even via webhook.
      if (!item.connector.isOpenFinance) {
        logger.warn(
          { itemId, connector: item.connector.name, phoneNumber: record.phoneNumber },
          "Webhook: rejecting non-Open Finance connector — item discarded",
        );
        return;
      }

      // Now that the item is confirmed real and OF-regulated, persist the itemId.
      if (!record.pluggyItemId && isUuid(itemId)) {
        await db
          .update(identityVerificationsTable)
          .set({ pluggyItemId: itemId, updatedAt: new Date() })
          .where(eq(identityVerificationsTable.phoneNumber, record.phoneNumber));
        logger.info({ itemId, phoneNumber: record.phoneNumber }, "Saved pluggyItemId from webhook");
      }

      if (item.executionStatus !== "SUCCESS") {
        logger.info({ itemId, executionStatus: item.executionStatus }, "Item not yet successful, skipping identity check");
        return;
      }

      const identity = await getIdentity(itemId);
      const now = new Date();

      if (documentsMatch(record.declaredDocument, identity.document)) {
        await db
          .update(identityVerificationsTable)
          .set({ status: "identity_verified", verifiedAt: now, lastBankReauthAt: now, updatedAt: now })
          .where(eq(identityVerificationsTable.phoneNumber, record.phoneNumber));
        logger.info({ itemId, phoneNumber: record.phoneNumber }, "Identity auto-verified via webhook");
      } else {
        await db
          .update(identityVerificationsTable)
          .set({ status: "identity_mismatch", updatedAt: now })
          .where(eq(identityVerificationsTable.phoneNumber, record.phoneNumber));
        logger.warn({ itemId, phoneNumber: record.phoneNumber, declared: record.declaredDocument, fromBank: identity.document }, "Identity mismatch detected via webhook");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error processing Pluggy webhook event");
  }
});

export default router;
