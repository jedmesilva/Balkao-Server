# Balkao — Servidor de Agente WhatsApp

Servidor backend para o agente de WhatsApp Balkao, integrado com a API oficial do WhatsApp Business (Meta Cloud API).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — inicia o servidor API (porta 8080)
- `pnpm run typecheck` — typecheck completo em todos os pacotes
- `pnpm run build` — typecheck + build de todos os pacotes

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Build: esbuild (CJS bundle)
- Logging: pino + pino-http

## Where things live

- `artifacts/api-server/src/routes/whatsapp.ts` — webhook GET (verificação) e POST (recebimento de mensagens)
- `artifacts/api-server/src/services/agent.ts` — lógica do agente Balkao (respostas automáticas)
- `artifacts/api-server/src/services/whatsapp-api.ts` — cliente para envio via Meta Cloud API
- `artifacts/api-server/src/middlewares/verify-whatsapp-signature.ts` — verificação HMAC de assinatura
- `artifacts/api-server/src/lib/config.ts` — leitura de variáveis de ambiente

## Configuração do Webhook Meta

URL do webhook a configurar no painel Meta for Developers:
```
https://<seu-domínio>/api/whatsapp/webhook
```
- **Verify Token**: o valor que você definiu em `WHATSAPP_VERIFY_TOKEN`
- **Campos a assinar**: `messages`

## Secrets necessários

| Variável | Onde encontrar |
|---|---|
| `WHATSAPP_TOKEN` | Meta for Developers > App > WhatsApp > Token de acesso |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta for Developers > App > WhatsApp > Configuração > ID do número |
| `WHATSAPP_APP_SECRET` | Meta for Developers > App > Configurações Básicas > Segredo do app |
| `WHATSAPP_VERIFY_TOKEN` | String arbitrária escolhida por você |
| `DATABASE_URL` | Supabase > Project Settings > Database > Connection string (Transaction Pooler, porta 6543) |
| `SUPABASE_URL` | Supabase > Project Settings > API > Project URL |
| `SUPABASE_ANON_KEY` | Supabase > Project Settings > API > anon / public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase > Project Settings > API > service_role (nunca expor no frontend) |

## Banco de dados (Supabase)

O projeto usa **Drizzle ORM** com PostgreSQL hospedado no Supabase. A conexão é gerenciada em `lib/db/`:

- **Connection string**: Use o **Transaction Pooler** do Supabase (porta 6543) no `DATABASE_URL` — é compatível com Drizzle + `pg.Pool` e suporta múltiplas conexões simultâneas. A URL tem o formato: `postgresql://postgres.[ref]:[senha]@aws-0-[region].pooler.supabase.com:6543/postgres`
- **SSL**: Habilitado com `rejectUnauthorized: true` para conexões não-localhost (Supabase usa certificados Let's Encrypt válidos).
- **Pool**: configurado com `max: 10`, `idleTimeoutMillis: 30s`, `connectionTimeoutMillis: 5s`.
- **Schema push**: `pnpm --filter @workspace/db run push` — aplica o schema no banco sem migrations (desenvolvimento).

### Schema atual

| Tabela | Descrição |
|---|---|
| `identity_verifications` | Rastreia o fluxo de verificação de identidade de cada usuário WhatsApp via Pluggy Open Finance |

## Architecture decisions

- Raw body capturado via `verify` do `express.json()` para validação HMAC da assinatura Meta (X-Hub-Signature-256)
- Respostas ao webhook são enviadas imediatamente (200 OK) e o processamento do agente ocorre de forma assíncrona — evita timeout de 20s da Meta
- Lógica do agente isolada em `services/agent.ts` para facilitar extensão (AI, banco de dados, etc.)
- Verificação de assinatura usa `timingSafeEqual` para evitar timing attacks

## Gotchas

- Sempre responder 200 ao webhook Meta ANTES de processar — a Meta cancela requisições após 20s
- O raw body precisa estar disponível antes do `express.json()` parsear — a ordem dos middlewares em `app.ts` é crítica
- `WHATSAPP_VERIFY_TOKEN` deve ser exatamente igual ao configurado no painel Meta

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
