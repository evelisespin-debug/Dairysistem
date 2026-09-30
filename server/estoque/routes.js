import { unzipSync } from 'fflate';
import { audit, can } from '../auth.js';
import { buildDraft, cancelPurchase, confirmPurchase, draftFromChave, findOrCreateSupplier, HttpError, normalizeOcr } from './compras.js';
import { importItems, TEMPLATE_CSV } from './itensImport.js';
import { digits, docValid, extractChave, parseChave, parseNfeXml } from './nfe.js';
import { configuredOcr, configuredProvider } from './provedores.js';

const UNITS = ['kg', 't', 'L', 'dose', 'unidade', 'saco', 'caixa'];
const MAX_ZIP_ENTRIES = 300;
const MAX_UNZIPPED = 60 * 1024 * 1024;

export function registerEstoque(app, { pool, guard, fail, services = {} }) {
  // serviços externos podem ser trocados (testes) ou vêm do .env
  const provider = () => (services.provider !== undefined ? services.provider : configuredProvider());
  const ocr = () => (services.ocr !== undefined ? services.ocr : configuredOcr());

  const wrap = (fn) => async (req, reply) => {
    try { return await fn(req, reply); } catch (e) {
      if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message, ...(e.extra || {}) });
      if (e.code === '23505') return reply.code(409).send({ error: 'Já existe um registro igual (nome ou código repetido).' });
      throw e;
    }
  };
  const route = (method, url, perm, fn) => app[method](`/api/estoque${url}`, { preHandler: guard(perm) }, wrap(fn));
  const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  const int = (v) => (v == null || v === '' ? null : +v);
  const numOrNull = (v) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));

  // ---------- cadastros simples: setores, locais, categorias ----------
  const simple = (path, table, label) => {
    route('get', `/${path}`, 'estoque_ver', async (req) =>
      (await pool.query(`select * from ${table} ${req.query.all === '1' ? '' : 'where active'} order by sort_order, lower(name)`)).rows);
    route('post', `/${path}`, 'estoque_cadastros', async (req, reply) => {
      const name = str(req.body?.name); if (!name) return fail(reply, 400, `Informe o nome do ${label}.`);
      const r = (await pool.query(`insert into ${table} (name, sort_order) values ($1, $2) returning *`, [name, int(req.body?.sort_order) ?? 100])).rows[0];
      await audit(pool, req.user.id, 'criar', table, r.id, { name });
      return r;
    });
    route('put', `/${path}/:id`, 'estoque_cadastros', async (req, reply) => {
      const b = req.body || {};
      const r = (await pool.query(`update ${table} set name = coalesce($2, name), active = coalesce($3, active), sort_order = coalesce($4, sort_order) where id = $1 returning *`,
        [+req.params.id, str(b.name), b.active ?? null, int(b.sort_order)])).rows[0];
      if (!r) return fail(reply, 404, 'Não encontrado.');
      await audit(pool, req.user.id, 'alterar', table, r.id, b);
      return r;
    });
  };
  simple('setores', 'cost_centers', 'setor');
  simple('locais', 'storage_locations', 'local');
  simple('categorias', 'item_categories', 'categoria');

  // ---------- fornecedores ----------
  route('get', '/fornecedores', 'estoque_ver', async (req) => {
    const p = []; const w = [req.query.all === '1' ? 'true' : 'active'];
    if (req.query.q) { p.push(`%${req.query.q.trim()}%`); w.push(`(name ilike $${p.length} or trade_name ilike $${p.length} or doc like $${p.length})`); }
    return (await pool.query(`select * from suppliers where ${w.join(' and ')} order by lower(name) limit 300`, p)).rows;
  });
  const supplierBody = (b, reply) => {
    const name = str(b.name); if (!name) { fail(reply, 400, 'Informe o nome ou a razão social.'); return null; }
    const doc = digits(b.doc) || null;
    if (doc && !docValid(doc)) { fail(reply, 400, 'CNPJ/CPF inválido.'); return null; }
    return [name, str(b.trade_name), doc, str(b.contact), str(b.payment_terms)];
  };
  route('post', '/fornecedores', 'estoque_cadastros', async (req, reply) => {
    const v = supplierBody(req.body || {}, reply); if (!v) return;
    const r = (await pool.query('insert into suppliers (name, trade_name, doc, contact, payment_terms) values ($1,$2,$3,$4,$5) returning *', v)).rows[0];
    await audit(pool, req.user.id, 'criar', 'supplier', r.id, { name: r.name });
    return r;
  });
  route('put', '/fornecedores/:id', 'estoque_cadastros', async (req, reply) => {
    const b = req.body || {}; let v = null;
    if ('name' in b || 'doc' in b) { v = supplierBody({ name: b.name, ...b }, reply); if (!v) return; }
    const r = (await pool.query(
      `update suppliers set name = coalesce($2, name), trade_name = case when $7 then $3 else trade_name end, doc = case when $7 then $4 else doc end,
         contact = case when $7 then $5 else contact end, payment_terms = case when $7 then $6 else payment_terms end,
         active = coalesce($8, active), updated_at = now() where id = $1 returning *`,
      [+req.params.id, v?.[0] ?? null, v?.[1] ?? null, v?.[2] ?? null, v?.[3] ?? null, v?.[4] ?? null, !!v, b.active ?? null])).rows[0];
    if (!r) return fail(reply, 404, 'Fornecedor não encontrado.');
    await audit(pool, req.user.id, 'alterar', 'supplier', r.id, b);
    return r;
  });

  // ---------- itens ----------
  const ITEM_SELECT = `select i.id, i.code, i.name, i.barcode, i.category_id, c.name category, i.unit, i.pack_unit, i.pack_factor, i.ncm, i.supplier_id, s.name supplier,
      i.default_location_id, l.name default_location, i.min_stock, i.controls_lot, i.default_cost_center_id, i.require_cost_center, i.avg_cost, i.active,
      (i.photo is not null) has_photo, coalesce((select sum(qty) from stock_movements m where m.item_id = i.id), 0) stock
    from items i left join item_categories c on c.id = i.category_id left join suppliers s on s.id = i.supplier_id
      left join storage_locations l on l.id = i.default_location_id`;
  route('get', '/itens', 'estoque_ver', async (req) => {
    const p = []; const w = [];
    if (req.query.active !== 'all') w.push(req.query.active === '0' ? 'not i.active' : 'i.active');
    if (req.query.q) { p.push(`%${req.query.q.trim()}%`); w.push(`(i.name ilike $${p.length} or i.code ilike $${p.length} or i.barcode = $${p.length + 1})`); p.push(req.query.q.trim()); }
    if (req.query.category) { p.push(+req.query.category); w.push(`i.category_id = $${p.length}`); }
    const low = req.query.low === '1' ? 'where stock <= min_stock and min_stock > 0' : '';
    p.push(Math.min(+req.query.limit || 200, 2000), +req.query.offset || 0);
    return (await pool.query(`select * from (${ITEM_SELECT} ${w.length ? `where ${w.join(' and ')}` : ''}) x ${low} order by lower(name) limit $${p.length - 1} offset $${p.length}`, p)).rows;
  });
  route('get', '/itens/modelo.csv', 'estoque_cadastros', async (req, reply) =>
    reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="modelo-itens.csv"').send(TEMPLATE_CSV));
  route('get', '/itens/:id', 'estoque_ver', async (req, reply) => {
    const it = (await pool.query(`${ITEM_SELECT} where i.id = $1`, [+req.params.id])).rows[0];
    if (!it) return fail(reply, 404, 'Item não encontrado.');
    const balances = (await pool.query(
      `select l.name location, sl.lot_code, sl.expiry, sum(m.qty) qty from stock_movements m join storage_locations l on l.id = m.location_id
         left join stock_lots sl on sl.id = m.lot_id where m.item_id = $1 group by l.name, sl.lot_code, sl.expiry having sum(m.qty) <> 0 order by l.name, sl.expiry nulls last`, [it.id])).rows;
    return { ...it, balances };
  });
  const itemValues = async (b, reply) => {
    const name = str(b.name); if (!name) { fail(reply, 400, 'Informe o nome do item.'); return null; }
    if (!UNITS.includes(b.unit)) { fail(reply, 400, `Unidade inválida (use: ${UNITS.join(', ')}).`); return null; }
    const factor = numOrNull(b.pack_factor);
    if (factor != null && !(factor > 0)) { fail(reply, 400, 'O fator de conversão deve ser maior que zero.'); return null; }
    const min = numOrNull(b.min_stock) ?? 0;
    if (!(min >= 0)) { fail(reply, 400, 'Estoque mínimo inválido.'); return null; }
    return [name, str(b.barcode), int(b.category_id), b.unit, str(b.pack_unit), factor, str(b.ncm), int(b.supplier_id), int(b.default_location_id), min,
      !!b.controls_lot, int(b.default_cost_center_id), !!b.require_cost_center];
  };
  route('post', '/itens', 'estoque_cadastros', async (req, reply) => {
    const v = await itemValues(req.body || {}, reply); if (!v) return;
    const code = str(req.body.code) || `IT${String((await pool.query(`select nextval('item_code_seq') n`)).rows[0].n).padStart(5, '0')}`;
    const r = (await pool.query(
      `insert into items (name, barcode, category_id, unit, pack_unit, pack_factor, ncm, supplier_id, default_location_id, min_stock, controls_lot, default_cost_center_id, require_cost_center, code)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`, [...v, code])).rows[0];
    await audit(pool, req.user.id, 'criar', 'item', r.id, { name: v[0], code });
    return (await pool.query(`${ITEM_SELECT} where i.id = $1`, [r.id])).rows[0];
  });
  route('put', '/itens/:id', 'estoque_cadastros', async (req, reply) => {
    const id = +req.params.id; const b = req.body || {};
    const cur = (await pool.query('select id, controls_lot, unit from items where id = $1', [id])).rows[0];
    if (!cur) return fail(reply, 404, 'Item não encontrado.');
    if (b.active !== undefined && Object.keys(b).length === 1) {           // só ativar/inativar
      await pool.query('update items set active = $2, updated_at = now() where id = $1', [id, !!b.active]);
      await audit(pool, req.user.id, 'alterar', 'item', id, { active: !!b.active });
      return (await pool.query(`${ITEM_SELECT} where i.id = $1`, [id])).rows[0];
    }
    const v = await itemValues(b, reply); if (!v) return;
    if (v[3] !== cur.unit) {
      const moved = (await pool.query('select 1 from stock_movements where item_id = $1 limit 1', [id])).rows.length;
      if (moved) return fail(reply, 409, 'Este item já tem movimentação: não dá para trocar a unidade de medida. Crie outro item.');
    }
    const code = str(b.code);
    await pool.query(
      `update items set name=$2, barcode=$3, category_id=$4, unit=$5, pack_unit=$6, pack_factor=$7, ncm=$8, supplier_id=$9, default_location_id=$10, min_stock=$11,
         controls_lot=$12, default_cost_center_id=$13, require_cost_center=$14, code = coalesce($15, code), active = coalesce($16, active), updated_at = now() where id = $1`,
      [id, ...v, code, b.active ?? null]);
    await audit(pool, req.user.id, 'alterar', 'item', id, b);
    return (await pool.query(`${ITEM_SELECT} where i.id = $1`, [id])).rows[0];
  });
  route('delete', '/itens/:id', 'estoque_cadastros', async (req, reply) => {
    const id = +req.params.id;
    const used = (await pool.query(
      `select (select count(*) from stock_movements where item_id = $1) + (select count(*) from purchase_items where item_id = $1) n`, [id])).rows[0].n;
    if (Number(used)) return fail(reply, 409, 'Este item tem movimentação e não pode ser excluído. Inative o item.');
    await pool.query('delete from supplier_item_map where item_id = $1', [id]);
    const { rowCount } = await pool.query('delete from items where id = $1', [id]);
    if (!rowCount) return fail(reply, 404, 'Item não encontrado.');
    await audit(pool, req.user.id, 'apagar', 'item', id);
    return { ok: true };
  });
  route('post', '/itens/:id/foto', 'estoque_cadastros', async (req, reply) => {
    const f = await req.file({ limits: { fileSize: 3 * 1024 * 1024 } });
    if (!f || !/^image\/(jpeg|png|webp)$/.test(f.mimetype)) return fail(reply, 400, 'Envie uma foto JPG, PNG ou WebP de até 3 MB.');
    const buf = await f.toBuffer();
    if (f.file.truncated) return fail(reply, 400, 'A foto passa de 3 MB.');
    const { rowCount } = await pool.query('update items set photo = $2, photo_type = $3, updated_at = now() where id = $1', [+req.params.id, buf, f.mimetype]);
    if (!rowCount) return fail(reply, 404, 'Item não encontrado.');
    return { ok: true };
  });
  route('get', '/itens/:id/foto', 'estoque_ver', async (req, reply) => {
    const r = (await pool.query('select photo, photo_type from items where id = $1', [+req.params.id])).rows[0];
    if (!r?.photo) return fail(reply, 404, 'Sem foto.');
    return reply.type(r.photo_type).header('cache-control', 'private, max-age=300').send(r.photo);
  });
  route('post', '/itens/importar', 'estoque_cadastros', async (req, reply) => {
    let file = null; const f = {};
    for await (const p of req.parts()) { if (p.type === 'file') file = { name: p.filename, buffer: await p.toBuffer() }; else f[p.fieldname] = p.value; }
    if (!file) return fail(reply, 400, 'Envie uma planilha .xlsx ou .csv.');
    try { return await importItems(pool, req.user, file, { commit: f.commit === '1' }); } catch (e) {
      if (e instanceof HttpError) throw e;
      return fail(reply, 400, `Não consegui ler a planilha: ${e.message}`);
    }
  });

  // ---------- entrada por nota: leitura (gera rascunho, não grava nada) ----------
  route('get', '/nfe/recursos', 'estoque_entrada', async () => ({ xml: true, danfe: !!ocr(), chave_xml: !!provider() }));

  route('post', '/nfe/ler', 'estoque_entrada', async (req, reply) => {
    const files = [];
    for await (const p of req.parts({ limits: { files: 30, fileSize: 15 * 1024 * 1024 } })) if (p.type === 'file') files.push({ name: p.filename, mime: p.mimetype, buffer: await p.toBuffer() });
    if (!files.length) return fail(reply, 400, 'Nenhum arquivo enviado.');
    const drafts = []; const errors = [];
    const xmls = [];
    const visit = (name, buf) => {
      if (buf[0] === 0x50 && buf[1] === 0x4b) {                     // zip
        let entries;
        try { entries = unzipSync(new Uint8Array(buf), { filter: (e) => /\.xml$/i.test(e.name) && !e.name.startsWith('__MACOSX') && e.originalSize < 5 * 1024 * 1024 }); } catch { errors.push({ file: name, error: 'Não consegui abrir o .zip.' }); return; }
        const list = Object.entries(entries);
        if (list.length > MAX_ZIP_ENTRIES) { errors.push({ file: name, error: `O .zip tem mais de ${MAX_ZIP_ENTRIES} XMLs. Envie em partes.` }); return; }
        if (list.reduce((a, [, b]) => a + b.length, 0) > MAX_UNZIPPED) { errors.push({ file: name, error: 'O .zip é grande demais depois de aberto.' }); return; }
        if (!list.length) errors.push({ file: name, error: 'Não há XML dentro do .zip.' });
        for (const [n, b] of list) xmls.push({ name: `${name} › ${n.split('/').pop()}`, text: Buffer.from(b).toString('utf8') });
      } else xmls.push({ name, text: buf.toString('utf8') });
    };
    const images = [];
    for (const f of files) {
      const head = f.buffer.subarray(0, 5).toString('latin1');
      if (/\.xml$/i.test(f.name) || f.buffer.subarray(0, 200).toString('utf8').trimStart().startsWith('<')) xmls.push({ name: f.name, text: f.buffer.toString('utf8') });
      else if (/\.zip$/i.test(f.name) || (f.buffer[0] === 0x50 && f.buffer[1] === 0x4b)) visit(f.name, f.buffer);
      else if (head === '%PDF-' || /^image\/(jpeg|png|webp|gif)$/.test(f.mime)) images.push({ ...f, mime: head === '%PDF-' ? 'application/pdf' : f.mime });
      else errors.push({ file: f.name, error: 'Formato não aceito. Envie XML, .zip de XMLs, PDF ou foto da nota.' });
    }
    const seen = new Set();
    for (const x of xmls) {
      try {
        const parsed = parseNfeXml(x.text);
        parsed.xml = x.text;
        if (parsed.chave && seen.has(parsed.chave)) { errors.push({ file: x.name, error: 'Nota repetida nos arquivos enviados.' }); continue; }
        if (parsed.chave) seen.add(parsed.chave);
        drafts.push({ file: x.name, ...(await buildDraft(pool, parsed)) });
      } catch (e) { errors.push({ file: x.name, error: e.message }); }
    }
    for (const im of images) {
      const reader = ocr();
      if (!reader) { errors.push({ file: im.name, error: 'A leitura automática de foto/PDF ainda não está configurada neste sistema. Use o XML da nota ou o lançamento manual.' }); continue; }
      try {
        const norm = normalizeOcr(await reader.read({ buffer: im.buffer, mime: im.mime }));
        // Se a chave foi lida e há serviço de consulta, o XML oficial vale mais que a leitura da imagem.
        const prov = provider();
        if (norm.chave && !norm.low.includes('chave') && prov) {
          try { const r = await prov.fetchXml(norm.chave); if (r) { r.parsed.xml = r.xml; drafts.push({ file: im.name, ...(await buildDraft(pool, r.parsed)) }); continue; } } catch { /* segue com a leitura da imagem */ }
        }
        drafts.push({ file: im.name, ...(await buildDraft(pool, norm, { low: norm.low })) });
      } catch (e) { errors.push({ file: im.name, error: e.message }); }
    }
    return { drafts, errors };
  });

  route('post', '/nfe/chave', 'estoque_entrada', async (req, reply) => {
    const chave = extractChave(req.body?.text ?? req.body?.chave);
    if (!chave) return fail(reply, 400, 'Não encontrei uma chave de acesso de 44 números nesse texto.');
    const k = parseChave(chave);
    if (k.error) return fail(reply, 400, k.error);
    const prov = provider(); let note = null;
    if (prov) {
      try {
        const r = await prov.fetchXml(k.chave);
        if (r) { r.parsed.xml = r.xml; return { draft: await buildDraft(pool, r.parsed), xml_found: true }; }
        note = 'A nota ainda não está disponível no serviço de consulta. Tente de novo mais tarde ou envie o XML.';
      } catch (e) { note = `Não consegui buscar o XML agora: ${e.message}`; }
    } else note = 'A busca automática do XML pela chave ainda não está configurada; preenchi o que a própria chave informa.';
    const d = await buildDraft(pool, draftFromChave(k));
    return { draft: d, xml_found: false, note };
  });

  // ---------- entrada por nota: confirmação ("Dar entrada") ----------
  route('post', '/compras', 'estoque_entrada', async (req) => confirmPurchase(pool, req.user, req.body));

  route('get', '/compras', 'estoque_ver', async (req) => {
    const p = []; const w = [];
    if (req.query.supplier_id) { p.push(+req.query.supplier_id); w.push(`p.supplier_id = $${p.length}`); }
    if (req.query.from) { p.push(req.query.from); w.push(`p.entry_date >= $${p.length}`); }
    if (req.query.to) { p.push(req.query.to); w.push(`p.entry_date <= $${p.length}`); }
    p.push(Math.min(+req.query.limit || 100, 300), +req.query.offset || 0);
    return (await pool.query(
      `select p.id, p.source, p.number, p.series, p.chave_acesso, p.issue_date, p.entry_date, p.total_invoice, p.status, s.name supplier,
          (select count(*) from purchase_items pi where pi.purchase_id = p.id)::int items
         from purchases p join suppliers s on s.id = p.supplier_id ${w.length ? `where ${w.join(' and ')}` : ''}
        order by p.entry_date desc, p.id desc limit $${p.length - 1} offset $${p.length}`, p)).rows;
  });
  route('get', '/compras/:id', 'estoque_ver', async (req, reply) => {
    const p = (await pool.query(
      `select p.id, p.source, p.chave_acesso, p.model, p.series, p.number, p.issue_date, p.entry_date, p.supplier_id, s.name supplier, s.doc supplier_doc,
          p.total_products, p.discount, p.freight, p.insurance, p.other_expenses, p.ipi_total, p.st_total, p.total_invoice, p.taxes, p.payment_method, p.payment_terms,
          p.notes, p.status, p.created_at, u.name created_by, p.cancelled_at, p.cancel_reason
         from purchases p join suppliers s on s.id = p.supplier_id left join users u on u.id = p.created_by where p.id = $1`, [+req.params.id])).rows[0];
    if (!p) return fail(reply, 404, 'Compra não encontrada.');
    const items = (await pool.query(
      `select pi.*, i.name item_name, i.code item_code, i.unit item_unit from purchase_items pi join items i on i.id = pi.item_id where pi.purchase_id = $1 order by pi.line_no`, [p.id])).rows;
    const installments = (await pool.query('select number, due_date, amount, payment_method from purchase_installments where purchase_id = $1 order by due_date', [p.id])).rows;
    return { ...p, items, installments };
  });
  route('get', '/compras/:id/xml', 'estoque_entrada', async (req, reply) => {
    const r = (await pool.query('select xml, number from purchases where id = $1', [+req.params.id])).rows[0];
    if (!r?.xml) return fail(reply, 404, 'Esta compra não tem XML guardado.');
    return reply.type('application/xml').header('content-disposition', `attachment; filename="nfe-${r.number || req.params.id}.xml"`).send(r.xml);
  });
  route('post', '/compras/:id/cancelar', 'estoque_cadastros', async (req) => cancelPurchase(pool, req.user, +req.params.id, str(req.body?.reason)));

  // ---------- saldos e movimentos (leitura) ----------
  route('get', '/movimentos', 'estoque_ver', async (req) => {
    const p = []; const w = [];
    if (req.query.item_id) { p.push(+req.query.item_id); w.push(`m.item_id = $${p.length}`); }
    p.push(Math.min(+req.query.limit || 100, 500));
    return (await pool.query(
      `select m.id, m.kind, m.qty, m.unit_cost, m.total_cost, m.occurred_on, m.note, i.name item, i.unit, l.name location, sl.lot_code, sl.expiry, cc.name cost_center, m.purchase_id, u.name "user"
         from stock_movements m join items i on i.id = m.item_id join storage_locations l on l.id = m.location_id left join stock_lots sl on sl.id = m.lot_id
         left join cost_centers cc on cc.id = m.cost_center_id left join users u on u.id = m.user_id
        ${w.length ? `where ${w.join(' and ')}` : ''} order by m.id desc limit $${p.length}`, p)).rows;
  });
  route('get', '/resumo', 'estoque_ver', async (req) => {
    const r = (await pool.query(
      `select count(*) filter (where active)::int items,
          count(*) filter (where active and min_stock > 0 and stock <= min_stock)::int below_min,
          coalesce(sum(stock * avg_cost) filter (where active and stock > 0), 0)::numeric(14,2) value
         from (select i.*, coalesce((select sum(qty) from stock_movements m where m.item_id = i.id), 0) stock from items i) x`)).rows[0];
    const expiring = (await pool.query(
      `select i.name item, sl.lot_code, sl.expiry, sum(m.qty) qty from stock_movements m join stock_lots sl on sl.id = m.lot_id join items i on i.id = m.item_id
        where sl.expiry <= current_date + 60 group by i.name, sl.lot_code, sl.expiry having sum(m.qty) > 0 order by sl.expiry limit 20`)).rows;
    const seeValue = can(req.user, 'estoque_cadastros');
    return { ...r, value: seeValue ? r.value : null, expiring };
  });
}
