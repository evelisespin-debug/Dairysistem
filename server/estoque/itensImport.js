import { readTable } from '../importer.js';
import { audit } from '../auth.js';
import { canonUnit, digits, norm } from './nfe.js';

const key = (h) => norm(String(h ?? '').replace(/\(.*?\)/g, '')).replace(/[^a-z0-9]/g, '');
const COLS = {
  name: ['nome', 'item', 'descricao', 'produto', 'nomedoitem'],
  code: ['codigo', 'cod', 'codigointerno', 'codinterno'],
  barcode: ['codigodebarras', 'codigobarras', 'barras', 'ean', 'gtin', 'qrcode'],
  category: ['categoria', 'grupo', 'familia'],
  unit: ['unidade', 'un', 'unidadedemedida', 'und'],
  pack_unit: ['embalagem', 'unidadedecompra', 'unidadecompra'],
  pack_factor: ['fator', 'conversao', 'fatordeconversao', 'fatorconversao', 'qtdembalagem', 'quantidadeporembalagem'],
  supplier: ['fornecedor', 'fornecedorpadrao'],
  location: ['local', 'localpadrao', 'localdearmazenamento', 'deposito'],
  min_stock: ['estoqueminimo', 'minimo', 'estminimo', 'estoquemin'],
  controls_lot: ['controlalote', 'controlalotevalidade', 'lote', 'controlelote'],
  cost_center: ['setor', 'setorpadrao', 'centrodecusto', 'setorsugerido'],
  require_cc: ['exigesetor', 'exigirsetor', 'exigesetornassaidas', 'exigirsetornassaidas'],
  ncm: ['ncm'],
};
const yes = (v) => /^(s|sim|1|true|x|yes|verdadeiro)$/i.test(String(v ?? '').trim());
const numv = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/\./g, (m, i, s) => (s.includes(',') ? '' : m)).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

export const TEMPLATE_CSV = '﻿Nome;Código;Código de barras;Categoria;Unidade;Embalagem;Fator (unidades por embalagem);Fornecedor;Local;Estoque mínimo;Controla lote (sim/não);Setor;Exige setor nas saídas (sim/não)\r\n'
  + 'Ração lactação 22%;RAC001;;Ração/concentrado;kg;saco;25;Cooperativa Exemplo;Depósito de ração;2000;não;Rebanho em lactação;não\r\n'
  + 'Ivermectina 1%;MED010;7891234567890;Medicamento;L;;;Agro Vet Exemplo;Farmácia/geladeira de medicamentos;5;sim;;sim\r\n';

export async function importItems(pool, user, file, { commit }) {
  const table = await readTable(file.buffer, file.name);
  const idx = {};
  table.headers.forEach((h, i) => { for (const [f, names] of Object.entries(COLS)) if (idx[f] == null && names.includes(key(h))) idx[f] = i; });
  const problems = [];
  if (idx.name == null) problems.push('Não encontrei a coluna "Nome" do item.');
  if (idx.unit == null) problems.push('Não encontrei a coluna "Unidade".');
  if (problems.length) return { problems, rows_read: table.rows.length, errors: [], errors_total: 0 };

  const [cats, locs, ccs, sups, items] = await Promise.all([
    pool.query('select id, name from item_categories'), pool.query('select id, name from storage_locations'),
    pool.query('select id, name from cost_centers'), pool.query('select id, name from suppliers'),
    pool.query('select id, lower(code) code, lower(name) name from items')]);
  const mk = (r) => new Map(r.rows.map((x) => [norm(x.name).trim(), x.id]));
  const M = { category: mk(cats), location: mk(locs), cost_center: mk(ccs), supplier: mk(sups) };
  const byCode = new Map(items.rows.map((r) => [r.code, r.id])); const byName = new Map(items.rows.map((r) => [r.name, r.id]));
  const created = { category: new Set(), location: new Set(), cost_center: new Set(), supplier: new Set() };

  const rows = []; const errors = []; const seen = new Set();
  for (const r of table.rows) {
    const c = (f) => (idx[f] == null ? '' : String(r.cells[idx[f]] ?? '').trim());
    const name = c('name'); const unit = canonUnit(c('unit'));
    if (!name) { errors.push({ line: r.line, error: 'Nome vazio.' }); continue; }
    if (!unit) { errors.push({ line: r.line, error: `Unidade "${c('unit')}" não reconhecida (use kg, t, L, dose, unidade, saco ou caixa).` }); continue; }
    const min = numv(c('min_stock')); const factor = numv(c('pack_factor'));
    if (Number.isNaN(min) || (min != null && min < 0)) { errors.push({ line: r.line, error: 'Estoque mínimo inválido.' }); continue; }
    if (Number.isNaN(factor) || (factor != null && factor <= 0)) { errors.push({ line: r.line, error: 'Fator de conversão inválido.' }); continue; }
    const code = c('code');
    const dupKey = code ? `c:${code.toLowerCase()}` : `n:${name.toLowerCase()}`;
    if (seen.has(dupKey)) { errors.push({ line: r.line, error: 'Item repetido na planilha (a primeira linha vale).' }); continue; }
    seen.add(dupKey);
    const ref = {};
    for (const f of ['category', 'location', 'cost_center', 'supplier']) {
      const v = c(f); if (!v) continue;
      ref[f] = v; if (!M[f].has(norm(v).trim())) created[f].add(v);
    }
    const existing = (code && byCode.get(code.toLowerCase())) || byName.get(name.toLowerCase()) || null;
    rows.push({ line: r.line, existing, name, code, barcode: digits(c('barcode')) || c('barcode') || null, unit, pack_unit: canonUnit(c('pack_unit')) || null,
      pack_factor: factor, min_stock: min ?? 0, controls_lot: yes(c('controls_lot')), require_cc: yes(c('require_cc')), ncm: c('ncm') || null, ref });
  }
  const preview = {
    problems: [], rows_read: table.rows.length, to_create: rows.filter((r) => !r.existing).length, to_update: rows.filter((r) => r.existing).length,
    errors: errors.slice(0, 30), errors_total: errors.length,
    new_categories: [...created.category], new_locations: [...created.location], new_cost_centers: [...created.cost_center], new_suppliers: [...created.supplier],
  };
  if (!commit) return preview;

  const client = await pool.connect();
  try {
    await client.query('begin');
    const ensure = async (f, table_, extra = '') => {
      const created_ = new Map();
      for (const name of created[f]) {
        const r = await client.query(`insert into ${table_} (name${extra ? ', created_from' : ''}) values ($1${extra ? ", 'manual'" : ''})
          on conflict do nothing returning id`, [name]);
        const id = r.rows[0]?.id ?? (await client.query(`select id from ${table_} where lower(name) = lower($1)`, [name])).rows[0].id;
        created_.set(norm(name).trim(), id);
      }
      return created_;
    };
    const N = {
      category: await ensure('category', 'item_categories'), location: await ensure('location', 'storage_locations'),
      cost_center: await ensure('cost_center', 'cost_centers'), supplier: await ensure('supplier', 'suppliers', 'x'),
    };
    const id = (f, v) => (v ? (M[f].get(norm(v).trim()) ?? N[f].get(norm(v).trim()) ?? null) : null);
    let inserted = 0; let updated = 0;
    for (const r of rows) {
      const v = [r.name, r.barcode, id('category', r.ref.category), r.unit, r.pack_unit, r.pack_factor, r.ncm, id('supplier', r.ref.supplier),
        id('location', r.ref.location), r.min_stock, r.controls_lot, id('cost_center', r.ref.cost_center), r.require_cc];
      if (r.existing) {
        await client.query(
          `update items set name=$2, barcode=$3, category_id=$4, unit=$5, pack_unit=$6, pack_factor=$7, ncm=$8, supplier_id=$9, default_location_id=$10,
             min_stock=$11, controls_lot=$12, default_cost_center_id=$13, require_cost_center=$14, updated_at=now() where id=$1`, [r.existing, ...v]);
        updated++;
      } else {
        const code = r.code || `IT${String((await client.query(`select nextval('item_code_seq') n`)).rows[0].n).padStart(5, '0')}`;
        await client.query(
          `insert into items (code, name, barcode, category_id, unit, pack_unit, pack_factor, ncm, supplier_id, default_location_id, min_stock, controls_lot, default_cost_center_id, require_cost_center)
           values ($14,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [...v, code]);
        inserted++;
      }
    }
    await audit(client, user.id, 'importar', 'items', null, { arquivo: file.name, criados: inserted, atualizados: updated });
    await client.query('commit');
    return { ...preview, inserted, updated };
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
}
