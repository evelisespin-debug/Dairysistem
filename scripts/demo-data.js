// Gera dados FICTÍCIOS para testar dashboards. Só roda em banco local.
import { loadFarmConfig } from '../server/config.js';
import { config } from '../server/config.js';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { seed } from '../server/seed.js';
import { hashSecret } from '../server/security.js';

const host = new URL(config.databaseUrl).hostname;
if (!['localhost', '127.0.0.1'].includes(host) || process.env.NODE_ENV === 'production') {
  console.error('Recusado: dados de demonstração só podem ser gerados em banco local.'); process.exit(1);
}
const COWS = Number(process.argv[2] || 300); const MONTHS = 12; const PASS = 'demo12345';

let s = 42; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

const farm = loadFarmConfig(); const pool = createPool();
await migrate(pool); await seed(pool, farm, { quiet: true });
await pool.query('update users set pass_hash = $1, must_change_password = false', [hashSecret(PASS)]);
await pool.query('delete from analyses; delete from import_batches; delete from animals');

const lots = ['Lote 1 - Alta produção', 'Lote 2 - Média', 'Lote 3 - Final de lactação'];
const cows = Array.from({ length: COWS }, (_, i) => ({
  tag: String(1000 + i), lot: lots[i % 3], breed: i % 4 ? 'Holandesa' : 'Girolando',
  cs: 1.8 + 1.2 * gauss() * 0.5 + (rnd() < 0.12 ? 1.6 : 0),      // efeito da vaca (algumas com mastite crônica)
  fat: 3.75 + 0.35 * gauss(), prot: 3.2 + 0.18 * gauss(),
}));
const ids = new Map();
for (const c of cows) {
  const r = await pool.query(`insert into animals(tag, lot, breed, status) values ($1,$2,$3,'lactacao') returning id`, [c.tag, c.lot, c.breed]);
  ids.set(c.tag, r.rows[0].id);
}
const today = new Date(); const dates = [];
for (let m = MONTHS - 1; m >= 0; m--) dates.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 12)).toISOString().slice(0, 10));
const rows = [];
dates.forEach((d, mi) => {
  const season = 1 + 0.15 * Math.sin((mi / 12) * 2 * Math.PI);           // pico no calor
  for (const c of cows) {
    if (rnd() < 0.04) continue;                                           // vaca sem teste nesse mês
    const ccs = Math.max(8, Math.round(Math.exp(c.cs + 0.55 * gauss()) * 28 * season));
    rows.push([ids.get(c.tag), d, 'CCS', ccs]);
    rows.push([ids.get(c.tag), d, 'GORDURA', Math.max(2.2, +(c.fat + 0.25 * gauss()).toFixed(2))]);
    rows.push([ids.get(c.tag), d, 'PROTEINA', Math.max(2.4, +(c.prot + 0.12 * gauss()).toFixed(2))]);
  }
});
await pool.query(
  `insert into analyses(scope, animal_id, analysis_date, type_code, value, source)
   select 'animal', a, d::date, t, v, 'demo' from unnest($1::bigint[], $2::text[], $3::text[], $4::numeric[]) x(a, d, t, v)`,
  [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3])]);
const tank = [];
dates.forEach((d, mi) => {
  const season = 1 + 0.15 * Math.sin((mi / 12) * 2 * Math.PI);
  tank.push([d, 'CCS', Math.round(260 * season + 25 * gauss())], [d, 'CBT', Math.max(8, Math.round(45 + 25 * rnd() + (mi === 7 ? 90 : 0)))],
    [d, 'GORDURA', +(3.72 + 0.12 * gauss()).toFixed(2)], [d, 'PROTEINA', +(3.2 + 0.06 * gauss()).toFixed(2)]);
});
await pool.query(
  `insert into analyses(scope, analysis_date, type_code, value, source)
   select 'tank', d::date, t, v, 'demo' from unnest($1::text[], $2::text[], $3::numeric[]) x(d, t, v)`,
  [tank.map((r) => r[0]), tank.map((r) => r[1]), tank.map((r) => r[2])]);
console.log(`Dados fictícios: ${COWS} vacas, ${dates.length} coletas, ${rows.length} análises + ${tank.length} do tanque.`);
console.log(`Login de teste: ${farm.initialUsers.map((u) => u.email).join(' | ')}  — senha: ${PASS}`);
await pool.end();
