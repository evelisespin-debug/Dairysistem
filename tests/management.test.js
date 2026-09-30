import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

// 3 controles, 6 vacas. Resultado esperado calculado à mão (limite 200):
//  controle 2: A nova · B curada · C sadia · D crônica · E sadia · F sadia
//  controle 3: A curada · B sadia · C nova · D crônica · E sadia · F sadia
const C1 = 'Brinco;Data;CCS;Leite\nA;10/01/2026;100;35\nB;10/01/2026;300;25\nC;10/01/2026;100;35\nD;10/01/2026;250;22\nE;10/01/2026;100;35\nF;10/01/2026;100;35\n';
const C2 = 'Brinco;Data;CCS;Leite\nA;10/02/2026;300;30\nB;10/02/2026;100;35\nC;10/02/2026;100;35\nD;10/02/2026;400;20\nE;10/02/2026;100;35\nF;10/02/2026;100;35\n';
const C3 = 'Brinco;Data;CCS;Leite;DEL\nA;10/03/2026;100;35;20\nB;10/03/2026;100;35;200\nC;10/03/2026;250;25;100\nD;10/03/2026;500;20;250\nE;10/03/2026;100;35;50\nF;10/03/2026;100;35;300\n';

test('indicadores por controle: situação, incidência, cura, prevalência (divisor = vacas testadas)', async () => {
  for (const c of [C1, C2, C3]) assert.equal((await t.upload('dono', c, { commit: '1' })).body.committed, true);
  const m = (await t.call('veterinaria', 'GET', '/api/dashboard/management?controls=12')).body;
  assert.deepEqual(m.dates, ['2026-01-10', '2026-02-10', '2026-03-10']);
  const [s1, s2, s3] = m.series;
  assert.equal(s1.tested, 6); assert.equal(s1.with_prev, 0); assert.equal(s1.pct_high, 33.3);
  assert.deepEqual([s2.nova, s2.curada, s2.cronica, s2.sadia], [1, 1, 1, 3]);
  assert.equal(s2.incidence, 16.7);          // nova / vacas testadas (como no sistema em uso)
  assert.equal(s2.incidence_rate, 25);       // nova / (nova + sadia): das vacas que estavam sadias, quantas se infectaram
  assert.equal(s2.pct_curada, 16.7); assert.equal(s2.cure_rate, 50); assert.equal(s2.pct_cronica, 16.7);
  assert.deepEqual([s3.nova, s3.curada, s3.cronica, s3.sadia], [1, 1, 1, 3]);
  assert.equal(s3.pct_high, 33.3); assert.equal(s3.high400, 1); assert.equal(m.kpis.pct_healthy, 66.7);
  assert.deepEqual(m.pie, { sadia: 50, curada: 16.7, nova: 16.7, cronica: 16.7 });
  assert.equal(m.targets.pct_healthy, 80);   // metas padrão
});

test('DEL de cada teste usa o histórico de lactações; até 45 DEL e depois têm o TOTAL como divisor', async () => {
  const m = (await t.call('veterinaria', 'GET', '/api/dashboard/management')).body;
  const s3 = m.series[2];
  assert.equal(s3.early_n, 1);                                        // só A (DEL 20)
  assert.equal(s3.high_early_n, 0); assert.equal(s3.high_early, 0);
  assert.equal(s3.high_late_n, 2); assert.equal(s3.high_late, 33.3);  // C e D altas: 2 de 6 vacas testadas
  assert.equal(s3.del_mean, 153);                                     // (20 + 200 + 100 + 250 + 50 + 300) / 6
  const band = Object.fromEntries(m.bands.map((b) => [b.key, b]));
  assert.equal(band['46a150'].new_cases, 1); assert.equal(band['46a150'].share_new, 100);   // C (DEL 100) foi a única nova infecção com DEL conhecido
  assert.ok(m.del_coverage > 0 && m.del_coverage <= 100);
});

test('impacto no tanque, perda de produção, recorrentes e por lactação', async () => {
  const m = (await t.call('veterinaria', 'GET', '/api/dashboard/management')).body;
  const soma = 100 * 35 + 100 * 35 + 250 * 25 + 500 * 20 + 100 * 35 + 100 * 35;
  assert.equal(m.impact.top[0].tag, 'D');
  assert.ok(Math.abs(m.impact.top[0].impact - (100 * 500 * 20) / soma) < 0.01);
  assert.equal(m.loss.n_high, 2); assert.equal(m.loss.avg_low, 35); assert.equal(m.loss.avg_high, 22.5); assert.equal(m.loss.diff, 12.5);
  assert.equal(m.loss.kg_day, 25);
  assert.ok(m.recurrent.some((r) => r.tag === 'D' && r.consecutive === 3));    // D: 250, 400, 500
  assert.ok(!m.recurrent.some((r) => r.tag === 'C'));
  assert.equal(m.series[2].tank_calc, Math.round(soma / 185));                  // CCS do tanque pelas vacas: CCS x leite / leite
});

test('período: de/até e agrupamento; CCS do período = último controle (nunca média)', async () => {
  const feb = (await t.call('veterinaria', 'GET', '/api/dashboard/management?from=2026-02&to=2026-03')).body;
  assert.deepEqual(feb.dates, ['2026-02-10', '2026-03-10']);
  const tri = (await t.call('veterinaria', 'GET', '/api/dashboard/management?group=trimestral')).body;
  assert.equal(tri.series.length, 1); assert.equal(tri.series[0].key, '2026-T1'); assert.equal(tri.series[0].controls, 3);
  assert.equal(tri.series[0].tested, 18);                                       // contagens somadas
  assert.equal(tri.series[0].tank_calc, 164);                                   // do último controle (mar), não a média dos três
  assert.equal(tri.series[0].pct_high, round1(100 * (2 + 2 + 2) / 18));         // taxa recalculada com as contagens somadas
  const yr = (await t.call('veterinaria', 'GET', '/api/dashboard/management?group=anual')).body;
  assert.equal(yr.series[0].key, '2026');
});
const round1 = (x) => Math.round(x * 10) / 10;

test('filtro Paridas (DEL até 45) e metas configuráveis', async () => {
  const par = (await t.call('veterinaria', 'GET', '/api/dashboard/management?filter=paridas')).body;
  assert.equal(par.series[2].tested, 1);                                        // só A tem DEL <= 45 no controle de março
  assert.equal((await t.call('veterinaria', 'GET', '/api/dashboard/management?filter=primiparas')).status, 200);
  const put = await t.call('veterinaria', 'PUT', '/api/targets', { incidence: 5, pct_healthy: 85 });
  assert.equal(put.status, 200); assert.equal(put.body.incidence, 5);
  const m = (await t.call('dono', 'GET', '/api/dashboard/management')).body;
  assert.equal(m.targets.incidence, 5); assert.equal(m.targets.pct_high, 15);   // as demais seguem o padrão
  assert.equal((await t.call('encarregado', 'PUT', '/api/targets', { incidence: 1 })).status, 403);
  assert.equal((await t.call('veterinaria', 'PUT', '/api/targets', { incidence: -3 })).status, 400);
});

test('gestão: filtro por período e permissão', async () => {
  const m = (await t.call('veterinaria', 'GET', '/api/dashboard/management?controls=3')).body;
  assert.equal(m.series.length, 3);
  assert.equal((await t.call('funcionario', 'GET', '/api/dashboard/management')).status, 403);
  const empty = await t.call('dono', 'GET', '/api/dashboard/management?lot=nao-existe');
  assert.equal(empty.status, 200);
});
