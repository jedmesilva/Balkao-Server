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

router.get("/pluggy/widget", async (req: Request, res: Response): Promise<void> => {
  const phoneNumber = req.query["phone"] as string | undefined;
  if (!phoneNumber) {
    res.status(400).send("<h2>Parâmetro 'phone' ausente.</h2>");
    return;
  }

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

  let connectToken: string;
  try {
    connectToken = await createConnectToken({
      clientUserId: record.pluggyClientUserId ?? phoneNumber,
      itemId: record.pluggyItemId ?? undefined,
    });
  } catch (err) {
    logger.error({ err, phoneNumber }, "Widget: failed to generate connect token");
    res.status(500).send("<h2>Erro ao gerar token de conexão. Tente novamente.</h2>");
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Balkao — Verificação de Identidade</title>
  <style>
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
      background: #1a73e8;
      color: #fff;
      border: none;
      border-radius: 10px;
      padding: 14px 28px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: background 0.2s;
    }
    .btn:hover { background: #1557b0; }
    .btn:disabled { background: #aaa; cursor: not-allowed; }
    .status {
      margin-top: 20px;
      padding: 14px;
      border-radius: 10px;
      font-size: 0.95rem;
      display: none;
    }
    .status.success { background: #e6f4ea; color: #1e7e34; display: block; }
    .status.error   { background: #fce8e6; color: #c5221f; display: block; }
    .status.info    { background: #e8f0fe; color: #1a56db; display: block; }
    .lock { font-size: 0.8rem; color: #aaa; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🏦</div>
    <h1>Verificação de Identidade</h1>
    <p>Conecte sua conta bancária via Open Finance (regulado pelo Banco Central) para confirmar sua identidade no Balkao.</p>
    <button class="btn" id="openBtn" onclick="openWidget()">Conectar conta bancária</button>
    <div class="status" id="statusBox"></div>
    <p class="lock">🔒 Sua senha bancária nunca é compartilhada com o Balkao</p>
  </div>

  <script src="https://cdn.pluggy.ai/pluggy-connect/v2.6.0/pluggy-connect.js"></script>
  <script>
    const CONNECT_TOKEN = ${JSON.stringify(connectToken)};
    const PHONE_NUMBER  = ${JSON.stringify(phoneNumber)};
    const API_BASE      = ${JSON.stringify(
      (process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : "") + "/api"
    )};

    function showStatus(type, msg) {
      const el = document.getElementById('statusBox');
      el.className = 'status ' + type;
      el.textContent = msg;
    }

    function openWidget() {
      document.getElementById('openBtn').disabled = true;
      showStatus('info', 'Abrindo conexão bancária…');

      const pluggyConnect = new PluggyConnect({
        connectToken: CONNECT_TOKEN,
        includeSandbox: true,
        onSuccess: async function(itemData) {
          const itemId = itemData?.item?.id;
          if (!itemId) {
            showStatus('error', 'Erro: ID do item não retornado pelo widget.');
            document.getElementById('openBtn').disabled = false;
            return;
          }
          showStatus('info', 'Verificando identidade…');
          try {
            const resp = await fetch(API_BASE + '/pluggy/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phoneNumber: PHONE_NUMBER, itemId }),
            });
            const data = await resp.json();
            if (resp.ok) {
              showStatus('success', '✅ Identidade verificada com sucesso! Pode voltar ao WhatsApp.');
            } else if (resp.status === 202) {
              showStatus('info', '⏳ Aguardando aprovação dos demais responsáveis. Você será notificado pelo WhatsApp.');
            } else {
              showStatus('error', '❌ ' + (data.error || 'Documento não confere. Conecte a conta vinculada ao seu CPF/CNPJ.'));
              document.getElementById('openBtn').disabled = false;
            }
          } catch (err) {
            showStatus('error', 'Erro de conexão. Tente novamente.');
            document.getElementById('openBtn').disabled = false;
          }
        },
        onError: function(err) {
          showStatus('error', 'Erro na conexão bancária: ' + (err?.message || 'tente novamente.'));
          document.getElementById('openBtn').disabled = false;
        },
        onClose: function() {
          const box = document.getElementById('statusBox');
          if (!box.classList.contains('success') && !box.classList.contains('info')) {
            showStatus('info', 'Conexão cancelada. Clique em "Conectar conta bancária" para tentar novamente.');
            document.getElementById('openBtn').disabled = false;
          }
        },
      });

      pluggyConnect.init();
    }
  </script>
</body>
</html>`);
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
