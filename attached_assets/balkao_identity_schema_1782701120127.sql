-- =========================================================
-- Balkao — Schema de Verificação de Identidade
-- Complementa a tabela identity_verifications já existente
-- =========================================================

-- -----------------------------------------------------------------
-- 1. HISTÓRICO DE EVENTOS DE VERIFICAÇÃO (auditoria completa)
-- -----------------------------------------------------------------
-- Toda tentativa de verificação (SMS ou bancária), com sucesso ou falha,
-- gera uma linha aqui. identity_verifications guarda só o "estado atual";
-- esta tabela guarda o "histórico completo" — essencial para investigar
-- casos de identity_mismatch, reciclagem de número, ou fraude.

create type public.verification_event_type as enum (
  'sms_sent',
  'sms_confirmed',
  'sms_failed',
  'bank_widget_opened',
  'bank_connection_success',
  'bank_connection_error',
  'identity_match',
  'identity_mismatch',
  'multi_approval_pending',
  'multi_approval_resolved'
);

create table public.identity_verification_events (
  id uuid not null default gen_random_uuid(),
  identity_verification_id text not null,
  event_type public.verification_event_type not null,

  -- snapshot do que foi comparado, para auditoria (não é o dado "atual", é o que valia neste evento)
  declared_document_snapshot text null,
  returned_document_snapshot text null,  -- CPF/CNPJ retornado pela Pluggy nesse evento específico (pode vir mascarado)
  returned_name_snapshot text null,

  pluggy_item_id text null,              -- itemId envolvido neste evento específico
  error_code text null,                  -- código de erro, se houver (ex: timeout SMS, oauth_error da Pluggy)
  error_message text null,

  metadata jsonb null,                   -- espaço livre para detalhes extras sem precisar migrar schema depois

  created_at timestamp without time zone not null default now(),

  constraint identity_verification_events_pkey primary key (id),
  constraint identity_verification_events_fk
    foreign key (identity_verification_id)
    references public.identity_verifications (id)
    on delete cascade
) TABLESPACE pg_default;

create index identity_verification_events_iv_id_idx
  on public.identity_verification_events (identity_verification_id);

create index identity_verification_events_type_idx
  on public.identity_verification_events (event_type);

create index identity_verification_events_created_at_idx
  on public.identity_verification_events (created_at);


-- -----------------------------------------------------------------
-- 2. VERIFICAÇÕES DE SMS (separado do evento genérico, dados específicos de SMS)
-- -----------------------------------------------------------------
-- Guarda o código gerado, prazo de expiração e tentativas — necessário
-- para a lógica de "código expira em N minutos" e "máximo de tentativas".

create type public.sms_verification_status as enum (
  'pending',
  'confirmed',
  'expired',
  'failed'
);

create table public.sms_verifications (
  id uuid not null default gen_random_uuid(),
  identity_verification_id text not null,

  phone_number text not null,            -- redundante com identity_verifications.phone_number,
                                          -- mas guardado aqui para o caso raro de número ter sido
                                          -- corrigido/atualizado entre verificações
  code_hash text not null,               -- NUNCA armazenar o código em texto puro — guardar hash (ex: sha256)
  status public.sms_verification_status not null default 'pending',

  attempts integer not null default 0,   -- quantas vezes o usuário tentou confirmar este código
  max_attempts integer not null default 3,

  expires_at timestamp without time zone not null,
  confirmed_at timestamp without time zone null,

  created_at timestamp without time zone not null default now(),

  constraint sms_verifications_pkey primary key (id),
  constraint sms_verifications_fk
    foreign key (identity_verification_id)
    references public.identity_verifications (id)
    on delete cascade
) TABLESPACE pg_default;

create index sms_verifications_iv_id_idx
  on public.sms_verifications (identity_verification_id);

create index sms_verifications_status_idx
  on public.sms_verifications (status);


-- -----------------------------------------------------------------
-- 3. CONEXÕES BANCÁRIAS (um usuário pode ter mais de uma ao longo do tempo)
-- -----------------------------------------------------------------
-- identity_verifications.pluggy_item_id guarda só o item "atual".
-- Esta tabela guarda TODAS as conexões já feitas (inclusive antigas/revogadas) —
-- importante porque, ao reconectar, um novo itemId é gerado, e você pode querer
-- comparar a conexão nova contra conexões anteriores (mesmo CPF, banco diferente, etc.)

create type public.bank_connection_status as enum (
  'active',
  'revoked',
  'expired',
  'replaced'   -- substituída por uma reconexão mais recente
);

create table public.bank_connections (
  id uuid not null default gen_random_uuid(),
  identity_verification_id text not null,

  pluggy_item_id text not null,
  pluggy_connector_id integer null,      -- id do banco/instituição na Pluggy (ex: 201 = Itaú PF)
  connector_name text null,              -- nome do banco, para exibição/relatório sem precisar consultar a API de novo
  is_open_finance boolean not null default true,  -- registra que a conexão usada era regulada (vs. direct connector)

  returned_name text null,               -- nome retornado pela Identity API nesta conexão
  returned_document text null,           -- CPF/CNPJ retornado (pode vir mascarado, dependendo do produto)

  status public.bank_connection_status not null default 'active',

  consent_expires_at timestamp without time zone null,  -- prazo do consentimento Open Finance (até 12 meses)
  connected_at timestamp without time zone not null default now(),
  revoked_at timestamp without time zone null,

  constraint bank_connections_pkey primary key (id),
  constraint bank_connections_pluggy_item_id_unique unique (pluggy_item_id),
  constraint bank_connections_fk
    foreign key (identity_verification_id)
    references public.identity_verifications (id)
    on delete cascade
) TABLESPACE pg_default;

create index bank_connections_iv_id_idx
  on public.bank_connections (identity_verification_id);

create index bank_connections_status_idx
  on public.bank_connections (status);


-- -----------------------------------------------------------------
-- 4. VÍNCULO PESSOA ↔ EMPRESA (para o fluxo PJ)
-- -----------------------------------------------------------------
-- Um identity_verification de tipo CNPJ representa a EMPRESA.
-- Esta tabela vincula qual(is) PESSOA(S) física(s) (já com seu próprio
-- identity_verification de CPF, verificado) está(ão) autorizada(s) a operar
-- em nome dessa empresa — baseado em terem conectado a conta bancária PJ.

create type public.company_link_status as enum (
  'active',
  'revoked'
);

create table public.company_operator_links (
  id uuid not null default gen_random_uuid(),

  company_identity_verification_id text not null,   -- aponta para o identity_verifications do CNPJ
  operator_identity_verification_id text not null,   -- aponta para o identity_verifications do CPF da pessoa

  bank_connection_id uuid not null,    -- qual conexão bancária PJ comprovou esse vínculo

  status public.company_link_status not null default 'active',

  linked_at timestamp without time zone not null default now(),
  revoked_at timestamp without time zone null,

  constraint company_operator_links_pkey primary key (id),
  constraint company_operator_links_company_fk
    foreign key (company_identity_verification_id)
    references public.identity_verifications (id)
    on delete cascade,
  constraint company_operator_links_operator_fk
    foreign key (operator_identity_verification_id)
    references public.identity_verifications (id)
    on delete cascade,
  constraint company_operator_links_bank_connection_fk
    foreign key (bank_connection_id)
    references public.bank_connections (id)
    on delete restrict,
  constraint company_operator_links_unique
    unique (company_identity_verification_id, operator_identity_verification_id)
) TABLESPACE pg_default;

create index company_operator_links_company_idx
  on public.company_operator_links (company_identity_verification_id);

create index company_operator_links_operator_idx
  on public.company_operator_links (operator_identity_verification_id);


-- -----------------------------------------------------------------
-- 5. TRIGGER para manter updated_at de identity_verifications em dia
-- -----------------------------------------------------------------
-- (caso ainda não exista — útil já que a tabela já tem a coluna)

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger identity_verifications_set_updated_at
  before update on public.identity_verifications
  for each row
  execute function public.set_updated_at();
