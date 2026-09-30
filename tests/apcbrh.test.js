import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { setup } from './helpers.js';

let t;
before(async () => { t = await setup(); });
after(async () => { await t.close(); });

const D1 = new Date(Date.UTC(2026, 0, 20)); const D2 = new Date(Date.UTC(2026, 1, 17));
// (brinco, registro, LAC, parto, [ccs, leite, gordura, proteína] nos 2 controles)
const COWS = [
  ['101', 'BX1001', 2, '01/11/2025', [[150, 30, 3.9, 3.2], [700, 28, 3.7, 3.1]]],
  ['102', 'BX1002', 1, '15/12/2025', [[80, 25, 4.0, 3.3], [90, 26, 3.9, 3.2]]],
  ['103', 'BX1003', 3, '10/09/2025', [[400, 35, 3.5, 3.0], [500, 34, 3.6, 3.1]]],
  ['104', 'BX1004', 4, '05/08/2025', [[100, 40, 3.8, 3.2], [120, 39, 3.8, 3.2]]],
  ['105 BAIXA', 'BX1005', 2, '20/07/2025', [[300, 20, 3.4, 3.0], [null, null, null, null]]],
  ['106', 'BX1006', 5, '02/06/2025', [[60, 45, 4.1, 3.3], [70, 44, 4.0, 3.3]]],
];

async function r2Buffer() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Planilha1');
  ws.addRow(['PROPRIETÁRIO:', 'FAZENDA FICTÍCIA']);
  ws.addRow([]); ws.addRow([]); ws.addRow([]);
  ws.addRow(['RELATÓRIO 2', null, null, null, null, 'SUMÁRIO DE CÉLULAS SOMÁTICAS E PRODUÇÃO']);
  const header = () => ws.addRow(['NÚMERO REGISTRO', 'NOME COMUM DATA PARTO', null, 'ORD.LACT IDADE ANO/MÊS', null, 'DATA CONTROLE', null, 'DATA CONTROLE']);
  const dates = () => { const r = ws.addRow([null, null, null, null, null, D1, D1, D2, D2]); ws.mergeCells(r.number, 6, r.number, 7); ws.mergeCells(r.number, 8, r.number, 9); };
  header(); dates(); ws.addRow([null, null, null, null, null, 'OFICIAL', null, 'OFICIAL']);
  COWS.forEach(([tag, reg, lac, parto, c], i) => {
    if (i === 3) { header(); dates(); }                       // o relatório repete o cabeçalho a cada página
    ws.addRow([reg, tag, null, lac, null, c[0][0], c[0][1], c[1][0], c[1][1]]);
    ws.addRow([null, parto, null, '03/02', null, c[0][2], c[0][3], c[1][2], c[1][3]]);
  });
  ws.addRow(['ESCORE', 'CCS', null, 'LEITE(kg)', null, 200, 30]);
  ws.addRow(['%GORDURA', '%PROT.']);
  ws.addRow(['TANQUE 1', 'Ccs', null, null, null, 250, null, 330]);
  ws.addRow([null, '%Gordura', null, '%Prot.', null, 3.8, 3.2, 3.7, 3.1]);
  ws.addRow([null, 'NUL', null, null, null, 14.5, null, 0]);
  ws.addRow(['TANQUE 2', 'Ccs', null, null, null, 250, null, 999]);          // diferente do tanque 1
  ws.addRow([null, '%Gordura', null, '%Prot.', null, 3.8, 3.2, 3.7, 3.1]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function r22Buffer() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Dados');
  ws.addRow(['PROPRIETÁRIO:', 'FAZENDA FICTÍCIA']); ws.addRow([]); ws.addRow([]); ws.addRow([]);
  ws.addRow(['RELATÓRIO 2.2', 'IMPACTO DA CCS NO TANQUE']); ws.addRow([]);
  ws.addRow(['PRODUÇÃO TOTAL:', 100, 'No ANIMAIS:', 5, 'DATA DO CONTROLE:', '17/02/2026']); ws.addRow([]); ws.addRow([]);
  ws.addRow([null, 'VACA', 'LOTE', 'PARTO', 'DEL', 'IDADE', 'PRODUÇÃO', null, 'CCS', null, '% TOTAL', null, 'CCS/TQ.', 'OBS:']);
  [['101', '3', '01/11/2025', 108, '03/02', 28, 700], ['102', '1', '15/12/2025', 64, '03/02', 26, 90], ['103', '3', '10/09/2025', 160, '03/02', 34, 500]]
    .forEach(([tag, lote, parto, del, idade, prod, ccs], i) => ws.addRow([i + 1, tag, lote, parto, del, idade, prod, null, ccs]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const upload = async (buf, name, commit) => {
  const b = '----y';
  const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="commit"\r\n\r\n${commit}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)]);
  const res = await t.app.inject({ method: 'POST', url: '/api/import', payload, headers: { authorization: `Bearer ${t.tokens.dono}`, 'content-type': `multipart/form-data; boundary=${b}` } });
  return res.json();
};

test('relatório oficial 2: prévia reconhece vacas, controles e tanque', async () => {
  const p = await upload(await r2Buffer(), 'R2.xlsx', '0');
  assert.match(p.format, /APCBRH/);
  assert.deepEqual(p.problems, []);
  assert.equal(p.controls, 2);                       // datas mescladas não duplicam
  assert.equal(p.rows_read, 6);                      // cabeçalho repetido não vira vaca
  assert.equal(p.animals_total, 6);
  assert.ok(p.warnings.some((w) => /mais de um tanque/.test(w)));
  assert.ok(p.warnings.some((w) => /tanque 2/i.test(w)));
  assert.equal(p.by_type.CCS, 11);                   // 6 + 5 (uma vaca sem 2º controle)
});

test('relatório oficial 2: importa vacas, baixa, registro e tanque; reimportar não duplica', async () => {
  const c = await upload(await r2Buffer(), 'R2.xlsx', '1');
  assert.equal(c.committed, true); assert.equal(c.animals_created, 6);
  const again = await upload(await r2Buffer(), 'R2.xlsx', '1');
  assert.equal(again.inserted, 0); assert.equal(again.updated, c.inserted);
  const baixa = (await t.call('dono', 'GET', '/api/animals/by-tag/105')).body;
  assert.equal(baixa.status, 'descartada'); assert.equal(baixa.registry, 'BX1005'); assert.equal(baixa.notes, 'BAIXA');
  const a101 = (await t.call('dono', 'GET', '/api/animals/by-tag/101')).body;
  assert.equal(a101.lactation_number, 2); assert.equal(a101.calving_date, '2025-11-01');
  const tank = (await t.call('dono', 'GET', '/api/tank')).body;
  const d2 = tank.find((x) => x.date === '2026-02-17');
  assert.equal(d2.values.CCS, 330); assert.equal(d2.values.GORDURA, 3.7);      // tanque 1; o tanque 2 (999) foi ignorado
  const d1 = tank.find((x) => x.date === '2026-01-20'); assert.equal(d1.values.UREIA, 14.5);
});

test('relatório 2.2: lote e produção; impacto no tanque = CCS x leite / soma (CCS x leite)', async () => {
  const c = await upload(await r22Buffer(), 'R22.xlsx', '1');
  assert.equal(c.committed, true); assert.match(c.format, /Impacto/);
  assert.equal((await t.call('dono', 'GET', '/api/animals/by-tag/103')).body.lot, '3');
  const rep = (await t.call('dono', 'GET', '/api/reports/milk-control')).body;
  assert.equal(rep.latest, '2026-02-17');
  const soma = 700 * 28 + 90 * 26 + 500 * 34 + 120 * 39 + 70 * 44;         // 5 vacas com leite e CCS no controle
  const r101 = rep.rows.find((x) => x.tag === '101');
  assert.ok(Math.abs(r101.impact - (100 * 700 * 28) / soma) < 1e-9, `impacto ${r101.impact}`);
  assert.equal(r101.milk, 28);
  assert.ok(Math.abs(rep.kpis.tank_impact - 100) < 0.1);
  assert.equal(rep.kpis.tank_ccs, Math.round(soma / (28 + 26 + 34 + 39 + 44)));
});

test('arquivo que não é do formato esperado continua indo pelo leitor comum', async () => {
  const p = await upload(Buffer.from('Brinco;Data;Leite\n101;17/02/2026;29\n'), 'x.csv', '0');
  assert.equal(p.format, 'Planilha (colunas por análise)');
  assert.deepEqual(p.columns, [{ header: 'Leite', code: 'LEITE' }]);
});
