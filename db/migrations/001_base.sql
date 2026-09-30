-- Base: fazenda, usuários, sessões, auditoria
create table farm (
  id int primary key default 1 check (id = 1),   -- uma fazenda por banco
  slug text not null,
  name text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table users (
  id bigserial primary key,
  name text not null,
  email text not null,
  role text not null check (role in ('dono','encarregado','funcionario','veterinaria')),
  pass_hash text,
  pin_hash text,
  active boolean not null default true,
  must_change_password boolean not null default false,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  can_see_finance boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index users_email_uq on users (lower(email)) where deleted_at is null;

create table sessions (
  token_hash text primary key,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index sessions_user_idx on sessions(user_id);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id bigint references users(id),
  action text not null,          -- criar | alterar | apagar | restaurar | login | importar ...
  entity text not null,
  entity_id text,
  changes jsonb
);
create index audit_entity_idx on audit_log(entity, entity_id);
create index audit_at_idx on audit_log(at desc);
