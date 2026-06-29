-- =========================================================
-- Balkao — Schema de Endereços
-- Complementa balkao_users_companies_schema.sql
-- =========================================================

-- -----------------------------------------------------------------
-- 1. ADDRESSES — tabela dedicada, sem dono fixo
-- -----------------------------------------------------------------
-- Um endereço existe independente de quem o usa. A ligação com
-- usuário/empresa acontece via tabelas de associação (abaixo),
-- permitindo múltiplos endereços por dono E múltiplos donos por
-- endereço (ex: dois sócios usando o mesmo endereço da empresa).

create table public.addresses (
  id uuid not null default gen_random_uuid(),

  postal_code text not null,             -- CEP
  street text not null,
  number text null,
  complement text null,
  neighborhood text null,
  city text not null,
  state text not null,                   -- UF
  country text not null default 'BR',

  latitude double precision null,
  longitude double precision null,

  archived_at timestamp without time zone null,  -- soft delete: nunca apagar de fato um endereço
                                                  -- já usado em algum pedido. Endereços arquivados
                                                  -- somem das opções ativas, mas a FK de pedidos antigos continua válida.

  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now(),

  constraint addresses_pkey primary key (id)
) TABLESPACE pg_default;

create index addresses_postal_code_idx on public.addresses (postal_code);


-- -----------------------------------------------------------------
-- 2. ADDRESS_KIND — papel que o endereço exerce para aquele dono
-- -----------------------------------------------------------------
-- Compartilhado entre user_addresses e company_addresses, para manter
-- o mesmo vocabulário de papéis nos dois casos.

create type public.address_kind as enum (
  'primary',      -- endereço fixo/principal
  'delivery',      -- endereço de entrega (pode ter vários, um por transação se necessário)
  'billing',       -- endereço de cobrança, se um dia for necessário separar
  'business'       -- endereço comercial/operacional (mais comum em company_addresses)
);


-- -----------------------------------------------------------------
-- 3. USER_ADDRESSES — vínculo N:N entre users e addresses
-- -----------------------------------------------------------------

create table public.user_addresses (
  id uuid not null default gen_random_uuid(),

  user_id uuid not null,
  address_id uuid not null,

  kind public.address_kind not null default 'primary',
  is_default boolean not null default false,  -- qual usar quando o fluxo não pede explicitamente

  label text null,                        -- texto livre do próprio usuário, ex: "Casa da minha mãe"

  created_at timestamp without time zone not null default now(),

  constraint user_addresses_pkey primary key (id),
  constraint user_addresses_user_fk
    foreign key (user_id)
    references public.users (id)
    on delete cascade,
  constraint user_addresses_address_fk
    foreign key (address_id)
    references public.addresses (id)
    on delete cascade
) TABLESPACE pg_default;

create index user_addresses_user_idx on public.user_addresses (user_id);
create index user_addresses_address_idx on public.user_addresses (address_id);

-- Garante que só exista 1 endereço default por (user, kind)
create unique index user_addresses_one_default_per_kind
  on public.user_addresses (user_id, kind)
  where is_default;

-- NOTA: ao arquivar um endereço (addresses.archived_at), o backend deve
-- desmarcar is_default em qualquer user_addresses que o referencie, e
-- decidir (regra de produto, não de schema) se promove outro endereço
-- do mesmo kind como novo default. SQL não resolve essa decisão sozinho.


-- -----------------------------------------------------------------
-- 4. COMPANY_ADDRESSES — vínculo N:N entre companies e addresses
-- -----------------------------------------------------------------

create table public.company_addresses (
  id uuid not null default gen_random_uuid(),

  company_id uuid not null,
  address_id uuid not null,

  kind public.address_kind not null default 'business',
  is_default boolean not null default false,

  label text null,

  created_at timestamp without time zone not null default now(),

  constraint company_addresses_pkey primary key (id),
  constraint company_addresses_company_fk
    foreign key (company_id)
    references public.companies (id)
    on delete cascade,
  constraint company_addresses_address_fk
    foreign key (address_id)
    references public.addresses (id)
    on delete cascade
) TABLESPACE pg_default;

create index company_addresses_company_idx on public.company_addresses (company_id);
create index company_addresses_address_idx on public.company_addresses (address_id);

create unique index company_addresses_one_default_per_kind
  on public.company_addresses (company_id, kind)
  where is_default;


-- -----------------------------------------------------------------
-- 5. Trigger de updated_at para addresses
-- -----------------------------------------------------------------
-- Reaproveita a função set_updated_at() já criada anteriormente.

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row
  execute function public.set_updated_at();
