import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

test('login errado é recusado e bloqueia após 5 tentativas', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await t.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'funcionario@t.com', password: 'errada' } });
    assert.equal(r.statusCode, 401);
  }
  const ok = await t.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'funcionario@t.com', password: 'senha-teste-1' } });
  assert.equal(ok.statusCode, 401, 'conta deve estar bloqueada');
  await t.pool.query("update users set locked_until = null, failed_attempts = 0 where email = 'funcionario@t.com'");
});

test('sem login não acessa nada', async () => {
  const r = await t.app.inject({ method: 'GET', url: '/api/animals' });
  assert.equal(r.statusCode, 401);
});

test('permissões por perfil', async () => {
  assert.equal((await t.call('funcionario', 'GET', '/api/dashboard/summary')).status, 403, 'funcionário não vê dashboard');
  assert.equal((await t.call('funcionario', 'POST', '/api/animals', { tag: 'F1' })).status, 200, 'funcionário lança');
  assert.equal((await t.call('funcionario', 'PUT', '/api/animals/1', { lot: 'X' })).status, 403, 'funcionário não corrige');
  assert.equal((await t.call('encarregado', 'PUT', '/api/animals/1', { lot: 'L1' })).status, 200);
  assert.equal((await t.call('encarregado', 'DELETE', '/api/animals/1')).status, 403, 'só o dono apaga');
  assert.equal((await t.call('encarregado', 'GET', '/api/users')).status, 403);
  assert.equal((await t.call('veterinaria', 'GET', '/api/dashboard/summary')).status, 200);
  assert.equal((await t.call('dono', 'GET', '/api/users')).status, 200);
});

test('apagar é lógico e dá para restaurar; auditoria registra', async () => {
  assert.equal((await t.call('dono', 'DELETE', '/api/animals/1')).status, 200);
  assert.equal((await t.call('dono', 'GET', '/api/animals/by-tag/F1')).status, 404);
  assert.equal((await t.call('dono', 'POST', '/api/animals/1/restore')).status, 200);
  assert.equal((await t.call('dono', 'GET', '/api/animals/by-tag/F1')).status, 200);
  const a = await t.call('dono', 'GET', '/api/audit');
  const acts = a.body.map((x) => x.action);
  assert.ok(acts.includes('apagar') && acts.includes('restaurar') && acts.includes('alterar'));
});

test('brinco é único na fazenda', async () => {
  assert.equal((await t.call('dono', 'POST', '/api/animals', { tag: 'dup' })).status, 200);
  assert.equal((await t.call('dono', 'POST', '/api/animals', { tag: 'DUP' })).status, 409);
});

test('desativar usuário bloqueia a sessão na hora', async () => {
  const c = await t.call('dono', 'POST', '/api/users', { name: 'Temp', email: 'temp@t.com', role: 'funcionario' });
  assert.equal(c.status, 200);
  const l = await t.app.inject({ method: 'POST', url: '/api/login', payload: { email: 'temp@t.com', password: c.body.temporary_password } });
  const token = l.json().token;
  const me = () => t.app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } });
  assert.equal((await me()).statusCode, 200);
  await t.call('dono', 'PUT', `/api/users/${c.body.user.id}`, { active: false });
  assert.equal((await me()).statusCode, 401);
});

test('lançamento offline: mesmo client_uuid não duplica', async () => {
  await t.call('dono', 'POST', '/api/animals', { tag: '777' });
  const item = { client_uuid: '11111111-1111-4111-8111-111111111111', tag: '777', date: '2026-03-10', type: 'CCS', value: '350' };
  const r1 = await t.call('funcionario', 'POST', '/api/analyses/sync', { items: [item] });
  const r2 = await t.call('funcionario', 'POST', '/api/analyses/sync', { items: [item] });
  assert.equal(r1.body.results[0].status, 'criado');
  assert.equal(r2.body.results[0].status, 'duplicado');
  const n = await t.pool.query("select count(*)::int n from analyses where client_uuid = '11111111-1111-4111-8111-111111111111'");
  assert.equal(n.rows[0].n, 1);
  const bad = await t.call('funcionario', 'POST', '/api/analyses/sync', { items: [{ tag: 'nao-existe', date: '2026-03-10', type: 'CCS', value: 1 }] });
  assert.equal(bad.body.results[0].status, 'erro');
});

const CSV = 'Brinco;Data;CCS;Gordura (%);Proteína\n' +
  '201;05/03/2026;250;3,9;3,2\n202;05/03/2026;1.250;;3,1\n201;05/04/2026;180;3,8;3,3\n202;05/04/2026;900;3,5;3,0\n203;05/04/2026;abc;3,5;3,0\n';

test('importação: prévia não grava; confirmar grava; repetir não duplica', async () => {
  const pre = await t.upload('encarregado', CSV, { commit: '0' });
  assert.equal(pre.body.committed, false);
  assert.equal(pre.body.animals_missing, 3);
  assert.equal(pre.body.errors_total, 1);
  assert.equal((await t.pool.query("select count(*)::int n from analyses where source = 'importacao'")).rows[0].n, 0);

  const c1 = await t.upload('encarregado', CSV, { commit: '1' });
  assert.equal(c1.body.committed, true);
  assert.equal(c1.body.animals_created, 3);
  const total = () => t.pool.query("select count(*)::int n from analyses where source = 'importacao' and deleted_at is null").then((r) => r.rows[0].n);
  const n1 = await total();
  assert.equal(n1, 13);   // 5 linhas x 3 medidas = 15, menos 1 CCS inválida e 1 gordura vazia
  const c2 = await t.upload('encarregado', CSV, { commit: '1' });
  assert.equal(c2.body.inserted, 0);
  assert.equal(c2.body.updated, 13);
  assert.equal(await total(), n1);
  const v = await t.pool.query("select value from analyses a join animals n on n.id = a.animal_id where n.tag = '202' and type_code = 'CCS' and analysis_date = '2026-03-05'");
  assert.equal(v.rows[0].value, 1250);
});

test('importação: funcionário não pode; dono desfaz', async () => {
  assert.equal((await t.upload('funcionario', CSV, { commit: '1' })).status, 403);
  const before = (await t.pool.query('select count(*)::int n from analyses where deleted_at is null')).rows[0].n;
  const batches = (await t.call('dono', 'GET', '/api/import/batches')).body;
  const u = await t.call('dono', 'POST', `/api/import/batches/${batches[0].id}/undo`);
  assert.equal(u.status, 200);
  const after = (await t.pool.query('select count(*)::int n from analyses where deleted_at is null')).rows[0].n;
  assert.ok(after < before);
});

test('mapa do leite (tanque) e dashboards', async () => {
  const mapa = 'Data;CCS;CBT;Gordura;Proteína\n10/03/2026;310;40;3,7;3,2\n10/04/2026;520;320;3,6;3,1\n';
  const r = await t.upload('dono', mapa, { scope: 'tank', commit: '1' });
  assert.equal(r.body.committed, true);
  await t.upload('dono', CSV, { commit: '1' });
  const s = (await t.call('veterinaria', 'GET', '/api/dashboard/summary')).body;
  const ccs = s.cards.find((c) => c.code === 'CCS');
  assert.equal(ccs.date, '2026-04-05');
  assert.equal(ccs.n, 2);
  assert.ok(Math.abs(ccs.value - Math.exp((Math.log(180) + Math.log(900)) / 2)) < 1, 'média geométrica');
  const cbt = s.tank.find((x) => x.code === 'CBT');
  assert.equal(cbt.value, 320); assert.equal(cbt.status, 'alerta');
  const rk = (await t.call('veterinaria', 'GET', '/api/dashboard/ranking?code=CCS')).body;
  assert.equal(rk.rows[0].tag, '202'); assert.equal(rk.rows[0].previous, 1250);
  const al = (await t.call('veterinaria', 'GET', '/api/dashboard/alerts')).body;
  const a202 = al.items.find((i) => i.tag === '202');
  assert.ok(a202.kinds.includes('alta') && a202.kinds.includes('cronica'));
  const a201 = al.items.find((i) => i.tag === '201');
  assert.equal(a201, undefined);
  const tr = (await t.call('veterinaria', 'GET', '/api/dashboard/trend?months=60')).body;
  assert.ok(tr.some((x) => x.month === '2026-04' && x.code === 'CCS'));
  const tk = (await t.call('veterinaria', 'GET', '/api/dashboard/trend?scope=tank&months=60')).body;
  assert.ok(tk.some((x) => x.code === 'CBT'));
  const dist = (await t.call('veterinaria', 'GET', '/api/dashboard/distribution?code=CCS')).body;
  assert.equal(dist.n, 2);
});

test('exportação completa para planilha (só dono/vet)', async () => {
  const ok = await t.call('dono', 'GET', '/api/export/all.xlsx');
  assert.equal(ok.status, 200);
  assert.equal((await t.call('encarregado', 'GET', '/api/export/all.xlsx')).status, 403);
});

test('tipos de análise configuráveis sem mexer no código', async () => {
  const c = await t.call('veterinaria', 'POST', '/api/analysis-types', { code: 'LACTOSE', name: 'Lactose', unit: '%', decimals: 2, scale: 'both', aliases: ['lact', 'lactose %'] });
  assert.equal(c.status, 200);
  const r = await t.upload('dono', 'Brinco;Data;Lact\n201;10/04/2026;4,6\n', { commit: '1' });
  assert.equal(r.body.committed, true);
  assert.equal((await t.call('encarregado', 'POST', '/api/analysis-types', { code: 'X1', name: 'x' })).status, 403);
});

test('lançamento avulso de uma vaca não vira a "última coleta" do painel', async () => {
  for (let i = 0; i < 10; i++) await t.call('dono', 'POST', '/api/animals', { tag: `M${i}` });
  const rows = Array.from({ length: 10 }, (_, i) => `M${i};15/05/2026;${100 + i}`).join('\n');
  await t.upload('dono', `Brinco;Data;CCS\n${rows}\n`, { commit: '1' });
  await t.call('funcionario', 'POST', '/api/analyses/sync', { items: [{ tag: 'M0', date: '2026-06-20', type: 'CCS', value: '999' }] });
  const s = (await t.call('dono', 'GET', '/api/dashboard/summary')).body;
  assert.equal(s.cards.find((c) => c.code === 'CCS').date, '2026-05-15');
});

test('controle leiteiro: situação, LAC/DEL da planilha, grupos e filtros', async () => {
  const csv = 'Brinco;Data;CCS;LAC;DEL\n' +
    'C1;10/07/2026;100;1;30\nC1;10/08/2026;120;1;61\n' +          // sadia, primípara
    'C2;10/07/2026;150;3;100\nC2;10/08/2026;500;3;131\n' +        // nova infecção
    'C3;10/07/2026;600;2;40\nC3;10/08/2026;700;2;71\n' +          // crônica
    'C4;10/07/2026;450;4;200\nC4;10/08/2026;90;4;231\n' +          // curada
    'C5;10/07/2026;80;2;300\nC5;10/08/2026;85;2;331\n';           // sadia, multípara
  const r = await t.upload('dono', csv, { commit: '1' });
  assert.equal(r.body.committed, true);
  const a = await t.call('dono', 'GET', '/api/animals/by-tag/C2');
  assert.equal(a.body.lactation_number, 3);
  assert.equal(a.body.calving_date, '2026-04-01');                // 10/08 menos 131 dias
  const rep = (await t.call('veterinaria', 'GET', '/api/reports/milk-control')).body;
  assert.equal(rep.latest, '2026-08-10');
  assert.equal(rep.months.length, 12);
  const st = Object.fromEntries(rep.rows.filter((x) => /^C\d$/.test(x.tag)).map((x) => [x.tag, x.status]));
  assert.deepEqual(st, { C1: 'sadia', C2: 'nova', C3: 'cronica', C4: 'curada', C5: 'sadia' });
  const c3 = rep.rows.find((x) => x.tag === 'C3');
  assert.equal(c3.del, 71); assert.equal(c3.months[11], 700); assert.equal(c3.months[10], 600);
  const cron = (await t.call('veterinaria', 'GET', '/api/reports/milk-control?status=cronicas')).body;
  assert.ok(cron.rows.every((x) => x.status === 'cronica') && cron.rows.some((x) => x.tag === 'C3'));
  const prim = (await t.call('veterinaria', 'GET', '/api/reports/milk-control?group=primiparas')).body;
  assert.ok(prim.rows.every((x) => x.lac === 1) && prim.rows.some((x) => x.tag === 'C1'));
  const early = (await t.call('veterinaria', 'GET', '/api/reports/milk-control')).body.kpis.early_high;
  assert.ok(early === 0, 'C3 tem DEL 71 (>45), então nenhuma vaca nova com CCS alta');
  assert.equal((await t.call('funcionario', 'GET', '/api/reports/milk-control')).status, 403);
});

test('tanque: resultado com todos os campos do formulário e exclusão pelo dono', async () => {
  const items = [['CCS', '210'], ['CBT', '25'], ['PROTEINA', '3,2'], ['GORDURA', '3,7'], ['SOLIDOS_TOTAIS', '12,5'], ['UREIA', '15,7'], ['PRODUCAO_TOTAL', '18000']]
    .map(([type, value]) => ({ scope: 'tank', date: '2026-08-20', type, value }));
  const r = await t.call('encarregado', 'POST', '/api/analyses/sync', { items });
  assert.ok(r.body.results.every((x) => x.status === 'criado'), JSON.stringify(r.body));
  const rows = (await t.call('encarregado', 'GET', '/api/tank')).body;
  const day = rows.find((x) => x.date === '2026-08-20');
  assert.equal(day.values.SOLIDOS_TOTAIS, 12.5); assert.equal(day.values.PRODUCAO_TOTAL, 18000);
  assert.equal((await t.call('encarregado', 'DELETE', '/api/tank/2026-08-20')).status, 403);
  assert.equal((await t.call('dono', 'DELETE', '/api/tank/2026-08-20')).status, 200);
  assert.equal((await t.call('dono', 'GET', '/api/tank')).body.some((x) => x.date === '2026-08-20'), false);
});

test('janelas do painel acompanham a última coleta, não a data de hoje', async () => {
  // os dados de teste são de 2026; a evolução mensal deve trazer vários meses mesmo que "hoje" seja bem depois
  const tr = (await t.call('dono', 'GET', '/api/dashboard/trend?months=12')).body;
  const months = new Set(tr.filter((x) => x.code === 'CCS').map((x) => x.month));
  assert.ok(months.size >= 4, `meses: ${[...months]}`);
});

test('filtro Lactantes = testada na coleta mais recente', async () => {
  const all = (await t.call('dono', 'GET', '/api/reports/milk-control')).body;
  const lact = (await t.call('dono', 'GET', '/api/reports/milk-control?group=lactantes')).body;
  assert.ok(lact.rows.length > 0 && lact.rows.length <= all.rows.length);
  assert.ok(lact.rows.every((r) => !r.stale));
  assert.equal(lact.kpis.quantity, lact.rows.length);
});
