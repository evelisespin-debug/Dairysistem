-- Resultados genômicos por animal (um registro por animal; reenviar o arquivo atualiza).
create table animal_genomics (
  animal_id bigint primary key references animals(id) on delete cascade,
  genomic_id text,
  naab text,                      -- touro (NAAB) após a conferência de paternidade
  sire_name text,
  sire_sent text,                 -- touro informado pela fazenda
  sire_check text,                -- 'OK', 'No ABS found' ou NAAB do touro correto
  dam_reg text,
  ic numeric, nm numeric, tpi numeric,
  milk numeric, fat numeric, protein numeric,
  fat_pct numeric, pro_pct numeric, dpr numeric,
  beta_casein text, kappa_casein text,
  haplotypes text[] not null default '{}',   -- portadores: HH1, HH3, HH4, HH5, HH6, DUMPS
  traits jsonb not null default '{}'::jsonb, -- todas as demais colunas do arquivo
  batch_date date,
  updated_at timestamptz not null default now()
);
create index animal_genomics_tpi_idx on animal_genomics (tpi desc);
