import { config } from "../lib/config";
import { logger } from "../lib/logger";

const PLUGGY_BASE = config.pluggy.baseUrl;

interface ApiKeyCache {
  key: string;
  expiresAt: number;
}

let apiKeyCache: ApiKeyCache | null = null;

function getCredentials(): { clientId: string; clientSecret: string } {
  const { clientId, clientSecret } = config.pluggy;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Pluggy credentials not configured. Set PLUGGY_CLIENT_ID and PLUGGY_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret };
}

export async function getPluggyApiKey(): Promise<string> {
  const now = Date.now();
  if (apiKeyCache && apiKeyCache.expiresAt > now + 60_000) {
    return apiKeyCache.key;
  }

  const { clientId, clientSecret } = getCredentials();

  const res = await fetch(`${PLUGGY_BASE}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pluggy auth failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { apiKey: string };
  if (!data.apiKey) throw new Error("Pluggy auth response missing apiKey");

  apiKeyCache = {
    key: data.apiKey,
    expiresAt: now + 2 * 60 * 60 * 1000,
  };

  logger.info("Pluggy API key refreshed");
  return data.apiKey;
}

export interface ConnectTokenOptions {
  clientUserId: string;
  webhookUrl?: string;
  itemId?: string;
  redirectUrl?: string;
}

export async function createConnectToken(opts: ConnectTokenOptions): Promise<string> {
  const apiKey = await getPluggyApiKey();

  const body: Record<string, unknown> = {
    clientUserId: opts.clientUserId,
    avoidDuplicates: true,
  };
  if (opts.webhookUrl) body.webhookUrl = opts.webhookUrl;
  if (opts.itemId) body.itemId = opts.itemId;
  if (opts.redirectUrl) body.redirectUrl = opts.redirectUrl;

  const res = await fetch(`${PLUGGY_BASE}/connect_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pluggy connect_token failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { accessToken: string };
  if (!data.accessToken) throw new Error("Pluggy connect_token response missing accessToken");
  return data.accessToken;
}

export interface PluggyItem {
  id: string;
  status: string;
  executionStatus: string;
  connector: {
    id: number;
    name: string;
    isOpenFinance: boolean;
  };
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export async function getItem(itemId: string): Promise<PluggyItem> {
  const apiKey = await getPluggyApiKey();

  const res = await fetch(`${PLUGGY_BASE}/items/${itemId}`, {
    headers: { "X-API-KEY": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pluggy GET /items/${itemId} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<PluggyItem>;
}

export interface PluggyIdentity {
  id: string;
  itemId: string;
  fullName: string | null;
  document: string | null;
  documentType: "CPF" | "CNPJ" | string | null;
  birthDate: string | null;
  phoneNumbers: Array<{ type: string; value: string }> | null;
  emails: Array<{ type: string; value: string }> | null;
  addresses: Array<Record<string, unknown>> | null;
}

export async function getIdentity(itemId: string): Promise<PluggyIdentity> {
  const apiKey = await getPluggyApiKey();

  const res = await fetch(`${PLUGGY_BASE}/identity?itemId=${encodeURIComponent(itemId)}`, {
    headers: { "X-API-KEY": apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pluggy GET /identity failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<PluggyIdentity>;
}

export async function deleteItem(itemId: string): Promise<void> {
  const apiKey = await getPluggyApiKey();

  const res = await fetch(`${PLUGGY_BASE}/items/${itemId}`, {
    method: "DELETE",
    headers: { "X-API-KEY": apiKey },
  });

  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Pluggy DELETE /items/${itemId} failed (${res.status}): ${text}`);
  }
}

export function normalizeDocument(doc: string): string {
  return doc.replace(/[.\-\/\s]/g, "").trim();
}

export function documentsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeDocument(a) === normalizeDocument(b);
}
