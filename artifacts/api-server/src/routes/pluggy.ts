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
import { config } from "../lib/config";

const router: IRouter = Router();

function isValidDocumentType(v: unknown): v is "CPF" | "CNPJ" {
  return v === "CPF" || v === "CNPJ";
}

function isUuid(v: unknown): boolean {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Safely serialize a value for embedding inside an HTML <script> block.
 * JSON.stringify alone does NOT escape </script>, so a crafted string can
 * break out of script context. We replace <, >, and & with Unicode escapes
 * that are valid JSON and safe inside <script> tags.
 */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

router.get("/pluggy/widget", async (req: Request, res: Response): Promise<void> => {
  const phoneNumber = req.query["phone"] as string | undefined;
  const isReturn = req.query["return"] === "1";
  // Pluggy appends ?itemId=<uuid> to the redirectUrl after a successful connection.
  const returnItemId = req.query["itemId"] as string | undefined;

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

  const isSandbox = config.pluggy.sandbox;

  const sharedStyles = `
    :root {
      --bg: #F5F0EB;
      --ink: #1A1A1A;
      --accent: #E8622A;
      --muted: #8A8378;
      --card: #FFFFFF;
      --success: #1E8E5A;
      --error: #C0392B;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: var(--card);
      border-radius: 20px;
      max-width: 420px;
      width: 100%;
      padding: 32px 28px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06);
      text-align: center;
    }
    .logo {
      width: 56px; height: 56px;
      border-radius: 14px;
      background: var(--ink);
      color: var(--bg);
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 22px;
      margin: 0 auto 20px;
    }
    .badge {
      display: inline-block;
      background: #FCEFE8;
      color: var(--accent);
      font-size: 11px; font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      padding: 4px 10px;
      border-radius: 100px;
      margin-bottom: 16px;
    }
    h1 { font-size: 19px; font-weight: 600; margin: 0 0 8px; }
    p.sub {
      color: var(--muted); font-size: 14px; line-height: 1.5;
      margin: 0 0 28px;
    }
    button.primary {
      background: var(--ink); color: #fff;
      border: none; border-radius: 12px;
      padding: 14px 20px;
      font-size: 15px; font-weight: 600;
      width: 100%; cursor: pointer;
      transition: opacity 0.15s ease;
    }
    button.primary:hover { opacity: 0.88; }
    button.primary:disabled { opacity: 0.5; cursor: default; }
    .status {
      margin-top: 20px; font-size: 13px;
      color: var(--muted); min-height: 18px;
    }
    .status.success { color: var(--success); font-weight: 600; }
    .status.error { color: var(--error); font-weight: 600; }
    .testdata {
      margin-top: 28px; text-align: left;
      background: var(--bg); border-radius: 12px;
      padding: 14px 16px; font-size: 12px;
      color: var(--muted); line-height: 1.6;
    }
    .testdata strong { color: var(--ink); }
    code {
      background: #fff; padding: 1px 6px;
      border-radius: 6px; font-size: 12px;
    }
    .lock { font-size: 11px; color: var(--muted); margin-top: 20px; }
  `;

  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (isReturn) {
    if (record.status === "identity_verified") {
      res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Balkao — Verificado</title><style>${sharedStyles}</style></head>
<body><div class="card">
  <div class="logo">B</div>
  <h1>Identidade verificada</h1>
  <p class="sub">Sua identidade foi confirmada com sucesso. Pode fechar esta aba e voltar ao WhatsApp para continuar.</p>
  <p class="lock">Seus dados bancarios nunca sao compartilhados com o Balkao</p>
</div></body></html>`);
      return;
    }

    // Pluggy appends ?itemId=<uuid> to the redirectUrl on successful connection.
    // Use it to verify immediately — no webhook association needed.
    if (returnItemId && isUuid(returnItemId)) {
      (async () => {
        try {
          logger.info({ phoneNumber, itemId: returnItemId }, "Return: itemId received, starting verification");

          const item = await getItem(returnItemId);

          if (!item.connector.isOpenFinance) {
            logger.warn({ phoneNumber, connector: item.connector.name }, "Return: non-Open Finance connector");
            await db
              .update(identityVerificationsTable)
              .set({ status: "identity_mismatch", updatedAt: new Date() })
              .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
            return;
          }

          if (item.executionStatus !== "SUCCESS") {
            logger.info({ phoneNumber, executionStatus: item.executionStatus }, "Return: item not yet SUCCESS — webhook will follow up");
            // Save itemId so webhook can match later when item finishes
            if (!record.pluggyItemId) {
              await db
                .update(identityVerificationsTable)
                .set({ pluggyItemId: returnItemId, updatedAt: new Date() })
                .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
            }
            return;
          }

          const identity = await getIdentity(returnItemId);
          const now = new Date();

          if (documentsMatch(record.declaredDocument, identity.document)) {
            await db
              .update(identityVerificationsTable)
              .set({ status: "identity_verified", pluggyItemId: returnItemId, verifiedAt: now, lastBankReauthAt: now, updatedAt: now })
              .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
            logger.info({ phoneNumber, itemId: returnItemId }, "Return: identity verified ✅");
          } else {
            await db
              .update(identityVerificationsTable)
              .set({ status: "identity_mismatch", pluggyItemId: returnItemId, updatedAt: now })
              .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
            logger.warn(
              { phoneNumber, declared: record.declaredDocument, fromBank: identity.document },
              "Return: identity mismatch ❌",
            );
          }
        } catch (err) {
          logger.error({ err, phoneNumber, itemId: returnItemId }, "Return: verification failed — webhook will handle it");
        }
      })();
    } else {
      logger.info({ phoneNumber }, "Return: no itemId in query — waiting for webhook");
    }

    const apiBase = `${baseUrl}/api`;
    res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Balkao — Verificando…</title><style>${sharedStyles}</style></head>
<body><div class="card">
  <div class="logo">B</div>
  <h1>Verificando sua identidade…</h1>
  <p class="sub">Aguardando confirmacao do banco. Isso pode levar alguns segundos.</p>
  <div class="status" id="statusBox">Processando conexao bancaria…</div>
  <p class="lock">Seus dados bancarios nunca sao compartilhados com o Balkao</p>
</div>
<script>
  var PHONE = ${safeJson(phoneNumber)};
  var API = ${safeJson(apiBase)};
  var attempts = 0;
  var MAX = 30;
  var statusEl = document.getElementById('statusBox');

  function poll() {
    attempts++;
    fetch(API + '/pluggy/status/' + encodeURIComponent(PHONE))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) {
        if (!d) return schedule();
        if (d.status === 'identity_verified') {
          statusEl.className = 'status success';
          statusEl.textContent = 'Identidade verificada! Pode fechar esta aba e voltar ao WhatsApp.';
          return;
        }
        if (d.status === 'identity_mismatch') {
          statusEl.className = 'status error';
          statusEl.textContent = 'Documento nao confere com o cadastrado no banco. Entre em contato pelo WhatsApp.';
          return;
        }
        schedule();
      })
      .catch(function() { schedule(); });
  }

  function schedule() {
    if (attempts < MAX) setTimeout(poll, 3000);
    else {
      statusEl.className = 'status';
      statusEl.textContent = 'A verificacao ainda esta em andamento. Aguarde a confirmacao pelo WhatsApp.';
    }
  }

  setTimeout(poll, 2000);
</script>
</body></html>`);
    return;
  }

  const redirectUrl = `${baseUrl}/api/pluggy/widget?phone=${encodeURIComponent(phoneNumber)}&return=1`;
  let connectToken: string;
  try {
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

    // Mark the record as widget-opened so the webhook sandbox fallback can
    // find exactly one recently-opened record and associate the incoming itemId.
    await db
      .update(identityVerificationsTable)
      .set({ status: "pluggy_widget_opened", updatedAt: new Date() })
      .where(eq(identityVerificationsTable.phoneNumber, phoneNumber));
  } catch (err) {
    logger.error({ err, phoneNumber }, "Widget: failed to generate connect token");
    res.status(500).send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Balkao — Erro</title><style>${sharedStyles}</style></head>
<body><div class="card">
  <div class="logo">B</div>
  <h1>Algo deu errado</h1>
  <p class="sub">Nao foi possivel gerar o token de conexao. Tente novamente pelo WhatsApp.</p>
</div></body></html>`);
    return;
  }

  const sandboxBadge = isSandbox ? '<div class="badge">Sandbox · Ambiente de teste</div>' : '';
  const sandboxTestData = isSandbox ? `
  <div class="testdata">
    <strong>Dados de teste (Sandbox)</strong><br/>
    Declare este CPF no WhatsApp: <code>076.630.975-48</code><br/>
    Login no banco: <code>761.092.776-73</code> / <code>P@ssword01</code>
  </div>` : '';

  res.send(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Balkao — Verificacao de Identidade</title>
<style>${sharedStyles}</style>
<script src="https://cdn.pluggy.ai/pluggy-connect/v2.9.2/pluggy-connect.js"></script>
</head>
<body><div class="card">
  ${sandboxBadge}
  <div class="logo">B</div>
  <h1>Verificacao de identidade</h1>
  <p class="sub">Conecte sua conta bancaria para confirmarmos sua identidade e liberar compra e venda no Balkao.</p>
  <button class="primary" id="connectBtn">Conectar minha conta</button>
  <div class="status" id="statusEl"></div>
  ${sandboxTestData}
  <p class="lock">Sua senha bancaria nunca e compartilhada com o Balkao</p>
</div>
<script>
  var CONNECT_TOKEN = ${safeJson(connectToken)};
  var REDIRECT_URL  = ${safeJson(redirectUrl)};
  var IS_SANDBOX    = ${safeJson(isSandbox)};
  var PHONE         = ${safeJson(phoneNumber)};
  var API_BASE      = ${safeJson(`${baseUrl}/api`)};

  var btn      = document.getElementById('connectBtn');
  var statusEl = document.getElementById('statusEl');

  function showStatus(cls, msg) {
    statusEl.className = 'status ' + cls;
    statusEl.textContent = msg;
  }

  btn.addEventListener('click', function() {
    btn.disabled = true;
    statusEl.textContent = 'Abrindo conexao segura…';

    try {
      var pluggyConnect = new PluggyConnect({
        connectToken: CONNECT_TOKEN,
        includeSandbox: IS_SANDBOX,
        onSuccess: function(data) {
          btn.style.display = 'none';
          showStatus('', 'Conexao realizada! Verificando sua identidade…');
          // PluggyConnect v2 passes {item:{id,...}} on success (not {itemId}).
          // Try all known shapes across versions.
          var itemId = data && (
            data.itemId ||
            (data.item && data.item.id) ||
            (data.data && data.data.itemId)
          );
          if (itemId) {
            fetch(API_BASE + '/pluggy/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ phoneNumber: PHONE, itemId: itemId })
            }).catch(function() { /* webhook will handle it as fallback */ });
          }
          setTimeout(function() { window.location.href = REDIRECT_URL; }, 2000);
        },
        onError: function() {
          btn.disabled = false;
          showStatus('error', 'Algo deu errado. Tente novamente pelo WhatsApp.');
        },
        onClose: function() {
          btn.disabled = false;
          statusEl.textContent = '';
        },
      });
      pluggyConnect.init();
    } catch(e) {
      btn.disabled = false;
      showStatus('error', 'Erro ao carregar o widget. Verifique sua conexao e tente novamente.');
    }
  });
</script>
</body></html>`);
});

router.post("/pluggy/connect-token", async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber, declaredDocument, documentType } = req.body as Record<string, unknown>;

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

  const normalizedDoc = normalizeDocument(declaredDocument);
  const clientUserId = `${phoneNumber}|${documentType}|${normalizedDoc}`;

  // Webhook URL is always server-configured — never accepted from the caller
  const serverBaseUrl = process.env.SERVER_BASE_URL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const serverWebhookUrl = `${serverBaseUrl}/api/pluggy/webhook`;

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
      webhookUrl: serverWebhookUrl,
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

    // In sandbox mode the test connector (Pluggy Bank) has isOpenFinance:false.
    // Skip this check for sandbox so development testing works end-to-end.
    if (!item.connector.isOpenFinance && !config.pluggy.sandbox) {
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
    // Pluggy webhook body is flat — fields are at the root, not inside a "data" sub-object.
    // We keep the data fallback for forward-compatibility but always prefer root-level fields.
    const data = body.data as Record<string, unknown> | undefined;
    const itemId =
      (body.itemId as string | undefined) ??
      (data?.itemId as string | undefined) ??
      (body.id as string | undefined);
    // clientUserId can be null when Pluggy sandbox doesn't propagate it.
    // Read from root first, fallback to data sub-object, coerce null → undefined.
    const clientUserId =
      ((body.clientUserId ?? data?.clientUserId) as string | null | undefined) || undefined;

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

      // Sandbox fallback: Pluggy never sends clientUserId in sandbox webhooks.
      // If we still have no match, look for a record with status=pluggy_widget_opened
      // and no pluggyItemId that was touched in the last 10 minutes. If exactly one
      // exists we can safely associate it (concurrent users would each have their own
      // widget session but this is acceptable for MVP/sandbox use).
      if (!existing[0]) {
        const cutoff = new Date(Date.now() - 10 * 60 * 1000);
        const recentlyOpened = await db
          .select()
          .from(identityVerificationsTable)
          .where(eq(identityVerificationsTable.status, "pluggy_widget_opened"))
          .limit(2);

        const candidates = recentlyOpened.filter(
          (r) => !r.pluggyItemId && new Date(r.updatedAt) >= cutoff,
        );

        if (candidates.length === 1) {
          existing = [candidates[0]!];
          logger.info(
            { itemId, phoneNumber: candidates[0]!.phoneNumber },
            "Webhook: matched by recently-opened fallback (clientUserId null in sandbox)",
          );
        } else {
          logger.warn({ itemId, clientUserId, candidates: candidates.length }, "Webhook: no matching verification record found");
          return;
        }
      }

      const record = existing[0];

      // Fetch the item from Pluggy first — validate it exists and is trustworthy
      // before persisting anything or touching verification status.
      const item = await getItem(itemId);

      // Enforce Open Finance requirement — same rule as /pluggy/verify.
      // In sandbox mode the test connector (Pluggy Bank) has isOpenFinance:false,
      // so we skip this check in sandbox to allow end-to-end testing.
      if (!item.connector.isOpenFinance && !config.pluggy.sandbox) {
        logger.warn(
          { itemId, connector: item.connector.name, phoneNumber: record.phoneNumber },
          "Webhook: rejecting non-Open Finance connector — marking as mismatch",
        );
        await db
          .update(identityVerificationsTable)
          .set({ status: "identity_mismatch", updatedAt: new Date() })
          .where(eq(identityVerificationsTable.phoneNumber, record.phoneNumber));
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
