import { eq } from "drizzle-orm";
import { db, identityVerificationsTable } from "@workspace/db";
import { createConnectToken, normalizeDocument } from "../services/pluggy";
import { logger } from "../lib/logger";
import type { Agent, AgentContext, AgentResult } from "../lib/agents/types";

function detectDocument(text: string): { document: string; type: "CPF" | "CNPJ" } | null {
  const digits = text.replace(/\D/g, "");
  if (digits.length === 11) return { document: digits, type: "CPF" };
  if (digits.length === 14) return { document: digits, type: "CNPJ" };
  return null;
}

function getWidgetUrl(phoneNumber: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ??
    (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim() ??
    "localhost:8080";
  return `https://${domain}/api/pluggy/widget?phone=${encodeURIComponent(phoneNumber)}`;
}

async function generateLink(phoneNumber: string, itemId?: string | null): Promise<string> {
  const existing = await db
    .select()
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.phoneNumber, phoneNumber))
    .limit(1);

  const record = existing[0];
  if (!record) throw new Error("No record");

  await createConnectToken({
    clientUserId: record.pluggyClientUserId ?? phoneNumber,
    itemId: itemId ?? undefined,
  });

  return getWidgetUrl(phoneNumber);
}

export class IdentityAgent implements Agent {
  readonly name = "identity";
  readonly description = "Intercepta mensagens de usuários não verificados e conduz o fluxo de verificação de identidade via Pluggy Open Finance.";
  readonly priority = 10;

  async canHandle(context: AgentContext): Promise<boolean> {
    if (context.messageType !== "text" && context.messageType !== "interactive") return false;

    try {
      const existing = await db
        .select({ status: identityVerificationsTable.status })
        .from(identityVerificationsTable)
        .where(eq(identityVerificationsTable.phoneNumber, context.from))
        .limit(1);

      const status = existing[0]?.status;
      return status !== "identity_verified";
    } catch (err) {
      logger.error({ err, from: context.from }, "IdentityAgent: DB lookup failed in canHandle");
      return false;
    }
  }

  async process(context: AgentContext): Promise<AgentResult> {
    const { from, text } = context;

    try {
      const existing = await db
        .select()
        .from(identityVerificationsTable)
        .where(eq(identityVerificationsTable.phoneNumber, from))
        .limit(1);

      const record = existing[0];
      const status = record?.status;

      if (!status || status === "pending_identity_verification") {
        const detected = text ? detectDocument(text) : null;

        if (detected) {
          const normalizedDoc = normalizeDocument(detected.document);
          const clientUserId = `${from}|${detected.type}|${normalizedDoc}`;

          await createConnectToken({ clientUserId });

          if (record) {
            await db
              .update(identityVerificationsTable)
              .set({
                status: "pluggy_widget_opened",
                declaredDocument: normalizedDoc,
                documentType: detected.type,
                pluggyClientUserId: clientUserId,
                updatedAt: new Date(),
              })
              .where(eq(identityVerificationsTable.phoneNumber, from));
          } else {
            await db.insert(identityVerificationsTable).values({
              phoneNumber: from,
              declaredDocument: normalizedDoc,
              documentType: detected.type,
              status: "pluggy_widget_opened",
              pluggyClientUserId: clientUserId,
            });
          }

          const link = getWidgetUrl(from);
          const docLabel = detected.type === "CPF" ? "CPF" : "CNPJ";

          return {
            handled: true,
            reply: `✅ ${docLabel} recebido! Agora clique no link abaixo para conectar sua conta bancária e concluir a verificação de identidade:\n\n🔗 ${link}\n\nO link abre no navegador e leva menos de 2 minutos. Sua senha bancária *nunca* é compartilhada com o Balkao.`,
          };
        }

        return {
          handled: true,
          reply: `👋 Olá! Para usar o Balkao, precisamos verificar sua identidade via Open Finance (regulado pelo Banco Central).\n\nPor favor, informe seu *CPF* (pessoa física) ou *CNPJ* (empresa) para começar.`,
        };
      }

      if (status === "pluggy_widget_opened") {
        const link = getWidgetUrl(from);
        return {
          handled: true,
          reply: `⏳ Sua verificação ainda está pendente. Você precisa conectar sua conta bancária para continuar.\n\n🔗 ${link}\n\nSe já conectou e está vendo esta mensagem, aguarde alguns instantes e envie outra mensagem.`,
        };
      }

      if (status === "pending_multi_approval") {
        return {
          handled: true,
          reply: `⏳ Sua conta bancária requer aprovação de múltiplos responsáveis. Assim que todos aprovarem, sua verificação será concluída automaticamente. Tente novamente em alguns minutos.`,
        };
      }

      if (status === "identity_mismatch") {
        const link = getWidgetUrl(from);
        return {
          handled: true,
          reply: `❌ Os dados da conta bancária conectada não conferem com o documento informado. Por favor, conecte a conta bancária vinculada ao seu CPF/CNPJ correto:\n\n🔗 ${link}`,
        };
      }

      if (status === "blocked_risk_flag" || status === "blocked_possible_number_recycling") {
        return {
          handled: true,
          reply: `🚫 Sua conta está temporariamente bloqueada por questões de segurança. Entre em contato com o suporte do Balkao para regularizar sua situação.`,
        };
      }

      if (status === "pending_sms_verification" || status === "pending_reauth_full") {
        const link = getWidgetUrl(from);
        return {
          handled: true,
          reply: `🔄 É hora da sua reverificação periódica de segurança. Reconecte sua conta bancária para continuar:\n\n🔗 ${link}`,
        };
      }

      return { handled: false };
    } catch (err) {
      logger.error({ err, from }, "IdentityAgent: error processing message");
      return {
        handled: true,
        reply: `Tive um problema ao verificar sua identidade. Tente novamente em instantes.`,
      };
    }
  }
}
