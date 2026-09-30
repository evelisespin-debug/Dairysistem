-- Desempenho zootécnico mensal: guardamos só o que é digitado/importado; percentuais e taxas são calculados no servidor.
create table perf_values (
  year int not null,
  month int not null check (month between 1 and 12),
  code text not null,
  value numeric not null,
  source text not null default 'manual',      -- manual | planilha | planilha-comparativo
  updated_by bigint references users(id),
  updated_at timestamptz not null default now(),
  primary key (year, month, code)
);
-- Metas por indicador (opcionais, definidas pela fazenda/veterinária)
create table perf_targets (
  code text primary key,
  target numeric not null,
  updated_by bigint references users(id),
  updated_at timestamptz not null default now()
);
