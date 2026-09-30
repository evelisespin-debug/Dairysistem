import { audit } from '../auth.js';
import { allocateCosts, canonUnit, chaveDigitOk, cnpjValid, digits, docValid, parseChave, parseNfeXml, similarity } from './nfe.js';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (msg, extra) => new HttpError(400, msg, extra);
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(s));
const todayBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // aproximação de America/Sao_Paulo

// ---------------------------------------------------------------------------
// Rascunho para conferência (nada é gravado)
// ---------------------------------------------------------------------------
export async function buildDraft(pool, parsed, { low = [] } = {}) {
  const warnings = [...(parsed.warnings || [])];
  const doc = digits(parsed.supplier?.doc);
  const sup = doc ? (await pool.query('select id, name, payment_terms from suppliers where doc = $1', [doc])).rows[0] : null;
  const dup = parsed.chave
    ? (await pool.query(`select id, number, entry_date from purchases where chave_acesso = $1 and status = 'confirmada'`, [parsed.chave])).rows[0] : null;
  if (dup) warnings.push(`Esta nota já foi lançada em ${dup.entry_date.split('-').reverse().join('/')} (nota ${dup.number}).`);

  const items = (await pool.query(
    `select i.id, i.code, i.name, i.barcode, i.unit, i.pack_unit, i.pack_factor, i.controls_lot, i.default_location_id, i.active
       from items i where i.active`)).rows;
  const maps = sup ? new Map((await pool.query('select * from supplier_item_map where supplier_id = $1', [sup.id])).rows.map((m) => [m.supplier_code, m])) : new Map();
  const byId = new Map(items.map((i) => [i.id, i]));
  const byBarcode = new Map(items.filter((i) => i.barcode).map((i) => [i.barcode, i]));

  const factorFor = (item, nfUnit, mapped) => {
    if (mapped) return { factor: Number(mapped.factor), guess: false };
    const cu = canonUnit(nfUnit);
    if (!cu || cu === item.unit) return { factor: 1, guess: !!cu ? false : !!nfUnit };
    if (item.pack_factor && (cu === canonUnit(item.pack_unit))) return { factor: Number(item.pack_factor), guess: false };
    if (cu === 't' && item.unit === 'kg') return { factor: 1000, guess: false };
    if (cu === 'kg' && item.unit === 't') return { factor: 0.001, guess: false };
    return { factor: 1, guess: true };          // unidades diferentes sem regra: o usuário confere
  };

  const lines = parsed.items.map((ln) => {
    const cands = [];
    const push = (item, reason, score) => { if (item && !cands.some((c) => c.item_id === item.id)) cands.push({ item_id: item.id, name: item.name, code: item.code, unit: item.unit, reason, score }); };
    const m = maps.get(ln.supplier_code);
    if (m) push(byId.get(m.item_id), 'mapa', 1);
    if (ln.ean && byBarcode.has(ln.ean)) push(byBarcode.get(ln.ean), 'ean', 0.98);
    for (const it of items.map((i) => ({ i, s: similarity(ln.description, i.name) })).filter((x) => x.s >= 0.4).sort((a, b) => b.s - a.s).slice(0, 4)) push(it.i, 'descricao', +it.s.toFixed(2));
    const top = cands[0];
    const item = top ? byId.get(top.item_id) : null;
    const f = item ? factorFor(item, ln.nf_unit, top.reason === 'mapa' ? m : null) : { factor: 1, guess: false };
    return {
      ...ln, candidates: cands,
      suggestion: top && (top.reason !== 'descricao' || top.score >= 0.6) ? { item_id: top.item_id, reason: top.reason, score: top.score } : null,
      factor: f.factor, factor_guess: f.guess,
      needs_lot: !!item?.controls_lot,
      suggested_unit_hint: canonUnit(ln.nf_unit),
    };
  });

  const alloc = allocateCosts(parsed.items, parsed.header || {});
  const invoice = money(parsed.totals?.invoice);
  if (parsed.source === 'xml' && invoice && Math.abs(alloc.total - invoice) > 0.05) {
    warnings.push(`Os itens somam R$ ${alloc.total.toFixed(2)} e o total da nota é R$ ${invoice.toFixed(2)}. Confira antes de dar entrada.`);
  }
  if (parsed.chave && !chaveDigitOk(parsed.chave)) warnings.push('A chave de acesso não passou na validação. Confira os 44 números.');
  if (doc && !docValid(doc)) warnings.push('O CNPJ/CPF do fornecedor não passou na validação.');
  if (parsed.chave && doc && parsed.chave.slice(6, 20) !== doc && parsed.supplier?.doc) warnings.push('O CNPJ do fornecedor não bate com o CNPJ da chave de acesso.');

  return {
    source: parsed.source, chave: parsed.chave, model: parsed.model, series: parsed.series, number: parsed.number,
    issue_date: parsed.issue_date, nature: parsed.nature || '', xml: parsed.xml || null,
    supplier: { doc, name: parsed.supplier?.name || '', trade_name: parsed.supplier?.trade_name || '', existing: sup ? { id: sup.id, name: sup.name, payment_terms: sup.payment_terms } : null },
    items: lines, header: parsed.header || {}, totals: { ...parsed.totals, computed: alloc.total }, cost_lines: alloc.lines,
    taxes: parsed.taxes || null, installments: parsed.installments || [], payment_method: parsed.payment_method || '',
    notes: parsed.notes || '', duplicate: dup ? { id: dup.id, entry_date: dup.entry_date } : null, warnings, low,
    header_only: !!parsed.header_only,
  };
}

// ---------------------------------------------------------------------------
// Leitura de foto/PDF: normaliza a resposta da IA e marca campos de baixa confiança
// ---------------------------------------------------------------------------
const LOW = 0.8;
export function normalizeOcr(o) {
  const low = []; const warnings = [];
  const val = (f, path, kind = 'text') => {
    if (f == null || typeof f !== 'object') return kind === 'number' ? 0 : '';
    if (typeof f.c === 'number' && f.c < LOW) low.push(path);
    if (kind === 'number') return Number(f.v) || 0;
    return String(f.v ?? '').trim();
  };
  const chaveRaw = digits(val(o.chave, 'chave'));
  let chave = chaveRaw.length === 44 ? chaveRaw : null;
  if (chave && !chaveDigitOk(chave)) { low.push('chave'); warnings.push('A chave lida não passou na validação: alguns dígitos foram lidos errado.'); }
  if (!chave && chaveRaw) low.push('chave');
  const doc = digits(val(o.fornecedor_doc, 'supplier.doc'));
  if (doc && !docValid(doc) && !low.includes('supplier.doc')) low.push('supplier.doc');
  const items = (o.itens || []).map((it, i) => {
    const p = `items.${i}`;
    const qty = val(it.quantidade, `${p}.qty`, 'number'); const total = val(it.valor_total, `${p}.total`, 'number');
    let unit_price = val(it.valor_unitario, `${p}.unit_price`, 'number');
    if (!unit_price && qty) unit_price = total / qty;
    else if (qty && Math.abs(unit_price * qty - total) > Math.max(0.05, total * 0.01)) { low.push(`${p}.qty`, `${p}.unit_price`, `${p}.total`); }
    const lot = val(it.lote, `${p}.lot`); const expiry = val(it.validade, `${p}.expiry`);
    return {
      n: i + 1, supplier_code: val(it.codigo, `${p}.code`), description: val(it.descricao, `${p}.description`), ncm: digits(val(it.ncm, `${p}.ncm`)), ean: '',
      nf_unit: val(it.unidade, `${p}.unit`), qty, unit_price, total, discount: 0, ipi: 0, st: 0,
      lots: lot ? [{ lot_code: lot, qty, expiry: isDate(expiry) ? expiry : null }] : [],
    };
  });
  const totalNota = val(o.total_nota, 'totals.invoice', 'number');
  const header = { freight: val(o.frete, 'header.freight', 'number'), insurance: val(o.seguro, 'header.insurance', 'number'),
    other: val(o.outras_despesas, 'header.other', 'number'), discount: val(o.desconto, 'header.discount', 'number'), ipi: val(o.ipi, 'header.ipi', 'number'), st: 0 };
  const alloc = allocateCosts(items, header);
  if (totalNota && Math.abs(alloc.total - totalNota) > 0.05) {
    low.push('totals.invoice'); warnings.push(`Os itens lidos somam R$ ${alloc.total.toFixed(2)} e o total lido é R$ ${totalNota.toFixed(2)}: algum valor foi lido errado.`);
  }
  const date = val(o.data_emissao, 'issue_date');
  return {
    source: 'danfe', chave, model: chave ? chave.slice(20, 22) : '55', series: val(o.serie, 'series'), number: val(o.numero, 'number'),
    issue_date: isDate(date) ? date : null, supplier: { doc, name: val(o.fornecedor_nome, 'supplier.name'), trade_name: '' },
    items, header, totals: { products: val(o.total_produtos, 'totals.products', 'number'), invoice: totalNota || alloc.total },
    installments: (o.parcelas || []).filter((p) => isDate(p.vencimento)).map((p, i) => ({ number: p.numero || String(i + 1), due_date: p.vencimento, amount: Number(p.valor) || 0 })),
    payment_method: val(o.forma_pagamento, 'payment_method'), notes: '', warnings, low: [...new Set(low)],
  };
}

// Rascunho só com o que a chave de acesso informa (quando o XML não pôde ser buscado).
export function draftFromChave(k) {
  return {
    source: 'chave', chave: k.chave, model: k.model, series: k.series, number: k.number, issue_date: null,
    supplier: { doc: k.cnpj, name: '', trade_name: '' }, items: [], header: {}, totals: { products: 0, invoice: 0 }, installments: [],
    payment_method: '', notes: '', header_only: true, low: [],
    warnings: [`Chave lida (${k.uf || 'UF ?'}, ${k.year_month.split('-').reverse().join('/')}). Os itens não puderam ser buscados automaticamente: envie o XML ou lance os itens abaixo.`],
  };
}

// ---------------------------------------------------------------------------
// Confirmação ("Dar entrada")
// ---------------------------------------------------------------------------
async function nextItemCode(db) {
  return `IT${String((await db.query(`select nextval('item_code_seq') n`)).rows[0].n).padStart(5, '0')}`;
}

export async function findOrCreateSupplier(db, s, from = 'nota') {
  const doc = digits(s.doc) || null;
  if (s.id) {
    const r = await db.query('select id from suppliers where id = $1', [+s.id]);
    if (!r.rows.length) throw bad('Fornecedor não encontrado.');
    return r.rows[0].id;
  }
  if (doc) {
    const r = await db.query('select id from suppliers where doc = $1', [doc]);
    if (r.rows.length) return r.rows[0].id;
  }
  const name = String(s.name || '').trim();
  if (!name) throw bad('Informe o fornecedor (nome ou razão social).');
  const { rows } = await db.query(
    `insert into suppliers (name, trade_name, doc, contact, payment_terms, created_from) values ($1,$2,$3,$4,$5,$6) returning id`,
    [name, s.trade_name || null, doc, s.contact || null, s.payment_terms || null, from]);
  return rows[0].id;
}

export async function confirmPurchase(pool, user, body) {
  let src = body || {};
  const source = ['xml', 'danfe', 'chave', 'manual'].includes(src.source) ? src.source : 'manual';
  let xml = null; let xmlParsed = null;
  if (source === 'xml') {
    if (!src.xml) throw bad('O XML da nota não foi enviado junto.');
    xmlParsed = parseNfeXml(src.xml); xml = src.xml;
  }
  // Com XML, cabeçalho, totais e parcelas vêm do XML (fonte oficial); do usuário só vêm de-para, lotes e locais.
  const base = xmlParsed ? { ...xmlParsed } : {
    chave: digits(src.chave) || null, model: src.model || null, series: src.series || '', number: src.number || '', issue_date: src.issue_date || null,
    supplier: src.supplier || {}, header: src.header || {}, installments: src.installments || [], payment_method: src.payment_method || null,
    taxes: null, totals: {},
  };
  if (base.chave && !chaveDigitOk(base.chave)) throw bad('A chave de acesso não confere (dígito verificador inválido).');
  if (base.issue_date && !isDate(base.issue_date)) throw bad('Data de emissão inválida.');
  const entryDate = src.entry_date || todayBR();
  if (!isDate(entryDate)) throw bad('Data de entrada inválida.');
  if (entryDate > todayBR()) throw bad('A data de entrada não pode ser no futuro.');
  if (!Array.isArray(src.items) || !src.items.length) throw bad('A nota não tem itens.');

  // linhas: dados fiscais do XML (se houver) + escolhas do usuário
  const lines = src.items.map((u, idx) => {
    const x = xmlParsed ? xmlParsed.items.find((i) => i.n === +u.n) : null;
    if (xmlParsed && !x) throw bad(`O item ${u.n} não existe no XML.`);
    const d = x || u;
    return {
      n: idx + 1, supplier_code: String(d.supplier_code || ''), description: String(d.description || '').trim(), ncm: d.ncm || '', ean: d.ean || '',
      nf_unit: d.nf_unit || '', qty: Number(d.qty), unit_price: Number(d.unit_price) || 0, total: Number(d.total), discount: Number(d.discount) || 0,
      ipi: Number(d.ipi) || 0, st: Number(d.st) || 0,
      item_id: u.item_id ? +u.item_id : null, new_item: u.new_item || null, factor: Number(u.factor) || 1, location_id: u.location_id ? +u.location_id : null,
      lots: Array.isArray(u.lots) ? u.lots : [], save_map: u.save_map !== false,
    };
  });
  for (const l of lines) {
    if (!l.description) throw bad(`O item ${l.n} está sem descrição.`);
    if (!(l.qty > 0)) throw bad(`Item ${l.n} (${l.description}): quantidade inválida.`);
    if (!(l.total >= 0)) throw bad(`Item ${l.n} (${l.description}): valor inválido.`);
    if (!(l.factor > 0)) throw bad(`Item ${l.n} (${l.description}): a conversão de unidade deve ser maior que zero.`);
    if (!l.item_id && !l.new_item) throw bad(`Item ${l.n} (${l.description}): escolha o item do estoque ou crie um novo.`);
  }
  const alloc = allocateCosts(lines, base.header);

  const client = await pool.connect();
  try {
    await client.query('begin');
    if (base.chave) {
      const dup = (await client.query(`select id, number, entry_date from purchases where chave_acesso = $1 and status = 'confirmada'`, [base.chave])).rows[0];
      if (dup) throw new HttpError(409, `Esta nota já foi lançada em ${dup.entry_date.split('-').reverse().join('/')}.`, { purchase_id: dup.id });
    }
    const supplierId = await findOrCreateSupplier(client, { ...base.supplier, id: src.supplier?.id }, source === 'manual' ? 'manual' : 'nota');
    const locRows = (await client.query('select id from storage_locations where active')).rows;
    const validLoc = new Set(locRows.map((r) => r.id));
    const defLoc = src.default_location_id ? +src.default_location_id : null;
    if (defLoc && !validLoc.has(defLoc)) throw bad('Local de armazenamento inválido.');

    // itens novos criados na hora (só o essencial; o gerente completa depois)
    for (const l of lines) {
      if (l.item_id) continue;
      const n = l.new_item;
      if (!String(n.name || '').trim() || !['kg', 't', 'L', 'dose', 'unidade', 'saco', 'caixa'].includes(n.unit)) throw bad(`Item ${l.n}: para criar o item informe nome e unidade.`);
      const code = String(n.code || '').trim() || await nextItemCode(client);
      const r = await client.query(
        `insert into items (code, name, barcode, category_id, unit, pack_unit, pack_factor, ncm, supplier_id, default_location_id, controls_lot)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [code, n.name.trim(), l.ean || null, n.category_id || null, n.unit, n.pack_unit || null, n.pack_factor || null, l.ncm || null, supplierId, n.default_location_id || defLoc || null, !!n.controls_lot]);
      l.item_id = r.rows[0].id;
      await audit(client, user.id, 'criar', 'item', l.item_id, { name: n.name, origem: 'entrada por nota' });
    }
    const itemIds = [...new Set(lines.map((l) => l.item_id))];
    const itemRows = new Map((await client.query('select * from items where id = any($1) for update', [itemIds])).rows.map((r) => [r.id, r]));
    for (const l of lines) {
      const it = itemRows.get(l.item_id);
      if (!it) throw bad(`Item ${l.n}: item do estoque não encontrado.`);
      if (!it.active) throw bad(`Item ${l.n}: "${it.name}" está inativo.`);
    }

    const total = alloc.total;
    const hdr = base.header || {};
    const pRow = (await client.query(
      `insert into purchases (source, chave_acesso, model, series, number, issue_date, entry_date, supplier_id, total_products, discount, freight, insurance,
         other_expenses, ipi_total, st_total, total_invoice, taxes, payment_method, payment_terms, notes, xml, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning id`,
      [source, base.chave, base.model, base.series || null, base.number || null, base.issue_date || null, entryDate, supplierId,
        money(lines.reduce((a, l) => a + l.total, 0)), alloc.extras.discount, money(hdr.freight), money(hdr.insurance), money(hdr.other),
        alloc.extras.ipi, alloc.extras.st, total, base.taxes ? JSON.stringify(base.taxes) : null, base.payment_method || null,
        src.payment_terms || null, src.notes || xmlParsed?.notes || null, xml, user.id])).rows[0];
    const purchaseId = pRow.id;

    for (const ins of base.installments || []) {
      if (!isDate(ins.due_date) || !(Number(ins.amount) > 0)) continue;
      await client.query('insert into purchase_installments (purchase_id, number, due_date, amount, payment_method) values ($1,$2,$3,$4,$5)',
        [purchaseId, ins.number || null, ins.due_date, money(ins.amount), base.payment_method || null]);
    }

    let movements = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; const it = itemRows.get(l.item_id); const landed = alloc.lines[i].landed_total;
      const stockQty = Math.round(l.qty * l.factor * 1000) / 1000;
      if (!(stockQty > 0)) throw bad(`Item ${l.n}: a quantidade convertida ficou zero.`);
      const unitCost = Math.round((landed / stockQty) * 1e4) / 1e4;
      const pi = (await client.query(
        `insert into purchase_items (purchase_id, line_no, supplier_code, description, ncm, ean, nf_unit, qty, unit_price, total, discount, ipi, st,
           landed_total, item_id, factor, stock_qty, unit_cost)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
        [purchaseId, l.n, l.supplier_code || null, l.description, l.ncm || null, l.ean || null, l.nf_unit || null, l.qty, l.unit_price, money(l.total), money(l.discount),
          money(l.ipi), money(l.st), landed, l.item_id, l.factor, stockQty, unitCost])).rows[0];

      const locationId = l.location_id || defLoc || it.default_location_id;
      if (!locationId) throw bad(`Item ${l.n} (${it.name}): escolha o local de armazenamento.`);
      if (!validLoc.has(locationId)) throw bad(`Item ${l.n}: local de armazenamento inválido.`);

      // lotes: quando o item controla lote, cada lote precisa de código e validade e a soma deve fechar
      let parts = [{ lot_id: null, qty: stockQty }];
      if (it.controls_lot) {
        const lots = l.lots.filter((x) => String(x.lot_code || '').trim());
        if (!lots.length) throw bad(`Item ${l.n} (${it.name}) controla lote: informe o lote e a validade.`);
        const rawSum = lots.reduce((a, x) => a + (Number(x.qty) || 0), 0);
        parts = [];
        for (const x of lots) {
          if (!isDate(x.expiry)) throw bad(`Item ${l.n} (${it.name}): informe a validade do lote ${x.lot_code}.`);
          const q = lots.length === 1 ? stockQty : Math.round((Number(x.qty) || 0) * l.factor * 1000) / 1000;
          if (!(q > 0)) throw bad(`Item ${l.n} (${it.name}): informe a quantidade do lote ${x.lot_code}.`);
          const lot = (await client.query(
            `insert into stock_lots (item_id, lot_code, expiry) values ($1,$2,$3)
             on conflict (item_id, lot_code) do update set expiry = coalesce(stock_lots.expiry, excluded.expiry) returning id`,
            [l.item_id, String(x.lot_code).trim(), x.expiry])).rows[0];
          parts.push({ lot_id: lot.id, qty: q });
        }
        if (lots.length > 1 && Math.abs(rawSum - l.qty) > 0.0005) throw bad(`Item ${l.n} (${it.name}): a soma dos lotes (${rawSum}) não bate com a quantidade da nota (${l.qty}).`);
      }

      const stockNow = Number((await client.query('select coalesce(sum(qty),0) q from stock_movements where item_id = $1', [l.item_id])).rows[0].q);
      for (const p of parts) {
        const partCost = Math.round(unitCost * p.qty * 100) / 100;
        await client.query(
          `insert into stock_movements (kind, item_id, location_id, lot_id, qty, unit_cost, total_cost, purchase_id, purchase_item_id, occurred_on, user_id)
           values ('entrada',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [l.item_id, locationId, p.lot_id, p.qty, unitCost, partCost, purchaseId, pi.id, entryDate, user.id]);
        movements++;
      }
      // custo médio móvel
      const oldAvg = Number(it.avg_cost) || 0;
      const newAvg = stockNow > 0 ? ((stockNow * oldAvg) + (stockQty * unitCost)) / (stockNow + stockQty) : unitCost;
      await client.query('update items set avg_cost = $2, updated_at = now() where id = $1', [l.item_id, Math.round(newAvg * 1e4) / 1e4]);
      it.avg_cost = newAvg;   // outra linha do mesmo item na mesma nota usa o custo atualizado

      if (l.save_map && l.supplier_code) {
        await client.query(
          `insert into supplier_item_map (supplier_id, supplier_code, item_id, factor, nf_unit) values ($1,$2,$3,$4,$5)
           on conflict (supplier_id, supplier_code) do update set item_id = excluded.item_id, factor = excluded.factor, nf_unit = excluded.nf_unit, updated_at = now()`,
          [supplierId, l.supplier_code, l.item_id, l.factor, l.nf_unit || null]);
      }
    }
    await audit(client, user.id, 'criar', 'purchase', purchaseId, { source, chave: base.chave, number: base.number, supplier_id: supplierId, total, itens: lines.length });
    await client.query('commit');
    return { id: purchaseId, total, items: lines.length, movements, supplier_id: supplierId };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

// Cancelar a entrada: cria movimentos de estorno (o razão nunca é alterado). Só se todo o estoque ainda estiver lá.
export async function cancelPurchase(pool, user, id, reason) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const p = (await client.query('select * from purchases where id = $1 for update', [id])).rows[0];
    if (!p) throw new HttpError(404, 'Compra não encontrada.');
    if (p.status === 'cancelada') throw bad('Esta compra já foi cancelada.');
    const movs = (await client.query(`select * from stock_movements where purchase_id = $1 and kind = 'entrada'`, [id])).rows;
    for (const m of movs) {
      const bal = Number((await client.query(
        `select coalesce(sum(qty),0) q from stock_movements where item_id = $1 and location_id = $2 and lot_id is not distinct from $3`, [m.item_id, m.location_id, m.lot_id])).rows[0].q);
      if (bal < Number(m.qty)) throw bad('Não dá para cancelar: parte do que entrou já saiu do estoque. Faça um ajuste de inventário.');
    }
    for (const m of movs) {
      await client.query(
        `insert into stock_movements (kind, item_id, location_id, lot_id, qty, unit_cost, total_cost, purchase_id, purchase_item_id, occurred_on, note, user_id)
         values ('estorno',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [m.item_id, m.location_id, m.lot_id, -m.qty, m.unit_cost, -m.total_cost, id, m.purchase_item_id, todayBR(), `Cancelamento da compra ${id}`, user.id]);
    }
    await client.query(`update purchases set status = 'cancelada', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 where id = $1`, [id, user.id, reason || null]);
    await audit(client, user.id, 'apagar', 'purchase', id, { motivo: reason || null });
    await client.query('commit');
    return { ok: true };
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
}

export { parseChave, cnpjValid };
