-- Animais (mínimo para o piloto de qualidade do leite) e análises
create table animals (
  id bigserial primary key,
  tag text not null,                       -- brinco
  breed text,
  birth_date date,
  lot text,
  status text not null default 'lactacao'
    check (status in ('lactacao','seca','novilha','bezerra','descartada','vendida','morta')),
  mother_id bigint references animals(id),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index animals_tag_uq on animals (upper(tag)) where deleted_at is null;
create index animals_lot_idx on animals(lot);

-- Tipos de análise configuráveis (CCS, gordura, ...). Limites são ajustáveis pelo dono/vet.
create table analysis_types (
  code text primary key,
  name text not null,
  unit text not null default '',
  decimals int not null default 2,
  aliases text[] not null default '{}',     -- nomes alternativos em planilhas
  geometric boolean not null default false, -- média geométrica (CCS, CBT)
  scale text not null default 'animal' check (scale in ('animal','tank','both')),
  warn_high numeric, alert_high numeric,    -- valor acima: atenção / alerta
  warn_low numeric, alert_low numeric,      -- valor abaixo: atenção / alerta
  tank_warn_high numeric, tank_alert_high numeric,   -- limites do tanque/laticínio
  tank_warn_low numeric, tank_alert_low numeric,
  sort_order int not null default 100,
  active boolean not null default true
);

create table import_batches (
  id bigserial primary key,
  filename text,
  user_id bigint references users(id),
  created_at timestamptz not null default now(),
  rows_total int not null default 0,
  rows_ok int not null default 0,
  rows_error int not null default 0,
  animals_created int not null default 0,
  undone_at timestamptz
);

-- 'animal' = análise individual da vaca; 'tank' = tanque/laticínio (mapa do leite)
create table analyses (
  id bigserial primary key,
  scope text not null default 'animal' check (scope in ('animal','tank')),
  animal_id bigint references animals(id),
  analysis_date date not null,
  type_code text not null references analysis_types(code),
  value numeric not null,
  source text not null default 'manual',    -- manual | importacao | ...
  batch_id bigint references import_batches(id),
  client_uuid uuid,                         -- evita duplicar lançamentos feitos offline
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((scope = 'animal' and animal_id is not null) or (scope = 'tank' and animal_id is null))
);
-- Um valor por vaca/dia/tipo: reimportar a mesma planilha não duplica.
create unique index analyses_natural_uq
  on analyses (scope, coalesce(animal_id, 0), analysis_date, type_code) where deleted_at is null;
create unique index analyses_client_uq on analyses (client_uuid) where client_uuid is not null;
create index analyses_animal_idx on analyses (animal_id, analysis_date desc);
create index analyses_date_idx on analyses (type_code, analysis_date);

-- Limites iniciais são sugestões (ajustáveis na tela de configuração pelo dono/veterinária).
insert into analysis_types (code, name, unit, decimals, aliases, geometric, scale,
  warn_high, alert_high, warn_low, alert_low, tank_warn_high, tank_alert_high, tank_warn_low, tank_alert_low, sort_order) values
 ('CCS','Contagem de Células Somáticas','mil cél/mL',0, array['ccs','scc','celulas somaticas','contagem de celulas somaticas','cel somaticas'], true,'both',
   200, 400, null, null, 400, 500, null, null, 10),
 ('CBT','Contagem Bacteriana Total','mil UFC/mL',0, array['cbt','ctb','cpp','contagem bacteriana','contagem bacteriana total','ufc'], true,'tank',
   null, null, null, null, 100, 300, null, null, 20),
 ('GORDURA','Gordura','%',2, array['gordura','gord','fat'], false,'both',
   null, null, 3.2, 2.8, null, null, 3.1, 3.0, 30),
 ('PROTEINA','Proteína','%',2, array['proteina','prot','protein'], false,'both',
   null, null, 3.0, 2.8, null, null, 3.0, 2.9, 40);
