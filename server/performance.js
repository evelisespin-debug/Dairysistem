// Desempenho zootécnico mensal (painel de indicadores da fazenda, no formato da planilha "Zootécnico").
// Guardamos só o que é DIGITADO (entradas). Percentuais, taxas e projeções são calculados aqui, com as mesmas
// fórmulas da planilha, para nunca ficarem desatualizados nem divergirem do que foi lançado.
import ExcelJS from 'exceljs';

export const GROUPS = [
  { code: 'entrada', label: 'Dados de entrada' },
  { code: 'producao', label: 'Produção' },
  { code: 'reproducao', label: 'Reprodução' },
  { code: 'transicao', label: 'Transição' },
  { code: 'recria', label: 'Recria' },
  { code: 'saida', label: 'Saída' },
  { code: 'saude', label: 'Saúde' },
  { code: 'curva', label: 'Curva de lactação' },
];

const nn = (...xs) => xs.every((x) => x != null && Number.isFinite(x));
const ratio = (a, b, k = 100) => (nn(a, b) && b !== 0 ? (a / b) * k : null);
const sum = (...xs) => (nn(...xs) ? xs.reduce((s, x) => s + x, 0) : null);

// good: 'up' (maior é melhor) | 'down' (menor é melhor) | null (só acompanhamento)
const DEFS = [];
const input = (code, group, label, unit, dec, o = {}) => DEFS.push({ code, group, label, unit, dec, kind: 'input', good: null, ...o });
const calc = (code, group, label, unit, dec, fn, o = {}) => DEFS.push({ code, group, label, unit, dec, kind: 'calc', good: null, fn, ...o });

// ---- dados de entrada ----
input('preco_leite', 'entrada', 'Preço do Leite', 'R$/kg', 2, { good: 'up' });
input('vacas_adultas', 'entrada', 'Vacas Adultas', 'n', 0);
input('vacas_lactacao', 'entrada', 'Vacas Lactação', 'n', 0);
input('vacas_tratamento', 'entrada', 'Vacas Tratamento', 'n', 0);
input('leite_bezerros', 'entrada', 'Leite Bom Bezerros', 'L/d', 0);
input('jovens_bezerreiro', 'entrada', 'Animais Jovens Bezerreiro', 'n', 0);
input('jovens_lt12', 'entrada', 'Animais Jovens <12m', 'n', 0);
input('jovens_gt12', 'entrada', 'Animais Jovens >12m', 'n', 0);
calc('rebanho_jovem', 'entrada', 'Rebanho Jovem Total', 'n', 0, (v) => sum(v('jovens_lt12'), v('jovens_gt12')));
calc('rebanho_total', 'entrada', 'Rebanho Total', 'n', 0, (v) => sum(v('rebanho_jovem'), v('vacas_adultas')));
input('vacas_prenhes', 'entrada', 'Vacas Adultas P+ (Leite+Secas)', 'n', 0);
input('vacas_descarte', 'entrada', 'Vacas a Descartar', 'n', 0);
input('vacas_nao_p150', 'entrada', 'Vacas não P+ >150DEL', 'n', 0);
input('saida_adulta', 'entrada', 'Saída Total Adulta', 'n', 0);
input('morte_vacas', 'entrada', 'Morte de Vacas', 'n', 0);
input('saida_bezerreiro', 'entrada', 'Saída Total Bezerreiro', 'n', 0);
input('saida_jovem', 'entrada', 'Saída Total Jovem', 'n', 0);
input('cria1', 'entrada', '1 Cria', 'n', 0);
input('cria2', 'entrada', '2 Cria', 'n', 0);
input('cria3', 'entrada', '3+ Crias', 'n', 0, { derive: (v) => (nn(v('vacas_lactacao'), v('cria1'), v('cria2')) ? v('vacas_lactacao') - v('cria1') - v('cria2') : null) });
input('partos', 'entrada', 'Partos', 'n', 0);
input('femeas_nascidas', 'entrada', 'Fêmeas Nascidas', 'n', 0);
input('partos_natimorto', 'entrada', 'Partos com Natimorto', 'n', 0);
input('partos_gemeos', 'entrada', 'Parto Gêmeos', 'n', 0);
input('partos_auxiliados', 'entrada', 'Partos Auxiliados', 'n', 0);
input('casos_retencao', 'entrada', 'Casos Retenção de Placenta', 'n', 0);
input('casos_deslocamento', 'entrada', 'Casos de Deslocamento de Abomaso', 'n', 0, { alias: ['Casos de Deslocamenrto Abomaso (n)'] });
input('casos_metrite', 'entrada', 'Casos de Metrite Puerperal', 'n', 0);
input('casos_mastite', 'entrada', 'Casos de Mastite Tratada', 'n', 0);
input('casos_diarreia', 'entrada', 'Casos de Diarréia Tratada Bezerreiro', 'n', 0);
input('casos_pneumonia', 'entrada', 'Casos de Pneumonia Tratada Bezerreiro', 'n', 0);
input('camas_leite', 'entrada', 'Camas Vacas Leite', 'n', 0);
input('camas_preparto', 'entrada', 'Camas Pré Parto', 'n', 0, { alias: ['Camas Pre Parto (n)'] });
input('cocho_linear', 'entrada', 'Linear Cocho Leite', 'm', 0);
input('peso_nascimento', 'entrada', 'Peso Nascimento', 'kg', 1);
input('peso_desmame', 'entrada', 'Peso Desmame', 'kg', 1, { alias: ['Peso ao Desmame (kg)'] });
input('dias_aleitamento', 'entrada', 'Dias em Aleitamento', 'dias', 1);
calc('crescimento', 'entrada', 'Crescimento Comparativo (vs ano anterior)', '%', 1,
  (v, ctx) => { const a = ctx.prev('prod_diaria'); return nn(v('prod_diaria'), a) && a !== 0 ? (v('prod_diaria') / a) * 100 - 100 : null; }, { alias: ['Crescimento Comparativo 2025x2026 (%)', 'Crescimento Comparativo 2025x2024 (%)'] });

// ---- produção ----
calc('pct_leite', 'producao', 'Vacas Leite', '%', 1, (v) => ratio(v('vacas_lactacao'), v('vacas_adultas')), { good: 'up' });
calc('pct_secas', 'producao', 'Vacas Secas', '%', 1, (v) => (v('pct_leite') == null ? null : 100 - v('pct_leite')), { good: 'down' });
calc('pct_descarte', 'producao', 'Vacas a Descartar', '%', 1, (v) => ratio(v('vacas_descarte'), v('vacas_lactacao')), { good: 'down' });
calc('pct_cria1', 'producao', '1 Cria', '%', 1, (v) => ratio(v('cria1'), sum(v('cria1'), v('cria2'), v('cria3'))));
calc('pct_cria2', 'producao', '2 Cria', '%', 1, (v) => ratio(v('cria2'), sum(v('cria1'), v('cria2'), v('cria3'))));
calc('pct_cria3', 'producao', '3+ Crias', '%', 1, (v) => ratio(v('cria3'), sum(v('cria1'), v('cria2'), v('cria3'))));
input('prod_diaria', 'producao', 'Produção Diária', 'L/d', 0, { good: 'up' });
input('produtividade', 'producao', 'Produtividade Geral', 'kg/d', 1, { good: 'up' });
input('produtividade_prim', 'producao', 'Produtividade Primíparas', 'kg/d', 1, { good: 'up' });
input('produtividade_mult', 'producao', 'Produtividade Multíparas', 'kg/d', 1, { good: 'up' });
calc('produtividade_rel', 'producao', 'Produtividade Relativa Adulta', '%', 1, (v) => ratio(v('produtividade_prim'), v('produtividade_mult')), { good: 'up' });
input('gordura', 'producao', 'Gordura', '%', 2, { good: 'up' });
input('proteina', 'producao', 'Proteína', '%', 2, { good: 'up' });
input('nul', 'producao', 'NUL', 'mg/dl', 1);
input('cms', 'producao', 'CMS', 'kg/d', 1);
input('custo_ms', 'producao', 'Custo/kg MS Dietas Leite', 'R$', 2, { good: 'down' });
calc('rmca', 'producao', 'RMCA', 'R$/vaca/d', 2, (v) => (nn(v('produtividade'), v('preco_leite'), v('cms'), v('custo_ms')) ? v('produtividade') * v('preco_leite') - v('cms') * v('custo_ms') : null), { good: 'up' });
calc('eff_alimentar', 'producao', 'Eficiência alimentar', 'kg leite/kg MS', 2, (v) => ratio(v('produtividade'), v('cms'), 1), { good: 'up', alias: ['Eff alimentar'] });

// ---- reprodução ----
input('del', 'reproducao', 'DEL', 'dias', 0);
calc('pct_prenhes', 'reproducao', 'Vacas Adultas Prenhes', '%', 1, (v) => (nn(v('vacas_prenhes'), v('vacas_adultas'), v('vacas_descarte')) ? ratio(v('vacas_prenhes'), v('vacas_adultas') - v('vacas_descarte')) : null), { good: 'up' });
input('del_1ia', 'reproducao', 'DEL 1ª IA', 'dias', 1, { good: 'down' });
calc('pct_nao_p150', 'reproducao', 'Vacas não P+ >150 DEL', '%', 1, (v) => (nn(v('vacas_nao_p150'), v('vacas_lactacao'), v('vacas_descarte')) ? ratio(v('vacas_nao_p150'), v('vacas_lactacao') - v('vacas_descarte')) : null), { good: 'down' });
input('dias_aberto', 'reproducao', 'Dias em Aberto', 'd', 0, { good: 'down' });
calc('iep', 'reproducao', 'IEP Proj', 'meses', 1, (v) => (nn(v('dias_aberto')) ? (v('dias_aberto') + 276) / 30.5 : null), { good: 'down' });
input('conc_geral', 'reproducao', 'Concepção Geral', '%', 1, { good: 'up' });
input('conc_1ia', 'reproducao', 'Concepção 1ª IA Geral', '%', 1, { good: 'up' });
input('conc_prim', 'reproducao', 'Concepção Primíparas', '%', 1, { good: 'up' });
input('conc_1prim', 'reproducao', 'Concepção 1ª Primíparas', '%', 1, { good: 'up' });
input('conc_mult', 'reproducao', 'Concepção Multíparas', '%', 1, { good: 'up' });
input('conc_1mult', 'reproducao', 'Concepção 1ª Multíparas', '%', 1, { good: 'up' });
input('conc_nul', 'reproducao', 'Concepção Nulíparas', '%', 1, { good: 'up' });
input('conc_1nul', 'reproducao', 'Concepção 1ª Nulíparas', '%', 1, { good: 'up' });
input('idade_1ia', 'reproducao', 'Idade 1IA', 'meses', 1, { good: 'down' });
input('idade_1parto', 'reproducao', 'Idade Primeiro Parto', 'meses', 1, { good: 'down' });

// ---- transição ----
const perParto = (code, label, src, good) => calc(code, 'transicao', label, '%', 1, (v) => ratio(v(src), v('partos')), { good });
perParto('pct_femeas', 'Fêmeas Nascidas', 'femeas_nascidas', 'up');
perParto('pct_natimorto', 'Natimorto', 'partos_natimorto', 'down');
perParto('pct_gemelar', 'Gemelar', 'partos_gemeos', null);
perParto('pct_auxiliados', 'Partos Auxiliados', 'partos_auxiliados', 'down');
perParto('pct_retencao', 'Retenção de Placenta', 'casos_retencao', 'down');
perParto('pct_deslocamento', 'Deslocamento de Abomaso', 'casos_deslocamento', 'down');
DEFS.find((d) => d.code === 'pct_deslocamento').alias = ['Deslocamenrto Abomaso (%)'];
perParto('pct_metrite', 'Metrite Puerperal', 'casos_metrite', 'down');

// ---- recria ----
calc('gpd_bezerreiro', 'recria', 'GPD Bezerreiro', 'kg/d', 2, (v) => (nn(v('peso_desmame'), v('peso_nascimento'), v('dias_aleitamento')) && v('dias_aleitamento') ? (v('peso_desmame') - v('peso_nascimento')) / v('dias_aleitamento') : null), { good: 'up' });
input('peso_parto', 'recria', 'Peso ao Parto', 'kg', 0, { good: 'up' });
calc('gpd_desmame_parto', 'recria', 'GPD Desmame ao Parto', 'kg/d', 2, (v) => {
  if (!nn(v('peso_parto'), v('peso_desmame'), v('idade_1parto'), v('dias_aleitamento'))) return null;
  const d = v('idade_1parto') * 30.5 - v('dias_aleitamento');
  return d > 0 ? (v('peso_parto') - v('peso_desmame')) / d : null;
}, { good: 'up', alias: ['GDP Desmame ao Parto (kg/d)'] });
calc('pct_jovens', 'recria', 'Animais Jovens Rebanho Total', '%', 1, (v) => (nn(v('rebanho_jovem'), v('vacas_adultas')) ? ratio(v('rebanho_jovem'), v('vacas_adultas') + v('rebanho_jovem')) : null));
calc('sobrevivencia', 'recria', 'Sobrevivência Nascimento–Parto (proj.)', '%', 1, (v) => (nn(v('pct_saida_jovem'), v('idade_1parto')) ? 100 - v('pct_saida_jovem') * 12 * (v('idade_1parto') / 12) : null), { good: 'up', alias: ['Taxa de Sobrevivência Nasc - Parto Proj (%)'] });

// ---- saída ----
calc('pct_saida_adulta', 'saida', 'Saída Adulta (morte+descarte)', '%', 2, (v) => ratio(v('saida_adulta'), v('vacas_adultas')), { good: 'down' });
calc('mortalidade_adulta', 'saida', 'Mortalidade Adulta (proj. anual)', '%', 1, (v) => { const r = ratio(v('morte_vacas'), v('vacas_adultas')); return r == null ? null : r * 12; }, { good: 'down', alias: ['Mortalidade Adulta Proj (%)'] });
calc('proj_saida_adulta', 'saida', 'Projeção Anual Adulto (% a.a.)', '%', 1, (v, ctx) => {
  // média das saídas do ano até o mês × 12 (como na planilha)
  if (v('pct_saida_adulta') == null) return null;     // sem dado no mês, não projeta
  const xs = ctx.ytd('pct_saida_adulta');
  return xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length) * 12 : null;
}, { good: 'down', alias: ['Projeção Anual Adulto (%a.a.)', 'Projeção Anual Adulto (%aa)'] });
calc('pct_saida_jovem', 'saida', 'Saída Jovem (morte+descarte)', '%', 2, (v) => ratio(v('saida_jovem'), v('rebanho_jovem')), { good: 'down' });
calc('pct_saida_bezerreiro', 'saida', 'Saída Bezerreiro (morte+descarte)', '%', 2, (v) => ratio(v('saida_bezerreiro'), v('jovens_bezerreiro')), { good: 'down' });

// ---- saúde ----
input('ccs', 'saude', 'CCS', 'mil cél/mL', 0, { good: 'down' });
input('cpp', 'saude', 'CPP', 'mil UFC/mL', 1, { good: 'down' });
input('rend_ordenha', 'saude', 'Rendimento Ordenha', 'vaca/h', 0, { good: 'up' });
input('bimodalidade', 'saude', 'Bimodalidade', '%', 1, { good: 'down' });
calc('pct_tratamento', 'saude', 'Vacas em Tratamento', '%', 2, (v) => ratio(v('vacas_tratamento'), v('vacas_adultas')), { good: 'down' });
calc('pct_mastite', 'saude', 'Mastite Tratada', '%', 2, (v) => ratio(v('casos_mastite'), v('vacas_lactacao')), { good: 'down' });
calc('ocupacao_camas', 'saude', 'Taxa Ocupação de Camas', '%', 1, (v) => ratio(v('vacas_lactacao'), v('camas_leite')), { good: 'down' });
// A planilha rotula "cm/vaca" mas o valor sai em metros (742 m ÷ 1580 vacas = 0,47): aqui já vem em centímetros.
calc('cocho_por_vaca', 'saude', 'Espaçamento de Cocho', 'cm/vaca', 0, (v) => ratio(v('cocho_linear'), v('vacas_lactacao'), 100), { good: 'up' });

// ---- curva de lactação (produção média por faixa de DEL) ----
export const CURVE_BANDS = ['0-29', '30-59', '60-89', '90-119', '120-149', '150-179', '180-209', '210-239', '240-269', '270-299', '300-329', '330-359', '360+'];
for (const cat of [['prim', 'Prim'], ['mult', 'Mult']]) {
  CURVE_BANDS.forEach((b, i) => input(`curva_${cat[0]}_${i}`, 'curva', `${b} ${cat[1]}`, 'kg/d', 1, { curve: cat[0], band: b }));
}

export const INDICATORS = DEFS.map(({ fn, derive, ...d }) => d);
export const INPUT_CODES = new Set(DEFS.filter((d) => d.kind === 'input').map((d) => d.code));
const BY_CODE = new Map(DEFS.map((d) => [d.code, d]));

// Linhas de comparação da planilha ("... Ano Anterior"): valem para o ano anterior quando ele ainda não foi lançado.
const PREV_ROWS = {
  'producaodiariaanoanterior|x': 'prod_diaria',
  'produtividadegeralanoanterior|x': 'produtividade',
  'delanoanterior|x': 'del',
  'concepcaogeralanoanterior|p': 'conc_geral',
  'concepcaonuliparasanoanterior|p': 'conc_nul',
};

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9+<>]/g, '');
// Chave de um rótulo da planilha: nome sem a unidade final + se é percentual ("1 Cria (n)" ≠ "1 Cria (%)").
const UNIT_TAIL = /\(([^()]*)\)\s*$/;
const keyOf = (label, pct) => {
  const m = String(label).match(UNIT_TAIL);
  const base = m ? String(label).slice(0, m.index) : String(label);
  return `${norm(base)}|${(m ? m[1].trim() === '%' : pct) ? 'p' : 'x'}`;
};
const LABEL_MAP = new Map();
for (const d of DEFS) {
  LABEL_MAP.set(keyOf(`${d.label} (${d.unit})`), d.code);   // a unidade vira o parêntese final, como na planilha
  for (const l of d.alias || []) LABEL_MAP.set(keyOf(l), d.code);
}
/** Código do indicador para um rótulo de linha da planilha (ou null). */
export const codeForLabel = (label) => LABEL_MAP.get(keyOf(label)) ?? null;
const YEAR_ROW = /^producaodiaria(\d{4})\|/;

// ---------- cálculo ----------
// values: { code: [12 posições, null quando vazio] } dos ANOS pedidos → devolve o mesmo formato com os calculados.
export function computeYear(inputs, prevInputs = {}) {
  const out = {};
  const memo = Array.from({ length: 12 }, () => new Map());
  const getters = [];
  for (let m = 0; m < 12; m++) {
    const g = (code) => {
      if (memo[m].has(code)) return memo[m].get(code);
      memo[m].set(code, null);           // proteção contra ciclos
      const d = BY_CODE.get(code);
      let val = null;
      if (d?.kind === 'input') {
        val = inputs[code]?.[m] ?? null;
        if (val == null && d.derive) val = d.derive(g);
      } else if (d) val = d.fn(g, ctx(m));
      if (val != null && !Number.isFinite(val)) val = null;
      memo[m].set(code, val);
      return val;
    };
    getters.push(g);
  }
  function ctx(m) {
    return {
      prev: (code) => prevInputs[code]?.[m] ?? null,
      ytd: (code) => { const xs = []; for (let i = 0; i <= m; i++) { const x = getters[i](code); if (x != null) xs.push(x); } return xs; },
    };
  }
  for (const d of DEFS) out[d.code] = getters.map((g) => g(d.code));
  return out;
}

const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
export const round = (n, d) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

async function loadInputs(db, year) {
  const { rows } = await db.query('select month, code, value::float8 v from perf_values where year = $1', [year]);
  const o = {};
  for (const r of rows) (o[r.code] ||= Array(12).fill(null))[r.month - 1] = r.v;
  return o;
}

export async function yearReport(db, year) {
  const [cur, prev, yrs, tg] = await Promise.all([
    loadInputs(db, year), loadInputs(db, year - 1),
    db.query('select distinct year from perf_values order by year desc'),
    db.query('select code, target::float8 t from perf_targets'),
  ]);
  const prevInputsPrev = await loadInputs(db, year - 2);
  const values = computeYear(cur, prev);
  const prevValues = computeYear(prev, prevInputsPrev);
  const targets = Object.fromEntries(tg.rows.map((r) => [r.code, r.t]));
  const hasData = (i) => INPUT_CODES.size && [...INPUT_CODES].some((c) => cur[c]?.[i] != null);
  let latest = -1;
  for (let i = 11; i >= 0; i--) if (hasData(i)) { latest = i; break; }
  const avg = {};
  for (const d of DEFS) avg[d.code] = { prev: mean(prevValues[d.code]), current: mean(values[d.code]) };
  return {
    year, years: yrs.rows.map((r) => r.year), latest_month: latest < 0 ? null : latest + 1,
    groups: GROUPS, indicators: INDICATORS.map((d) => ({ ...d, target: targets[d.code] ?? null })),
    values, prev: prevValues, avg, targets,
  };
}

// ---------- análise: o que melhorou / piorou ----------
const CHANGE_MIN = 3;   // % de variação mínima para dizer que mudou
export function analyze(report) {
  if (report.latest_month == null) return { month: null, worse: [], better: [], off_target: [], headline: [] };
  const rows = [];
  for (const d of report.indicators) {
    // cada indicador usa o seu último mês com dado (nem tudo é fechado todo mês)
    const series = report.values[d.code];
    let li = -1;
    for (let i = 11; i >= 0; i--) if (series[i] != null) { li = i; break; }
    if (li < 0) continue;
    const cur = series[li];
    const ly = report.prev[d.code][li];
    const lm = li > 0 ? series[li - 1] : null;
    const pct = (a, b) => (a == null || b == null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
    const row = { code: d.code, label: d.label, unit: d.unit, dec: d.dec, group: d.group, good: d.good, month: li + 1, value: cur, last_year: ly, last_month: lm, yoy_pct: pct(cur, ly), mom_pct: pct(cur, lm), target: d.target };
    // sentido: +1 melhorou, -1 piorou, 0 igual — contra o mesmo mês do ano anterior (senão contra o mês anterior)
    const basis = row.yoy_pct ?? row.mom_pct;
    row.basis = row.yoy_pct != null ? 'ano' : row.mom_pct != null ? 'mes' : null;
    row.trend = d.good && basis != null && Math.abs(basis) >= CHANGE_MIN ? ((basis > 0) === (d.good === 'up') ? 1 : -1) : 0;
    if (d.target != null) {
      const meets = d.good === 'down' ? cur <= d.target : cur >= d.target;
      const gap = (Math.abs(cur - d.target) / (Math.abs(d.target) || 1)) * 100;
      row.target_status = meets ? 'ok' : gap <= 10 ? 'atencao' : 'alerta';
    }
    rows.push(row);
  }
  const mag = (r) => Math.abs(r.yoy_pct ?? r.mom_pct ?? 0);
  const HEAD = ['prod_diaria', 'produtividade', 'vacas_lactacao', 'del', 'ccs', 'conc_geral', 'pct_prenhes', 'pct_mastite', 'proj_saida_adulta', 'rmca', 'gordura', 'proteina'];
  return {
    month: report.latest_month,
    headline: HEAD.map((c) => rows.find((r) => r.code === c)).filter(Boolean),
    worse: rows.filter((r) => r.trend === -1).sort((a, b) => mag(b) - mag(a)).slice(0, 10),
    better: rows.filter((r) => r.trend === 1).sort((a, b) => mag(b) - mag(a)).slice(0, 10),
    off_target: rows.filter((r) => r.target_status && r.target_status !== 'ok'),
  };
}

// ---------- gravação ----------
export async function saveMonth(db, userId, year, month, values, source = 'manual') {
  let saved = 0; let removed = 0;
  for (const [code, raw] of Object.entries(values || {})) {
    if (!INPUT_CODES.has(code)) throw Object.assign(new Error(`Indicador desconhecido: ${code}`), { statusCode: 400 });
    if (raw === null || raw === '' || raw === undefined) {
      removed += (await db.query('delete from perf_values where year=$1 and month=$2 and code=$3', [year, month, code])).rowCount;
      continue;
    }
    const v = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) throw Object.assign(new Error(`Valor inválido em ${BY_CODE.get(code).label}.`), { statusCode: 400 });
    await db.query(
      `insert into perf_values (year, month, code, value, source, updated_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (year, month, code) do update set value = excluded.value, source = excluded.source, updated_by = excluded.updated_by, updated_at = now()`,
      [year, month, code, v, source, userId]);
    saved++;
  }
  return { saved, removed };
}

// ---------- leitura da planilha ----------
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const cellNumber = (c) => {
  let v = c?.value;
  if (v && typeof v === 'object') v = 'result' in v ? v.result : v.richText ? null : null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim())) return Number(v.replace(',', '.'));
  return null;
};

/** Lê a planilha "Zootécnico": cada aba com nome de ano (2025, 2026…) vira um ano. Não grava nada. */
export async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const years = []; const ignored = []; const unknown = new Set();
  for (const ws of wb.worksheets) {
    const year = /^\s*(20\d\d)\s*$/.test(ws.name) ? Number(ws.name) : null;
    if (!year) { ignored.push(ws.name); continue; }
    // linha de cabeçalho: meses Jan…Dez em colunas seguidas
    let head = null; let firstCol = 0;
    ws.eachRow((row, n) => {
      if (head) return;
      row.eachCell((cell, c) => { if (!head && String(cell.value).trim().toLowerCase() === 'jan') { head = n; firstCol = c; } });
    });
    if (!head) { ignored.push(`${ws.name} (sem cabeçalho de meses)`); continue; }
    const cells = []; const previous = []; let labelCol = firstCol - 1;
    for (let n = head + 1; n <= ws.rowCount; n++) {
      const label = ws.getCell(n, labelCol).value;
      if (label == null || typeof label === 'object') continue;
      const key = keyOf(label);
      let code = LABEL_MAP.get(key); let prevYear = false;
      if (YEAR_ROW.test(key)) code = 'prod_diaria';
      if (PREV_ROWS[key]) { code = PREV_ROWS[key]; prevYear = true; }
      const def = code && BY_CODE.get(code);
      if (!def) { unknown.add(String(label).trim()); continue; }
      if (!prevYear && def.kind !== 'input') continue;           // calculado: recalculamos, não importamos
      for (let m = 0; m < 12; m++) {
        const v = cellNumber(ws.getCell(n, firstCol + m));
        if (v != null) (prevYear ? previous : cells).push({ year: prevYear ? year - 1 : year, month: m + 1, code, value: v });
      }
    }
    years.push({ year, sheet: ws.name, cells, previous });
  }
  return { years, ignored, unknown: [...unknown] };
}

export async function commitWorkbook(db, userId, parsed, filename) {
  let cells = 0;
  for (const y of parsed.years) {
    for (const c of y.cells) {
      await db.query(
        `insert into perf_values (year, month, code, value, source, updated_by) values ($1,$2,$3,$4,'planilha',$5)
         on conflict (year, month, code) do update set value = excluded.value, source = 'planilha', updated_by = excluded.updated_by, updated_at = now()`,
        [c.year, c.month, c.code, c.value, userId]);
      cells++;
    }
  }
  // comparativos do ano anterior: só preenchem o que ainda não existe (nunca sobrescrevem dado real)
  for (const y of parsed.years) {
    for (const c of y.previous) {
      cells += (await db.query(
        `insert into perf_values (year, month, code, value, source, updated_by) values ($1,$2,$3,$4,'planilha-comparativo',$5)
         on conflict (year, month, code) do nothing`, [c.year, c.month, c.code, c.value, userId])).rowCount;
    }
  }
  return { cells };
}

export const monthName = (m) => MONTHS[m - 1];
