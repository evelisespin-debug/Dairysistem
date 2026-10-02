-- Teste de personalidade (16 tipos): quem fez, setor, respostas e resultado.
create table personality_tests (
  id bigserial primary key,
  person_name text not null,
  sector text not null,
  test_key text not null,
  type char(4) not null,
  scores jsonb not null,
  answers jsonb not null,
  taken_by bigint references users(id),
  taken_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index personality_sector_idx on personality_tests (lower(sector)) where deleted_at is null;
