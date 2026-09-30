import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { setup } from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

async function sample() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Planilha1').addRows([['Resumo'], ['nada aqui']]);
  const ws = wb.addWorksheet('Export');
  ws.addRows([
    ['ID', 'Dt nasc.', 'ID Genômico', 'NAAB', 'Pai', 'TPI', 'Leite', 'DPR', 'HH1', 'HH5', 'betaC', 'Touro enviado', 'Touro correto', 'MAST'],
    [100, new Date('2024-09-16'), 'BR1', '029HO1', 'ELGIN', 3200, 700, 1.5, 0, 1, 'A2/A2', '029HO1', 'OK', 101],
    [101, new Date('2025-01-10'), 'BR2', '029HO2', 'PACO', 2800, 300, -0.5, 0, 0, 'A1/A2', '029HO9', '029HO2', 99],
    [102, new Date('2024-06-01'), 'BR3', null, null, 2500, 100, 0, 0, 0, 'A1/A1', '029HO3', 'No ABS found', 98],
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
async function post(role, buf, fields) {
  const b = '----g'; const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
  const head = Buffer.from(parts.join('') + `--${b}\r\nContent-Disposition: form-data; name="file"; filename="g.xlsx"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const res = await t.app.inject({ method: 'POST', url: '/api/import/genomics', payload: Buffer.concat([head, buf, Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { authorization: `Bearer ${t.tokens[role]}`, 'content-type': `multipart/form-data; boundary=${b}` } });
  return { status: res.statusCode, body: res.json() };
}

test('importação genômica: prévia não grava, confirmação cadastra e painel resume', async () => {
  await t.call('dono', 'POST', '/api/animals', { tag: '100' });
  const buf = await sample();
  const prev = await post('dono', buf, { commit: '0' });
  assert.equal(prev.status, 200);
  assert.equal(prev.body.animals, 3); assert.equal(prev.body.animals_missing, 2); assert.equal(prev.body.haplotype_carriers, 1);
  assert.equal((await t.pool.query('select count(*)::int n from animal_genomics')).rows[0].n, 0);

  const done = await post('dono', buf, { commit: '1' });
  assert.equal(done.body.created, 2); assert.equal(done.body.matched, 1);
  assert.equal((await post('dono', buf, { commit: '1' })).body.created, 0, 'reenviar não duplica');

  const g = (await t.call('dono', 'GET', '/api/dashboard/genetics')).body;
  assert.equal(g.total, 3);
  assert.equal(g.sire_mismatch, 1); assert.equal(g.sire_not_found, 1);
  assert.deepEqual(g.haplotypes.map((h) => [h.code, h.n]), [['HH5', 1]]);
  assert.equal(g.by_year.find((y) => y.year === 2024).n, 2);
  assert.equal(g.top[0].tpi, 3200);
  const f = (await t.call('dono', 'GET', '/api/dashboard/genetics?tpi_min=2600&tpi_max=3000')).body;
  assert.equal(f.total, 1); assert.equal(f.total_all, 3);
  const old = (await t.call('dono', 'GET', '/api/dashboard/genetics?age=12-24')).body;
  assert.equal(old.total, old.bands.find((b) => b.key === '12-24').n);
  const a = (await t.call('dono', 'GET', '/api/animals/by-tag/100')).body;
  const one = (await t.call('dono', 'GET', `/api/animals/${a.id}/genomics`)).body;
  assert.equal(one.traits.MAST, 101); assert.equal(one.beta_casein, 'A2/A2');
});

test('sem create_missing só atualiza quem já existe; funcionário não importa', async () => {
  const buf = await sample();
  const r = await post('dono', buf, { commit: '1', create_missing: '0' });
  assert.equal(r.body.created, 0);
  assert.equal((await post('funcionario', buf, { commit: '1' })).status, 403);
});
