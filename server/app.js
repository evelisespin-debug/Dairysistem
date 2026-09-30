import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import ExcelJS from 'exceljs';
import { ROOT } from './config.js';
import { audit, can, login, publicUser, userFromRequest } from './auth.js';
import { hashSecret, verifySecret, tokenHash, randomPassword } from './security.js';
import { saveManualAnalysis } from './analysisService.js';
import { readTable, buildRecords } from './importer.js';
import * as Q from './quality.js';

const STATUS = ['lactacao', 'seca', 'novilha', 'bezerra', 'descartada', 'vendida', 'morta'];

export async function buildApp({ pool, farm, logger = false }) {
  const app = Fastify({ logger, bodyLimit: 5 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

  const fail = (reply, code, msg) => reply.code(code).send({ error: msg });
  const guard = (perm) => async (req, reply) => {
    if (!req.user) return fail(reply, 401, 'Faça login para continuar.');
    if (perm && !can(req.user, perm)) return fail(reply, 403, 'Seu perfil não tem permissão para isso.');
  };

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) req.user = await userFromRequest(pool, req);
  });
  app.setErrorHandler((err, req, reply) => {
    if (err.validation || err.statusCode < 500) return reply.code(err.statusCode || 400).send({ error: err.message });
    req.log.error(err);
    if (err.code === '23505') return reply.code(409).send({ error: 'Já existe um registro igual.' });
    return reply.code(500).send({ error: 'Erro interno. Tente de novo.' });
  });

  // ---------- fazenda (pública: nome e logo para a tela de login) ----------
  app.get('/api/farm', async () => ({ slug: farm.slug, name: farm.name, modules: farm.modules }));
  app.get('/farm/logo', async (req, reply) => {
    const f = farm.logo ? path.join(farm.dir, farm.logo) : null;
    if (!f || !fs.existsSync(f)) return reply.redirect('/brand/dairyup-vaca.png');   // sem logo próprio: marca DairyUp
    reply.type(f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : 'image/jpeg')
      .header('cache-control', 'public, max-age=3600');
    return reply.send(fs.createReadStream(f));
  });
  app.get('/health', async () => { await pool.query('select 1'); return { ok: true, farm: farm.slug, version: process.env.APP_VERSION || 'dev' }; });

  // ---------- login ----------
  app.post('/api/login', async (req, reply) => {
    const r = await login(pool, { ...req.body, userAgent: req.headers['user-agent'] });
    if (r.error) return fail(reply, 401, r.error);
    return r;
  });
  app.post('/api/logout', { preHandler: guard() }, async (req) => {
    const t = (req.headers.authorization || '').slice(7);
    await pool.query('delete from sessions where token_hash = $1', [tokenHash(t)]);
    return { ok: true };
  });
  app.get('/api/me', { preHandler: guard() }, async (req) => publicUser(req.user));
  app.post('/api/me/password', { preHandler: guard() }, async (req, reply) => {
    const { current, next } = req.body || {};
    if (!verifySecret(current, req.user.pass_hash)) return fail(reply, 400, 'Senha atual incorreta.');
    if (String(next || '').length < 8) return fail(reply, 400, 'A nova senha precisa ter ao menos 8 caracteres.');
    await pool.query('update users set pass_hash = $2, must_change_password = false where id = $1', [req.user.id, hashSecret(next)]);
    await audit(pool, req.user.id, 'alterar', 'user', req.user.id, { senha: 'alterada' });
    return { ok: true };
  });
  app.post('/api/me/pin', { preHandler: guard() }, async (req, reply) => {
    const { password, pin } = req.body || {};
    if (!verifySecret(password, req.user.pass_hash)) return fail(reply, 400, 'Senha incorreta.');
    if (pin && !/^\d{4,6}$/.test(String(pin))) return fail(reply, 400, 'O PIN deve ter de 4 a 6 números.');
    await pool.query('update users set pin_hash = $2 where id = $1', [req.user.id, pin ? hashSecret(pin) : null]);
    await audit(pool, req.user.id, 'alterar', 'user', req.user.id, { pin: pin ? 'definido' : 'removido' });
    return { ok: true };
  });

  // ---------- usuários (dono) ----------
  app.get('/api/users', { preHandler: guard('usuarios') }, async () =>
    (await pool.query('select * from users where deleted_at is null order by name')).rows.map(publicUser));
  app.post('/api/users', { preHandler: guard('usuarios') }, async (req, reply) => {
    const { name, email, role } = req.body || {};
    if (!name || !email || !['dono', 'encarregado', 'funcionario', 'veterinaria'].includes(role)) return fail(reply, 400, 'Informe nome, e-mail e perfil.');
    const password = randomPassword();
    const { rows } = await pool.query(
      'insert into users(name, email, role, pass_hash, must_change_password) values ($1,$2,$3,$4,true) returning *',
      [name, email.trim(), role, hashSecret(password)]);
    await audit(pool, req.user.id, 'criar', 'user', rows[0].id, { name, email, role });
    return { user: publicUser(rows[0]), temporary_password: password };   // mostrada uma única vez
  });
  app.put('/api/users/:id', { preHandler: guard('usuarios') }, async (req, reply) => {
    const id = +req.params.id; const { name, role, active, can_see_finance } = req.body || {};
    if (id === req.user.id && (active === false || (role && role !== 'dono'))) return fail(reply, 400, 'Você não pode desativar nem rebaixar a si mesmo.');
    const { rows } = await pool.query(
      `update users set name = coalesce($2, name), role = coalesce($3, role), active = coalesce($4, active),
              can_see_finance = coalesce($5, can_see_finance) where id = $1 and deleted_at is null returning *`,
      [id, name ?? null, role ?? null, active ?? null, can_see_finance ?? null]);
    if (!rows.length) return fail(reply, 404, 'Usuário não encontrado.');
    if (active === false) await pool.query('delete from sessions where user_id = $1', [id]);   // bloqueia na hora
    await audit(pool, req.user.id, 'alterar', 'user', id, { name, role, active, can_see_finance });
    return publicUser(rows[0]);
  });
  app.post('/api/users/:id/reset-password', { preHandler: guard('usuarios') }, async (req, reply) => {
    const password = randomPassword();
    const { rowCount } = await pool.query(
      'update users set pass_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = null where id = $1 and deleted_at is null',
      [+req.params.id, hashSecret(password)]);
    if (!rowCount) return fail(reply, 404, 'Usuário não encontrado.');
    await pool.query('delete from sessions where user_id = $1', [+req.params.id]);
    await audit(pool, req.user.id, 'alterar', 'user', req.params.id, { senha: 'redefinida' });
    return { temporary_password: password };
  });

  // ---------- tipos de análise (configuráveis) ----------
  app.get('/api/analysis-types', { preHandler: guard('ver_ficha') }, async () => Q.getTypes(pool, { onlyActive: false }));
  const typeFields = ['name', 'unit', 'decimals', 'geometric', 'scale', 'warn_high', 'alert_high', 'warn_low', 'alert_low',
    'tank_warn_high', 'tank_alert_high', 'tank_warn_low', 'tank_alert_low', 'sort_order', 'active'];
  app.post('/api/analysis-types', { preHandler: guard('config') }, async (req, reply) => {
    const b = req.body || {}; const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_]{2,20}$/.test(code) || !b.name) return fail(reply, 400, 'Informe um código (letras/números) e um nome.');
    await pool.query(
      `insert into analysis_types(code, name, unit, decimals, aliases, geometric, scale, warn_high, alert_high, warn_low, alert_low,
         tank_warn_high, tank_alert_high, tank_warn_low, tank_alert_low, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [code, b.name, b.unit || '', b.decimals ?? 2, (b.aliases || []).map(String), !!b.geometric, b.scale || 'animal',
        b.warn_high ?? null, b.alert_high ?? null, b.warn_low ?? null, b.alert_low ?? null,
        b.tank_warn_high ?? null, b.tank_alert_high ?? null, b.tank_warn_low ?? null, b.tank_alert_low ?? null, b.sort_order ?? 100]);
    await audit(pool, req.user.id, 'criar', 'analysis_type', code, b);
    return { ok: true, code };
  });
  app.put('/api/analysis-types/:code', { preHandler: guard('config') }, async (req, reply) => {
    const b = req.body || {}; const sets = []; const vals = [req.params.code];
    for (const f of typeFields) if (f in b) { vals.push(b[f] === '' ? null : b[f]); sets.push(`${f} = $${vals.length}`); }
    if ('aliases' in b) { vals.push((b.aliases || []).map(String)); sets.push(`aliases = $${vals.length}`); }
    if (!sets.length) return fail(reply, 400, 'Nada para alterar.');
    const { rowCount } = await pool.query(`update analysis_types set ${sets.join(', ')} where code = $1`, vals);
    if (!rowCount) return fail(reply, 404, 'Tipo não encontrado.');
    await audit(pool, req.user.id, 'alterar', 'analysis_type', req.params.code, b);
    return { ok: true };
  });

  // ---------- animais ----------
  app.get('/api/animals', { preHandler: guard('ver_ficha') }, async (req) => {
    const { q = '', status, lot, limit = 50, offset = 0, deleted } = req.query;
    const p = []; const w = [deleted === '1' && can(req.user, 'apagar') ? 'a.deleted_at is not null' : 'a.deleted_at is null'];
    if (q) { p.push(`%${q.trim()}%`); w.push(`a.tag ilike $${p.length}`); }
    if (status) { p.push(status); w.push(`a.status = $${p.length}`); }
    if (lot) { p.push(lot); w.push(`a.lot = $${p.length}`); }
    const where = w.join(' and ');
    const total = (await pool.query(`select count(*)::int n from animals a where ${where}`, p)).rows[0].n;
    // brinco exatamente igual ao digitado aparece primeiro
    const exact = q ? `(upper(a.tag) = upper($${p.push(q.trim())})) desc, ` : '';
    p.push(Math.min(+limit || 50, 200), +offset || 0);
    const { rows } = await pool.query(
      `select a.* from animals a where ${where} order by ${exact}a.tag limit $${p.length - 1} offset $${p.length}`, p);
    return { total, items: rows };
  });
  app.get('/api/animals/by-tag/:tag', { preHandler: guard('ver_ficha') }, async (req, reply) => {
    const { rows } = await pool.query('select * from animals where upper(tag) = upper($1) and deleted_at is null', [req.params.tag.trim()]);
    return rows[0] || fail(reply, 404, 'Brinco não encontrado.');
  });
  app.get('/api/animals/:id', { preHandler: guard('ver_ficha') }, async (req, reply) => {
    const { rows } = await pool.query('select * from animals where id = $1', [+req.params.id]);
    if (!rows.length || (rows[0].deleted_at && !can(req.user, 'apagar'))) return fail(reply, 404, 'Animal não encontrado.');
    const types = await Q.getTypes(pool);
    const hist = await pool.query(
      `select id, analysis_date d, type_code, value from analyses
        where animal_id = $1 and scope = 'animal' and deleted_at is null order by analysis_date`, [+req.params.id]);
    return {
      animal: rows[0],
      types: types.filter((t) => t.scale !== 'tank').map((t) => ({ code: t.code, name: t.name, unit: t.unit, decimals: t.decimals, warn_high: t.warn_high, alert_high: t.alert_high, warn_low: t.warn_low, alert_low: t.alert_low })),
      analyses: hist.rows.map((r) => ({ ...r, status: Q.statusOf(types.find((t) => t.code === r.type_code), r.value) })),
    };
  });
  const animalBody = (b) => ({
    tag: String(b.tag || '').trim(), breed: b.breed || null, birth_date: b.birth_date || null,
    lot: b.lot || null, status: b.status || 'lactacao', notes: b.notes || null,
  });
  app.post('/api/animals', { preHandler: guard('lancar') }, async (req, reply) => {
    const a = animalBody(req.body || {});
    if (!a.tag) return fail(reply, 400, 'Informe o brinco.');
    if (!STATUS.includes(a.status)) return fail(reply, 400, 'Situação inválida.');
    const { rows } = await pool.query(
      'insert into animals(tag, breed, birth_date, lot, status, notes) values ($1,$2,$3,$4,$5,$6) returning *',
      [a.tag, a.breed, a.birth_date, a.lot, a.status, a.notes]);
    await audit(pool, req.user.id, 'criar', 'animal', rows[0].id, a);
    return rows[0];
  });
  app.put('/api/animals/:id', { preHandler: guard('corrigir') }, async (req, reply) => {
    const id = +req.params.id; const old = (await pool.query('select * from animals where id = $1 and deleted_at is null', [id])).rows[0];
    if (!old) return fail(reply, 404, 'Animal não encontrado.');
    const n = { ...old, ...animalBody({ ...old, ...req.body }) };
    if (!STATUS.includes(n.status)) return fail(reply, 400, 'Situação inválida.');
    const { rows } = await pool.query(
      `update animals set tag=$2, breed=$3, birth_date=$4, lot=$5, status=$6, notes=$7, updated_at=now() where id=$1 returning *`,
      [id, n.tag, n.breed, n.birth_date, n.lot, n.status, n.notes]);
    const diff = {};
    for (const k of ['tag', 'breed', 'birth_date', 'lot', 'status', 'notes']) if (String(old[k] ?? '') !== String(rows[0][k] ?? '')) diff[k] = { de: old[k], para: rows[0][k] };
    await audit(pool, req.user.id, 'alterar', 'animal', id, diff);
    return rows[0];
  });
  app.delete('/api/animals/:id', { preHandler: guard('apagar') }, async (req, reply) => {
    const { rowCount } = await pool.query('update animals set deleted_at = now() where id = $1 and deleted_at is null', [+req.params.id]);
    if (!rowCount) return fail(reply, 404, 'Animal não encontrado.');
    await audit(pool, req.user.id, 'apagar', 'animal', req.params.id);
    return { ok: true };
  });
  app.post('/api/animals/:id/restore', { preHandler: guard('apagar') }, async (req, reply) => {
    const { rowCount } = await pool.query('update animals set deleted_at = null where id = $1 and deleted_at is not null', [+req.params.id]);
    if (!rowCount) return fail(reply, 404, 'Animal não encontrado.');
    await audit(pool, req.user.id, 'restaurar', 'animal', req.params.id);
    return { ok: true };
  });

  // ---------- análises: lançamento manual e sincronização offline ----------
  app.post('/api/analyses/sync', { preHandler: guard('lancar') }, async (req, reply) => {
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length > 500) return fail(reply, 400, 'Envie até 500 itens.');
    const types = await Q.getTypes(pool);
    const results = [];
    for (const it of items) {
      try { results.push({ client_uuid: it.client_uuid, ...(await saveManualAnalysis(pool, req.user, it, types)) }); }
      catch (e) { req.log.error(e); results.push({ client_uuid: it.client_uuid, status: 'erro', error: 'Erro ao salvar.' }); }
    }
    return { results };
  });
  app.put('/api/analyses/:id', { preHandler: guard('corrigir') }, async (req, reply) => {
    const value = Number(String(req.body?.value).replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) return fail(reply, 400, 'Valor inválido.');
    const old = (await pool.query('select value from analyses where id = $1 and deleted_at is null', [+req.params.id])).rows[0];
    if (!old) return fail(reply, 404, 'Registro não encontrado.');
    await pool.query('update analyses set value = $2, updated_at = now() where id = $1', [+req.params.id, value]);
    await audit(pool, req.user.id, 'alterar', 'analysis', req.params.id, { value: { de: old.value, para: value } });
    return { ok: true };
  });
  app.delete('/api/analyses/:id', { preHandler: guard('apagar') }, async (req, reply) => {
    const { rowCount } = await pool.query('update analyses set deleted_at = now() where id = $1 and deleted_at is null', [+req.params.id]);
    if (!rowCount) return fail(reply, 404, 'Registro não encontrado.');
    await audit(pool, req.user.id, 'apagar', 'analysis', req.params.id);
    return { ok: true };
  });
  app.get('/api/analyses/tank', { preHandler: guard('relatorios') }, async () =>
    (await pool.query(`select id, analysis_date d, type_code, value from analyses where scope = 'tank' and deleted_at is null order by analysis_date desc, type_code limit 300`)).rows);

  // ---------- importação de planilha ----------
  app.post('/api/import', { preHandler: guard('importar') }, async (req, reply) => {
    const parts = req.parts(); let file = null; const f = {};
    for await (const p of parts) {
      if (p.type === 'file') file = { name: p.filename, buffer: await p.toBuffer() }; else f[p.fieldname] = p.value;
    }
    if (!file) return fail(reply, 400, 'Envie um arquivo .xlsx ou .csv.');
    const scope = f.scope === 'tank' ? 'tank' : 'animal';
    const commit = f.commit === '1';
    const createMissing = f.create_missing !== '0';
    const types = await Q.getTypes(pool);
    let table;
    try { table = await readTable(file.buffer, file.name); } catch (e) { return fail(reply, 400, `Não consegui ler o arquivo: ${e.message}`); }
    const defaultDate = f.default_date && /^\d{4}-\d{2}-\d{2}$/.test(f.default_date) ? f.default_date : null;
    const built = buildRecords(table, { scope, defaultDate, types });
    // dedupe: última linha vence
    const uniq = new Map();
    for (const r of built.records) uniq.set(`${r.tag?.toUpperCase() ?? ''}|${r.date}|${r.code}`, r);
    const records = [...uniq.values()];
    const tags = [...new Set(records.map((r) => r.tag).filter(Boolean))];
    const known = tags.length ? (await pool.query('select upper(tag) t from animals where deleted_at is null and upper(tag) = any($1)', [tags.map((t) => t.toUpperCase())])).rows.map((r) => r.t) : [];
    const knownSet = new Set(known);
    const missing = tags.filter((t) => !knownSet.has(t.toUpperCase()));
    const dates = records.map((r) => r.date).sort();
    const preview = {
      filename: file.name, format: built.cols.format, problems: built.problems,
      columns: built.cols.format === 'largo' ? built.cols.measures.map((m) => ({ header: m.header, code: m.code })) : 'tipo/valor',
      rows_read: table.rows.length, records: records.length, errors: built.errors.slice(0, 50), errors_total: built.errors.length,
      animals_total: tags.length, animals_missing: missing.length, missing_sample: missing.slice(0, 10),
      date_from: dates[0] || null, date_to: dates[dates.length - 1] || null,
      sample: records.slice(0, 5),
    };
    if (!commit || built.problems.length) return { committed: false, ...preview };
    if (missing.length && !createMissing) return fail(reply, 400, `${missing.length} brincos não cadastrados. Marque a opção de criar animais novos ou cadastre antes.`);
    if (!records.length) return fail(reply, 400, 'Nenhum dado válido para importar.');

    const client = await pool.connect();
    try {
      await client.query('begin');
      const batch = (await client.query(
        'insert into import_batches(filename, user_id, rows_total, rows_ok, rows_error) values ($1,$2,$3,$4,$5) returning id',
        [file.name, req.user.id, table.rows.length, records.length, built.errors.length])).rows[0];
      let created = 0;
      if (missing.length) {
        const lotOf = new Map(records.filter((r) => r.lot).map((r) => [r.tag.toUpperCase(), r.lot]));
        const ins = await client.query(
          `insert into animals(tag, lot, status) select t, l, 'lactacao' from unnest($1::text[], $2::text[]) as x(t, l)
             on conflict do nothing returning id`, [missing, missing.map((t) => lotOf.get(t.toUpperCase()) || null)]);
        created = ins.rowCount;
      }
      // atualiza o lote de animais existentes quando a planilha traz a coluna de lote
      const lotRecs = [...new Map(records.filter((r) => r.lot && r.tag).map((r) => [r.tag.toUpperCase(), r.lot]))];
      if (lotRecs.length) await client.query(
        `update animals a set lot = x.l, updated_at = now() from unnest($1::text[], $2::text[]) as x(t, l)
          where upper(a.tag) = x.t and a.deleted_at is null and a.lot is distinct from x.l`, [lotRecs.map((x) => x[0]), lotRecs.map((x) => x[1])]);
      const ids = new Map((await client.query('select id, upper(tag) t from animals where deleted_at is null')).rows.map((r) => [r.t, r.id]));
      const rows = records.map((r) => ({ a: scope === 'animal' ? ids.get(r.tag.toUpperCase()) : null, d: r.date, c: r.code, v: r.value }));
      let inserted = 0; let updated = 0;
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000);
        const res = await client.query(
          `insert into analyses (scope, animal_id, analysis_date, type_code, value, source, batch_id, created_by)
           select $1, x.a, x.d::date, x.c, x.v, 'importacao', $2, $3
             from unnest($4::bigint[], $5::text[], $6::text[], $7::numeric[]) as x(a, d, c, v)
           on conflict (scope, coalesce(animal_id, 0), analysis_date, type_code) where deleted_at is null
           do update set value = excluded.value, updated_at = now(), source = 'importacao', batch_id = excluded.batch_id
           returning (xmax = 0) as inserted`,
          [scope, batch.id, req.user.id, chunk.map((r) => r.a), chunk.map((r) => r.d), chunk.map((r) => r.c), chunk.map((r) => r.v)]);
        for (const r of res.rows) r.inserted ? inserted++ : updated++;
      }
      await client.query('update import_batches set animals_created = $2 where id = $1', [batch.id, created]);
      await audit(client, req.user.id, 'importar', 'import_batch', batch.id, { arquivo: file.name, novos: inserted, atualizados: updated, animais_criados: created });
      await client.query('commit');
      return { committed: true, batch_id: batch.id, inserted, updated, animals_created: created, ...preview };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  });
  app.get('/api/import/batches', { preHandler: guard('importar') }, async () =>
    (await pool.query(`select b.*, u.name as user_name from import_batches b left join users u on u.id = b.user_id order by b.id desc limit 30`)).rows);
  // desfazer uma importação: marca como removidos os registros criados por ela
  app.post('/api/import/batches/:id/undo', { preHandler: guard('apagar') }, async (req, reply) => {
    const id = +req.params.id;
    const b = (await pool.query('select * from import_batches where id = $1', [id])).rows[0];
    if (!b || b.undone_at) return fail(reply, 404, 'Importação não encontrada ou já desfeita.');
    const r = await pool.query('update analyses set deleted_at = now() where batch_id = $1 and deleted_at is null', [id]);
    await pool.query('update import_batches set undone_at = now() where id = $1', [id]);
    await audit(pool, req.user.id, 'apagar', 'import_batch', id, { registros: r.rowCount });
    return { removed: r.rowCount };
  });

  // ---------- dashboards ----------
  const dash = guard('relatorios');
  app.get('/api/dashboard/summary', { preHandler: dash }, async (req) => Q.summary(pool, { lot: req.query.lot }));
  app.get('/api/dashboard/trend', { preHandler: dash }, async (req) =>
    Q.trend(pool, { scope: req.query.scope === 'tank' ? 'tank' : 'animal', months: req.query.months, lot: req.query.lot }));
  app.get('/api/dashboard/distribution', { preHandler: dash }, async (req, reply) =>
    (await Q.distribution(pool, { code: (req.query.code || 'CCS').toUpperCase(), lot: req.query.lot })) || fail(reply, 404, 'Tipo não encontrado.'));
  app.get('/api/dashboard/ranking', { preHandler: dash }, async (req, reply) =>
    (await Q.ranking(pool, { code: (req.query.code || 'CCS').toUpperCase(), order: req.query.order === 'best' ? 'best' : 'worst', limit: req.query.limit, lot: req.query.lot })) || fail(reply, 404, 'Tipo não encontrado.'));
  app.get('/api/dashboard/alerts', { preHandler: dash }, async (req, reply) =>
    (await Q.cowAlerts(pool, { code: (req.query.code || 'CCS').toUpperCase(), lot: req.query.lot })) || fail(reply, 404, 'Tipo não encontrado.'));
  app.get('/api/dashboard/lots', { preHandler: dash }, async () => Q.lots(pool));

  // ---------- exportação e auditoria ----------
  app.get('/api/export/all.xlsx', { preHandler: guard('exportar') }, async (req, reply) => {
    const wb = new ExcelJS.Workbook();
    const sheet = (name, cols, rows) => { const ws = wb.addWorksheet(name); ws.columns = cols.map((c) => ({ header: c, key: c })); ws.addRows(rows); ws.getRow(1).font = { bold: true }; };
    const an = (await pool.query('select tag, breed, birth_date, lot, status, notes from animals where deleted_at is null order by tag')).rows;
    sheet('Animais', ['tag', 'breed', 'birth_date', 'lot', 'status', 'notes'], an);
    const ax = (await pool.query(
      `select coalesce(a.tag, '(tanque)') as brinco, x.analysis_date as data, x.type_code as tipo, x.value as valor, x.scope as escopo, x.source as origem
         from analyses x left join animals a on a.id = x.animal_id where x.deleted_at is null order by x.analysis_date, a.tag, x.type_code`)).rows;
    sheet('Analises', ['brinco', 'data', 'tipo', 'valor', 'escopo', 'origem'], ax);
    await audit(pool, req.user.id, 'exportar', 'farm', 1, { animais: an.length, analises: ax.length });
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${farm.slug}-dados.xlsx"`);
    return reply.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
  app.get('/api/audit', { preHandler: guard('auditoria') }, async (req) =>
    (await pool.query(
      `select l.id, l.at, l.action, l.entity, l.entity_id, l.changes, u.name as user_name
         from audit_log l left join users u on u.id = l.user_id order by l.id desc limit $1`, [Math.min(+req.query.limit || 100, 500)])).rows);

  // ---------- site (PWA) ----------
  const web = path.join(ROOT, 'web');
  await app.register(fastifyStatic, { root: web, cacheControl: false });
  await app.register(fastifyStatic, { root: path.join(ROOT, 'node_modules/chart.js/dist'), prefix: '/vendor/', decorateReply: false, cacheControl: false });
  app.addHook('onSend', async (req, reply) => {
    if (!reply.hasHeader('cache-control') && !req.url.startsWith('/api/')) {
      reply.header('cache-control', req.url.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache');
    }
  });
  app.get('/manifest.webmanifest', async (req, reply) => reply.type('application/manifest+json').send({
    name: farm.name, short_name: farm.name.slice(0, 12), start_url: '/', display: 'standalone', lang: 'pt-BR',
    background_color: '#f4f4f8', theme_color: '#142e39',
    icons: [{ src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }));
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api/') ? fail(reply, 404, 'Não encontrado.') : reply.sendFile('index.html'));
  return app;
}
