-- =========================================================
-- Balkao — Schema de Usuários e Empresas
-- Complementa identity_verifications + balkao_identity_schema.sql
-- =========================================================

-- -----------------------------------------------------------------
-- 1. USERS — pessoa física, o usuário de fato do Balkao
-- -----------------------------------------------------------------
-- Todo usuário do Balkao é uma pessoa física, identificada pelo número
-- de WhatsApp. Ele pode atuar como comprador/vendedor individual (PF)
-- e/ou operar uma ou mais empresas (PJ) — ver companies + user_companies.

create table public.users (
  id uuid not null default gen_random_uuid(),

  phone_number text not null,            -- mesmo valor usado em identity_verifications.phone_number
  identity_verification_id text null,    -- aponta para o identity_verifications deste usuário (CPF)

  full_name text null,                   -- nome declarado no cadastro (pode diferir do nome verificado, até confirmar)
  email text null,

  -- papel não é fixo: qualquer user pode comprar e vender, conforme decidido na arquitetura
  -- não há coluna "role" aqui de propósito

  is_active boolean not null default true,
  blocked_at timestamp without time zone null,
  blocked_reason text null,

  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now(),

  constraint users_pkey primary key (id),
  constraint users_phone_number_unique unique (phone_number),
  constraint users_identity_verification_fk
    foreign key (identity_verification_id)
    references public.identity_verifications (id)
    on delete set null
) TABLESPACE pg_default;

create index users_phone_number_idx on public.users (phone_number);
create index users_identity_verification_idx on public.users (identity_verification_id);


-- -----------------------------------------------------------------
-- 2. COMPANIES — pessoa jurídica
-- -----------------------------------------------------------------
-- Uma empresa cadastrada no Balkao. Pode ter múltiplos usuários
-- (pessoas físicas) autorizados a operar em seu nome — ver user_companies.

create table public.companies (
  id uuid not null default gen_random_uuid(),

  cnpj text not null,
  identity_verification_id text null,    -- aponta para o identity_verifications deste CNPJ

  legal_name text null,                  -- razão social declarada no cadastro
  trade_name text null,                  -- nome fantasia, se houver

  is_active boolean not null default true,
  blocked_at timestamp without time zone null,
  blocked_reason text null,

  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now(),

  constraint companies_pkey primary key (id),
  constraint companies_cnpj_unique unique (cnpj),
  constraint companies_identity_verification_fk
    foreign key (identity_verification_id)
    references public.identity_verifications (id)
    on delete set null
) TABLESPACE pg_default;

create index companies_cnpj_idx on public.companies (cnpj);
create index companies_identity_verification_idx on public.companies (identity_verification_id);


-- -----------------------------------------------------------------
-- 3. USER_COMPANIES — vínculo N:N entre pessoa e empresa
-- -----------------------------------------------------------------
-- Uma pessoa pode operar várias empresas; uma empresa pode ter várias
-- pessoas autorizadas. Este é o vínculo "de cadastro" (quem pode agir
-- em nome de quem dentro do produto).
--
-- Diferença em relação a company_operator_links (do schema de identidade):
-- company_operator_links registra a PROVA técnica do vínculo (qual conexão
-- bancária comprovou que esta pessoa tem acesso à conta da empresa).
-- user_companies é o vínculo "ativo no produto" — referencia esse comprovante,
-- mas é o que o backend consulta no dia a dia (ex: "quais empresas Maria pode operar").

create type public.user_company_role as enum (
  'owner',        -- sócio/representante legal
  'authorized'    -- autorizado via acesso bancário, não necessariamente sócio
);

create type public.user_company_status as enum (
  'active',
  'revoked'
);

create table public.user_companies (
  id uuid not null default gen_random_uuid(),

  user_id uuid not null,
  company_id uuid not null,

  role public.user_company_role not null default 'authorized',
  status public.user_company_status not null default 'active',

  -- aponta para o vínculo técnico que comprovou esta associação
  -- (a verificação bancária PJ feita por este user para esta company)
  company_operator_link_id uuid null,

  linked_at timestamp without time zone not null default now(),
  revoked_at timestamp without time zone null,

  constraint user_companies_pkey primary key (id),
  constraint user_companies_user_fk
    foreign key (user_id)
    references public.users (id)
    on delete cascade,
  constraint user_companies_company_fk
    foreign key (company_id)
    references public.companies (id)
    on delete cascade,
  constraint user_companies_operator_link_fk
    foreign key (company_operator_link_id)
    references public.company_operator_links (id)
    on delete set null,
  constraint user_companies_unique
    unique (user_id, company_id)
) TABLESPACE pg_default;

create index user_companies_user_idx on public.user_companies (user_id);
create index user_companies_company_idx on public.user_companies (company_id);
create index user_companies_status_idx on public.user_companies (status);


-- -----------------------------------------------------------------
-- 4. Triggers de updated_at
-- -----------------------------------------------------------------
-- Reaproveita a função set_updated_at() já criada no schema de identidade.
-- Caso este script seja executado isoladamente, descomente a criação da função abaixo.

-- create or replace function public.set_updated_at()
-- returns trigger as $$
-- begin
--   new.updated_at = now();
--   return new;
-- end;
-- $$ language plpgsql;

create trigger users_set_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();

create trigger companies_set_updated_at
  before update on public.companies
  for each row
  execute function public.set_updated_at();
