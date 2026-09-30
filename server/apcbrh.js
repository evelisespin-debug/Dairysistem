// Leitores dos relatórios do controle leiteiro oficial (APCBRH/UFPR):
//   Relatório 2   - "Sumário de células somáticas e produção" (12 controles, 2 linhas por vaca + tanque no rodapé)
//   Relatório 2.2 - "Impacto da CCS no tanque" (uma coleta, com lote, parto, DEL e produção)
import { parseDate, parseNumber } from './importer.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const num = (v) => (typeof v === 'number' ? v : parseNumber(v, 2));
const isDateText = (v) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str(v));

export function detectApcbrh(rows) {
  const head = rows.slice(0, 12).map((r) => r.map(norm).join(' | ')).join('\n');
  if (head.includes('SUMARIO DE CELULAS SOMATICAS E PRODUCAO')) return 'r2';
  if (head.includes('IMPACTO DA CCS NO TANQUE')) return 'r22';
  return null;
}

// "2880 BAIXA" -> brinco 2880, situação "baixa" (saiu do rebanho)
function splitTag(raw) {
  const [tag, ...rest] = str(raw).split(/\s+/);
  const extra = rest.join(' ');
  return { tag, extra, baixa: /BAIXA/i.test(extra) };
}

const push = (records, base, code, v) => {
  const value = num(v);
  if (value === null || value <= 0) return;      // vazio ou 0 = sem resultado no relatório
  records.push({ ...base, code, value });
};

export function parseR2(rows) {
  const out = { format: 'apcbrh-r2', label: 'Controle leiteiro oficial (APCBRH) - Sumário de CCS e produção', records: [], meta: new Map(), errors: [], warnings: [], problems: [] };
  // linha das datas dos controles: várias datas em colunas de 2 em 2
  const countDates = (r) => r.filter((c) => c instanceof Date).length;
  const dateRow = rows.slice(0, 20).reduce((best, r, i) => (countDates(r) > countDates(rows[best]) ? i : best), 0);
  if (countDates(rows[dateRow]) < 2) { out.problems.push('Não encontrei a linha de datas dos controles.'); return out; }
  const controls = [];
  rows[dateRow].forEach((c, i) => {
    if (!(c instanceof Date)) return;
    const date = c.toISOString().slice(0, 10); const prev = controls[controls.length - 1];
    if (prev && prev.date === date && i === prev.col + 1) return;      // célula mesclada repete a data na coluna ao lado
    controls.push({ col: i, date });
  });
  out.controls = controls.map((c) => c.date);

  let cows = 0; let i = dateRow + 1;
  for (; i < rows.length; i++) {
    const r = rows[i]; const a = str(r[0]); const b = str(r[1]);
    if (/^ESCORE$/i.test(a) || /^TANQUE/i.test(a)) break;                       // fim das vacas
    const next = rows[i + 1] || [];
    // "primeira linha da vaca" = a linha seguinte traz a data do parto (o relatório repete cabeçalhos a cada página)
    if (!a || !b || isDateText(b) || !isDateText(next[1])) continue;
    const { tag, extra, baixa } = splitTag(b);
    const meta = { registry: a, lac: null, calving: null, lot: null, notes: extra || null, status: baixa ? 'descartada' : null };
    const lac = num(r[3]); if (lac !== null && Number.isInteger(lac) && lac >= 0 && lac < 30) meta.lac = lac;
    if (isDateText(next[1])) meta.calving = parseDate(str(next[1]));
    out.meta.set(tag.toUpperCase(), { tag, ...meta });
    for (const { col, date } of controls) {
      const base = { line: i + 1, scope: 'animal', tag, date };
      push(out.records, base, 'CCS', r[col]); push(out.records, base, 'LEITE', r[col + 1]);
      push(out.records, base, 'GORDURA', next[col]); push(out.records, base, 'PROTEINA', next[col + 1]);
    }
    cows++; i++;                                                                  // pula a 2ª linha da vaca
  }
  out.cows = cows;

  // tanque(s) no rodapé
  const tanks = [];
  for (let j = i; j < rows.length; j++) {
    if (/^TANQUE/i.test(str(rows[j][0]))) tanks.push({ n: str(rows[j][0]), ccs: rows[j], fat: rows[j + 1] || [], nul: rows[j + 2] || [] });
  }
  tanks.forEach((t, ti) => {
    for (const { col, date } of controls) {
      const base = { line: 0, scope: 'tank', tag: null, date };
      if (ti === 0) {
        push(out.records, base, 'CCS', t.ccs[col]); push(out.records, base, 'GORDURA', t.fat[col]);
        push(out.records, base, 'PROTEINA', t.fat[col + 1]); push(out.records, base, 'UREIA', t.nul[col]);
      } else {
        const t1 = tanks[0]; const diff = (x, y) => num(x) > 0 && Math.abs(num(x) - (num(y) || 0)) > 1e-9;
        if (diff(t.ccs[col], t1.ccs[col]) || diff(t.fat[col], t1.fat[col]) || diff(t.fat[col + 1], t1.fat[col + 1])) {
          out.warnings.push(`${t.n} tem resultado diferente do Tanque 1 em ${date}: só o Tanque 1 foi importado.`);
        }
      }
    }
  });
  if (tanks.length > 1) out.warnings.unshift('O relatório traz mais de um tanque. O sistema guarda um tanque por fazenda: foi importado o Tanque 1.');
  if (!cows) out.problems.push('Não encontrei nenhuma vaca no relatório.');
  return out;
}

export function parseR22(rows) {
  const out = { format: 'apcbrh-r22', label: 'Controle leiteiro oficial (APCBRH) - Impacto da CCS no tanque', records: [], meta: new Map(), errors: [], warnings: [], problems: [] };
  let date = null;
  for (const r of rows.slice(0, 12)) {
    const k = r.findIndex((c) => /DATA DO CONTROLE/.test(norm(c)));
    if (k >= 0) { const v = r.slice(k + 1).find((c) => c !== null && str(c) !== ''); date = v instanceof Date ? v.toISOString().slice(0, 10) : parseDate(str(v)); }
  }
  if (!date) { out.problems.push('Não encontrei a "DATA DO CONTROLE" no relatório.'); return out; }
  const h = rows.findIndex((r) => r.some((c) => norm(c) === 'VACA') && r.some((c) => norm(c) === 'PRODUCAO'));
  if (h < 0) { out.problems.push('Não encontrei o cabeçalho da tabela (VACA, PRODUÇÃO, CCS).'); return out; }
  const col = (name) => rows[h].findIndex((c) => norm(c) === name);
  const c = { tag: col('VACA'), lot: col('LOTE'), calving: col('PARTO'), prod: col('PRODUCAO'), ccs: col('CCS'), obs: col('OBS:') };
  out.controls = [date]; let cows = 0;
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]; const tagRaw = str(r[c.tag]);
    if (!tagRaw || !(typeof r[0] === 'number' || /^\d+$/.test(str(r[0])))) continue;
    const { tag, extra, baixa } = splitTag(tagRaw);
    out.meta.set(tag.toUpperCase(), { tag, registry: null, lac: null, lot: str(r[c.lot]) || null, calving: isDateText(r[c.calving]) ? parseDate(str(r[c.calving])) : null, notes: extra || str(r[c.obs]) || null, status: baixa ? 'descartada' : null });
    const base = { line: i + 1, scope: 'animal', tag, date };
    push(out.records, base, 'LEITE', r[c.prod]); push(out.records, base, 'CCS', r[c.ccs]);
    cows++;
  }
  out.cows = cows;
  if (!cows) out.problems.push('Não encontrei nenhuma vaca no relatório.');
  return out;
}

export function parseApcbrh(rows) {
  const kind = detectApcbrh(rows);
  if (kind === 'r2') return parseR2(rows);
  if (kind === 'r22') return parseR22(rows);
  return null;
}
