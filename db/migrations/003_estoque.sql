-- Fase 1: controle de estoque.
-- Desenho pensado para a Fase 2 (financeiro): toda compra guarda fornecedor, totais, forma de pagamento e
-- parcelas (vencimento/valor); todo movimento guarda custo e centro de custo. Nada disso precisa mudar depois:
-- a Fase 2 só cria "contas a pagar" apontando para purchases.id.

-- Novos perfis. 'dono' = proprietário; 'encarregado' passa a ser o encarregado de setor.
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check
  check (role in ('dono','gerente','almoxarife','encarregado','funcionario','veterinaria'));

-- ---------- cadastros editáveis ----------
create table cost_centers (
  id bigserial primary key,
  name text not null,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index cost_centers_name_uq on cost_centers (lower(name));

create table storage_locations (
  id bigserial primary key,
  name text not null,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index storage_locations_name_uq on storage_locations (lower(name));

create table item_categories (
  id bigserial primary key,
  name text not null,
  active boolean not null default true,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);
create unique index item_categories_name_uq on item_categories (lower(name));

insert into cost_centers (name, sort_order) values
  ('Ordenha',1),('Rebanho em lactação',2),('Vacas secas/pré-parto',3),('Bezerreiro/Recria',4),
  ('Agrícola (silagem e grãos)',5),('Máquinas e frota',6),('Manutenção/Construção',7),('Administrativo',8);
insert into storage_locations (name, sort_order) values
  ('Almoxarifado',1),('Depósito de ração',2),('Farmácia/geladeira de medicamentos',3),('Botijão de sêmen',4),
  ('Silo',5),('Tanque de diesel',6),('Galpão de máquinas',7);
insert into item_categories (name, sort_order) values
  ('Ração/concentrado',1),('Núcleo mineral',2),('Medicamento',3),('Vacina',4),('Sêmen',5),
  ('Material de ordenha (pré e pós-dipping etc.)',6),('Sementes',7),('Adubo/corretivo',8),('Defensivos',9),
  ('Peças e manutenção',10),('Combustível/lubrificantes',11),('Silagem/feno/grãos',12),('Outros',99);

create table suppliers (
  id bigserial primary key,
  name text not null,                 -- razão social ou nome
  trade_name text,                    -- nome fantasia
  doc text,                           -- CNPJ/CPF só com dígitos
  contact text,
  payment_terms text,                 -- condições de pagamento (texto livre)
  active boolean not null default true,
  created_from text not null default 'manual',   -- manual | nota
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index suppliers_doc_uq on suppliers (doc) where doc is not null;
create index suppliers_name_idx on suppliers (lower(name));

-- ---------- itens ----------
create sequence item_code_seq;
create table items (
  id bigserial primary key,
  code text not null,
  name text not null,
  barcode text,
  photo bytea,
  photo_type text,
  category_id bigint references item_categories(id),
  unit text not null check (unit in ('kg','t','L','dose','unidade','saco','caixa')),
  pack_unit text,                     -- embalagem de compra (ex.: saco)
  pack_factor numeric(14,4) check (pack_factor is null or pack_factor > 0),   -- ex.: 25 (1 saco = 25 kg)
  ncm text,
  supplier_id bigint references suppliers(id),
  default_location_id bigint references storage_locations(id),
  min_stock numeric(14,3) not null default 0,
  controls_lot boolean not null default false,
  default_cost_center_id bigint references cost_centers(id),
  require_cost_center boolean not null default false,
  avg_cost numeric(14,4) not null default 0,     -- custo médio móvel (R$ por unidade do item)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index items_code_uq on items (lower(code));
create index items_name_idx on items (lower(name));
create index items_barcode_idx on items (barcode) where barcode is not null;

create table stock_lots (
  id bigserial primary key,
  item_id bigint not null references items(id),
  lot_code text not null,
  expiry date,
  created_at timestamptz not null default now(),
  unique (item_id, lot_code)
);

-- de-para aprendido: código do fornecedor -> item interno (+ conversão)
create table supplier_item_map (
  supplier_id bigint not null references suppliers(id),
  supplier_code text not null,
  item_id bigint not null references items(id),
  factor numeric(14,4) not null default 1 check (factor > 0),   -- unidades do item por unidade da nota
  nf_unit text,
  updated_at timestamptz not null default now(),
  primary key (supplier_id, supplier_code)
);

-- ---------- compras (entrada por nota / manual) ----------
create table purchases (
  id bigserial primary key,
  source text not null check (source in ('xml','danfe','chave','manual')),
  chave_acesso char(44),
  model text, series text, number text,
  issue_date date,
  entry_date date not null,
  supplier_id bigint not null references suppliers(id),
  total_products numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  freight numeric(14,2) not null default 0,
  insurance numeric(14,2) not null default 0,
  other_expenses numeric(14,2) not null default 0,
  ipi_total numeric(14,2) not null default 0,
  st_total numeric(14,2) not null default 0,
  total_invoice numeric(14,2) not null,          -- total que compõe o custo do estoque
  taxes jsonb,                                   -- impostos informativos da nota (ICMS, PIS, COFINS...)
  payment_method text,                           -- forma de pagamento (para a Fase 2)
  payment_terms text,
  notes text,
  xml text,                                      -- XML original, quando houve
  status text not null default 'confirmada' check (status in ('confirmada','cancelada')),
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by bigint references users(id),
  cancel_reason text
);
create unique index purchases_chave_uq on purchases (chave_acesso) where chave_acesso is not null and status = 'confirmada';
create index purchases_supplier_idx on purchases (supplier_id, entry_date desc);
create index purchases_date_idx on purchases (entry_date desc);

create table purchase_items (
  id bigserial primary key,
  purchase_id bigint not null references purchases(id) on delete cascade,
  line_no int not null,
  supplier_code text, description text not null, ncm text, ean text,
  nf_unit text,
  qty numeric(14,4) not null,
  unit_price numeric(14,6) not null default 0,
  total numeric(14,2) not null,                  -- valor bruto do item
  discount numeric(14,2) not null default 0,
  ipi numeric(14,2) not null default 0,
  st numeric(14,2) not null default 0,
  landed_total numeric(14,2) not null,           -- custo final do item (rateios e impostos no custo)
  item_id bigint not null references items(id),
  factor numeric(14,4) not null default 1,
  stock_qty numeric(14,3) not null,              -- quantidade na unidade do item
  unit_cost numeric(14,4) not null
);
create index purchase_items_purchase_idx on purchase_items (purchase_id);
create index purchase_items_item_idx on purchase_items (item_id);

create table purchase_installments (
  id bigserial primary key,
  purchase_id bigint not null references purchases(id) on delete cascade,
  number text,
  due_date date not null,
  amount numeric(14,2) not null,
  payment_method text
);
create index purchase_installments_due_idx on purchase_installments (due_date);

-- ---------- razão do estoque (imutável: correção = novo movimento) ----------
create table stock_movements (
  id bigserial primary key,
  kind text not null check (kind in ('entrada','saida','transf_saida','transf_entrada','ajuste','estorno')),
  item_id bigint not null references items(id),
  location_id bigint not null references storage_locations(id),
  lot_id bigint references stock_lots(id),
  qty numeric(14,3) not null check (qty <> 0),   -- com sinal: entrada +, saída −
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) not null default 0,   -- com sinal, igual ao de qty
  cost_center_id bigint references cost_centers(id),
  purchase_id bigint references purchases(id),
  purchase_item_id bigint references purchase_items(id),
  occurred_on date not null,
  note text,
  user_id bigint references users(id),
  created_at timestamptz not null default now()
);
create index stock_movements_item_idx on stock_movements (item_id, location_id);
create index stock_movements_date_idx on stock_movements (occurred_on desc);
create index stock_movements_cc_idx on stock_movements (cost_center_id) where cost_center_id is not null;
create index stock_movements_purchase_idx on stock_movements (purchase_id) where purchase_id is not null;
