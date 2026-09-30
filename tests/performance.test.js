import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setup } from './helpers.js';
import { computeYear } from '../server/performance.js';

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const XLSX = fs.readFileSync(new URL('../docs/exemplos/zootecnico-exemplo.xlsx', import.meta.url));

async function uploadXlsx(role, commit) {
  const b = '----p'; const head = `--${b}\r\nContent-Disposition: form-data; name="commit"\r\n\r\n${commit ? 1 : 0}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="z.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const payload = Buffer.concat([Buffer.from(head), XLSX, Buffer.from(`\r\n--${b}--\r\n`)]);
  const res = await t.app.inject({ method: 'POST', url: '/api/performance/import', payload,
    headers: { authorization: `Bearer ${t.tokens[role]}`, 'content-type': `multipart/form-data; boundary=${b}` } });
  return { status: res.statusCode, body: res.json() };
}

test('cálculos seguem as fórmulas da planilha', () => {
  const inp = { vacas_adultas: [1815], vacas_lactacao: [1580], vacas_descarte: [39], vacas_prenhes: [933], partos: [154], casos_metrite: [19],
    produtividade: [43.5], preco_leite: [2.3], cms: [27.3], custo_ms: [1.38], cocho_linear: [742], cria1: [670], cria2: [519], dias_aberto: [131] };
  const v = computeYear(inp);
  const r = (c) => Math.round(v[c][0] * 100) / 100;
  assert.equal(r('pct_leite'), 87.05);
  assert.equal(r('pct_prenhes'), 52.53);           // 933 / (1815 - 39)
  assert.equal(r('pct_metrite'), 12.34);
  assert.equal(r('rmca'), 62.38);                  // 43,5 × 2,30 − 27,3 × 1,38
  assert.equal(r('cria3'), 391);                   // 3+ crias = lactação − 1ª − 2ª quando não digitado
  assert.equal(r('iep'), 13.34);
  assert.equal(Math.round(v.cocho_por_vaca[0]), 47);   // cm por vaca
  assert.equal(v.rmca[1], null, 'mês sem dado não inventa número');
});

test('dado faltando gera "sem dado", nunca zero (RMCA sem custo da dieta)', () => {
  const v = computeYear({ produtividade: [44], preco_leite: [2.8], cms: [null], custo_ms: [null] });
  assert.equal(v.rmca[0], null);
});

test('importar a planilha: prévia não grava; confirmar grava 2025 e 2026', async () => {
  const pre = await uploadXlsx('dono', false);
  assert.equal(pre.status, 200); assert.equal(pre.body.committed, false);
  assert.deepEqual(pre.body.years.map((y) => y.year).sort(), [2025, 2026]);
  assert.deepEqual(pre.body.unknown, []);
  assert.equal((await t.pool.query('select count(*)::int n from perf_values')).rows[0].n, 0);
  const ok = await uploadXlsx('encarregado', true);
  assert.equal(ok.body.committed, true); assert.ok(ok.body.saved > 1000);
  // reenviar não duplica
  const n1 = (await t.pool.query('select count(*)::int n from perf_values')).rows[0].n;
  await uploadXlsx('dono', true);
  assert.equal((await t.pool.query('select count(*)::int n from perf_values')).rows[0].n, n1);
});

test('relatório do ano: valores calculados batem com a planilha (2026)', async () => {
  const r = (await t.call('veterinaria', 'GET', '/api/performance?year=2026')).body;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≠ ${b}`);
  assert.equal(r.latest_month, 8);
  near(r.values.pct_leite[0], 87.0523); near(r.values.pct_prenhes[0], 52.5338);
  near(r.values.pct_mastite[6], 7.6687); near(r.values.proj_saida_adulta[2], 30.14);
  near(r.values.rebanho_total[7], 3708);
  assert.equal(r.values.rmca[5], null, 'RMCA de junho: planilha usava CMS vazio como zero');
  near(r.values.cocho_por_vaca[0], 46.96);
  // média do ano anterior vem do ano de 2025 importado
  near(r.avg.prod_diaria.prev, 60589.33 / 1); near(r.avg.pct_mastite.current, 5.11);
  assert.deepEqual(r.years, [2026, 2025, 2024]);
});

test('crescimento usa o ano anterior importado', async () => {
  const r = (await t.call('dono', 'GET', '/api/performance?year=2026')).body;
  assert.ok(Math.abs(r.values.crescimento[0] - 7.96) < 0.01);
});

test('análise: aponta o que piorou e melhorou contra o ano anterior', async () => {
  const a = (await t.call('veterinaria', 'GET', '/api/performance/insights?year=2026')).body;
  assert.equal(a.month, 8);
  const mastite = a.worse.find((x) => x.code === 'pct_mastite');
  assert.ok(mastite, 'mastite tratada piorou'); assert.equal(mastite.trend, -1);
  assert.ok(a.headline.length >= 8);
  assert.ok(a.better.every((x) => x.trend === 1) && a.worse.every((x) => x.trend === -1));
});

test('lançar o mês: salva, recalcula e registra na auditoria; vazio remove', async () => {
  const put = await t.call('encarregado', 'PUT', '/api/performance/2026/9', { values: { vacas_adultas: '1840', vacas_lactacao: '1650', casos_mastite: '99', ccs: '245' } });
  assert.equal(put.body.saved, 4);
  let r = (await t.call('dono', 'GET', '/api/performance?year=2026')).body;
  assert.equal(r.latest_month, 9);
  assert.ok(Math.abs(r.values.pct_mastite[8] - 6) < 0.01);
  await t.call('dono', 'PUT', '/api/performance/2026/9', { values: { ccs: '' } });
  r = (await t.call('dono', 'GET', '/api/performance?year=2026')).body;
  assert.equal(r.values.ccs[8], null);
  const aud = (await t.call('dono', 'GET', '/api/audit')).body;
  assert.ok(aud.some((x) => x.entity === 'performance'));
  assert.equal((await t.call('dono', 'PUT', '/api/performance/2026/9', { values: { pct_leite: 1 } })).status, 400, 'não grava campo calculado');
  assert.equal((await t.call('dono', 'PUT', '/api/performance/2026/13', { values: {} })).status, 400);
});

test('permissões: funcionário não vê nem lança; encarregado não define meta', async () => {
  assert.equal((await t.call('funcionario', 'GET', '/api/performance')).status, 403);
  assert.equal((await t.call('funcionario', 'PUT', '/api/performance/2026/9', { values: {} })).status, 403);
  assert.equal((await t.call('encarregado', 'PUT', '/api/performance/targets/ccs', { target: 200 })).status, 403);
  assert.equal((await t.upload('funcionario', 'a;b\n1;2\n')).status, 403);
});

test('meta: cria, aparece na análise como fora da meta e pode ser removida', async () => {
  assert.equal((await t.call('veterinaria', 'PUT', '/api/performance/targets/ccs', { target: 200 })).status, 200);
  assert.equal((await t.call('veterinaria', 'PUT', '/api/performance/targets/vacas_adultas', { target: 1 })).status, 404, 'contagem não tem meta');
  const a = (await t.call('veterinaria', 'GET', '/api/performance/insights?year=2026&_=1')).body;
  assert.ok(a.month >= 8);
  await t.call('veterinaria', 'PUT', '/api/performance/targets/ccs', { target: null });
  assert.equal((await t.pool.query('select count(*)::int n from perf_targets')).rows[0].n, 0);
});

test('exportação inclui a aba de desempenho', async () => {
  const res = await t.app.inject({ method: 'GET', url: '/api/export/all.xlsx', headers: { authorization: `Bearer ${t.tokens.dono}` } });
  assert.equal(res.statusCode, 200);
  assert.ok(res.rawPayload.length > 1000);
});
