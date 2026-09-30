import ExcelJS from 'exceljs';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
const normHeader = (h) => norm(String(h ?? '').replace(/\(.*?\)/g, ''));

const TAG_COLS = ['brinco', 'animal', 'vaca', 'numero', 'num', 'n', 'id', 'identificacao', 'nbrinco', 'nrobrinco'];
const DATE_COLS = ['data', 'date', 'datacoleta', 'coleta', 'dataanalise', 'dtcoleta', 'datadacoleta', 'dataamostra'];
const TYPE_COLS = ['tipo', 'analise', 'parametro', 'tipoanalise'];
const VALUE_COLS = ['valor', 'resultado', 'value'];
const LOT_COLS = ['lote', 'grupo'];
const LAC_COLS = ['lac', 'nlac', 'numerolactacao', 'ordemlactacao', 'ordemdelactacao', 'nlactacoes', 'lactnum'];
const DEL_COLS = ['del', 'diasemlactacao', 'diasemleite'];
const CALVING_COLS = ['dataparto', 'ultimoparto', 'dataultimoparto', 'dtparto', 'parto'];

// ---------- leitura do arquivo ----------
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = ''; rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function sheetRows(ws) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) {
      let v = r.getCell(c).value;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        v = 'result' in v ? v.result : v.richText ? v.richText.map((t) => t.text).join('') : v.text ?? null;
      }
      vals.push(v);
    }
    rows.push(vals);
  });
  return rows;
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets.find((w) => w.rowCount > 0);
  return ws ? sheetRows(ws) : [];
}

// todas as abas (planilhas com várias abas, como o resultado genômico); CSV vira uma aba só
export async function readSheets(buffer, filename = '') {
  if (/\.xls$/i.test(filename)) throw new Error('Arquivo .xls antigo não é suportado. Salve como .xlsx ou .csv no Excel.');
  if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) return [parseCsv(buffer.toString('utf8'))];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.filter((w) => w.rowCount > 0).map(sheetRows);
}

export async function readRaw(buffer, filename = '') {
  const isXlsx = /\.xlsx$/i.test(filename) || (buffer[0] === 0x50 && buffer[1] === 0x4b);
  if (/\.xls$/i.test(filename)) throw new Error('Arquivo .xls antigo não é suportado. Salve como .xlsx ou .csv no Excel.');
  return isXlsx ? parseXlsx(buffer) : parseCsv(buffer.toString('utf8'));
}

export function tableFromRaw(raw) {
  const hi = raw.findIndex((r) => r.filter((c) => c !== null && String(c).trim() !== '').length >= 2);
  if (hi < 0) return { headers: [], rows: [] };
  const headers = raw[hi].map((h) => String(h ?? '').trim());
  const rows = raw.slice(hi + 1)
    .filter((r) => r.some((c) => c !== null && String(c).trim() !== ''))
    .map((r, i) => ({ line: hi + i + 2, cells: r }));
  return { headers, rows };
}

export async function readTable(buffer, filename = '') {
  const isXlsx = /\.xlsx$/i.test(filename) || (buffer[0] === 0x50 && buffer[1] === 0x4b);
  if (/\.xls$/i.test(filename)) throw new Error('Arquivo .xls antigo não é suportado. Salve como .xlsx ou .csv no Excel.');
  const raw = isXlsx ? await parseXlsx(buffer) : parseCsv(buffer.toString('utf8'));
  // primeira linha não vazia com pelo menos 2 células é o cabeçalho
  const hi = raw.findIndex((r) => r.filter((c) => c !== null && String(c).trim() !== '').length >= 2);
  if (hi < 0) return { headers: [], rows: [] };
  const headers = raw[hi].map((h) => String(h ?? '').trim());
  const rows = raw.slice(hi + 1)
    .filter((r) => r.some((c) => c !== null && String(c).trim() !== ''))
    .map((r, i) => ({ line: hi + i + 2, cells: r }));
  return { headers, rows };
}

// ---------- conversões ----------
export function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) {           // número serial do Excel
    return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let y, mo, d;
  if (m) [, y, mo, d] = m;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    [, d, mo, y] = m; if (y.length === 2) y = '20' + y;
  } else return null;
  y = +y; mo = +mo; d = +d;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseNumber(v, decimals = 2) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/\s/g, '').replace(/%$/, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (decimals === 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // 1.250 = mil e duzentos e cinquenta
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- mapeamento de colunas ----------
export function typeIndex(types) {
  const idx = new Map();
  for (const t of types) {
    for (const k of [t.code, t.name, ...(t.aliases || [])]) idx.set(norm(k), t.code);
  }
  return idx;
}

export function detectColumns(headers, types) {
  const idx = typeIndex(types);
  const n = headers.map(normHeader);
  const find = (list) => n.findIndex((h) => list.includes(h));
  const cols = { tag: find(TAG_COLS), date: find(DATE_COLS), type: find(TYPE_COLS), value: find(VALUE_COLS), lot: find(LOT_COLS), lac: find(LAC_COLS), del: find(DEL_COLS), calving: find(CALVING_COLS), measures: [] };
  if (cols.type >= 0 && cols.value >= 0) cols.format = 'longo';
  else {
    cols.format = 'largo';
    n.forEach((h, i) => { if (idx.has(h)) cols.measures.push({ index: i, code: idx.get(h), header: headers[i] }); });
  }
  return cols;
}

/**
 * Transforma a planilha em registros validados.
 * opts: { scope, defaultDate, types }
 */
export function buildRecords({ headers, rows }, { scope = 'animal', defaultDate = null, types: allTypes }) {
  // só os tipos que valem para o escopo (ex.: "Produção" é LEITE na vaca e PRODUCAO_TOTAL no tanque)
  const types = allTypes.filter((t) => t.scale === 'both' || t.scale === scope);
  const cols = detectColumns(headers, types);
  const byCode = new Map(types.map((t) => [t.code, t]));
  const idx = typeIndex(types);
  const errors = []; const records = [];
  const problems = [];
  if (scope === 'animal' && cols.tag < 0) problems.push('Não achei a coluna do brinco (esperado: "Brinco", "Animal", "Vaca" ou "Número").');
  if (cols.date < 0 && !defaultDate) problems.push('Não achei a coluna de data (esperado: "Data" ou "Data da coleta"). Informe uma data padrão.');
  if (cols.format === 'largo' && cols.measures.length === 0) problems.push('Não achei nenhuma coluna de análise (CCS, Gordura, Proteína, CBT...).');
  if (problems.length) return { cols, records, errors, problems };

  for (const r of rows) {
    const cell = (i) => (i >= 0 ? r.cells[i] : null);
    const date = cols.date >= 0 ? parseDate(cell(cols.date)) : defaultDate;
    if (!date) { errors.push({ line: r.line, error: `Data inválida: "${cell(cols.date) ?? ''}"` }); continue; }
    let tag = null;
    if (scope === 'animal') {
      tag = String(cell(cols.tag) ?? '').trim();
      if (typeof cell(cols.tag) === 'number') tag = String(cell(cols.tag));
      if (!tag) { errors.push({ line: r.line, error: 'Brinco vazio' }); continue; }
    }
    const lot = cols.lot >= 0 ? String(cell(cols.lot) ?? '').trim() || null : null;
    const lacN = cols.lac >= 0 ? parseNumber(cell(cols.lac), 0) : null;
    const lac = lacN !== null && Number.isInteger(lacN) && lacN >= 0 && lacN < 30 ? lacN : null;
    // último parto: pela coluna de data, ou calculado a partir do DEL informado
    let calving = cols.calving >= 0 ? parseDate(cell(cols.calving)) : null;
    const delN = cols.del >= 0 ? parseNumber(cell(cols.del), 0) : null;
    if (!calving && delN !== null && Number.isInteger(delN) && delN >= 0 && delN < 1500) {
      calving = new Date(new Date(date + 'T00:00:00Z').getTime() - delN * 864e5).toISOString().slice(0, 10);
    }
    const pairs = [];
    if (cols.format === 'longo') {
      const code = idx.get(norm(cell(cols.type)));
      if (!code) { errors.push({ line: r.line, error: `Tipo de análise desconhecido: "${cell(cols.type)}"` }); continue; }
      pairs.push([code, cell(cols.value)]);
    } else for (const m of cols.measures) pairs.push([m.code, cell(m.index)]);
    for (const [code, raw] of pairs) {
      if (raw === null || raw === undefined || String(raw).trim() === '') continue;   // célula vazia: ignora
      const value = parseNumber(raw, byCode.get(code).decimals);
      if (value === null || value < 0) { errors.push({ line: r.line, error: `Valor inválido em ${code}: "${raw}"` }); continue; }
      records.push({ line: r.line, tag, date, code, value, lot, lac, calving });
    }
  }
  return { cols, records, errors, problems };
}
