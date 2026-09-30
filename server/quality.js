// Cálculos de qualidade do leite: estatísticas, status por limite, dashboards.

export function thresholds(type, scope = 'animal') {
  return scope === 'tank'
    ? { warnHigh: type.tank_warn_high, alertHigh: type.tank_alert_high, warnLow: type.tank_warn_low, alertLow: type.tank_alert_low }
    : { warnHigh: type.warn_high, alertHigh: type.alert_high, warnLow: type.warn_low, alertLow: type.alert_low };
}

export function statusOf(type, value, scope = 'animal') {
  const t = thresholds(type, scope);
  if ((t.alertHigh != null && value > t.alertHigh) || (t.alertLow != null && value < t.alertLow)) return 'alerta';
  if ((t.warnHigh != null && value > t.warnHigh) || (t.warnLow != null && value < t.warnLow)) return 'atencao';
  return 'ok';
}

export function mean(values, geometric) {
  const v = geometric ? values.filter((x) => x > 0) : values;
  if (!v.length) return null;
  return geometric ? Math.exp(v.reduce((a, x) => a + Math.log(x), 0) / v.length) : v.reduce((a, x) => a + x, 0) / v.length;
}

export const round = (n, d) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export async function getTypes(db, { onlyActive = true } = {}) {
  const { rows } = await db.query(
    `select * from analysis_types ${onlyActive ? 'where active' : ''} order by sort_order, code`);
  return rows;
}

const lotClause = (lot, params) => {
  if (!lot) return '';
  params.push(lot);
  return ` and a.lot = $${params.length}`;
};

// Datas de "coleta" do rebanho, da mais recente para a mais antiga.
// Lançamentos avulsos (poucas vacas) não contam como coleta: a data precisa ter ao menos
// 30% das vacas da maior coleta recente (mínimo de 5), senão um lançamento solto distorceria o painel.
async function testDates(db, code, lot, limit = 2) {
  const params = [code];
  const { rows } = await db.query(
    `select an.analysis_date d, count(*)::int n from analyses an join animals a on a.id = an.animal_id
      where an.scope = 'animal' and an.type_code = $1 and an.deleted_at is null and a.deleted_at is null
        and an.analysis_date >= (select max(analysis_date) from analyses where type_code = $1 and scope = 'animal' and deleted_at is null) - 400
      ${lotClause(lot, params)} group by 1 order by 1 desc`, params);
  const max = Math.max(0, ...rows.map((r) => r.n));
  const min = Math.min(max, Math.max(5, Math.ceil(max * 0.3)));
  const full = rows.filter((r) => r.n >= min);
  return (full.length ? full : rows).slice(0, limit).map((r) => r.d);
}

async function valuesOn(db, code, date, lot) {
  const params = [code, date];
  const { rows } = await db.query(
    `select an.value from analyses an join animals a on a.id = an.animal_id
      where an.scope = 'animal' and an.type_code = $1 and an.analysis_date = $2
        and an.deleted_at is null and a.deleted_at is null ${lotClause(lot, params)}`, params);
  return rows.map((r) => r.value);
}

export async function summary(db, { lot } = {}) {
  const types = await getTypes(db);
  const cards = [];
  for (const t of types.filter((x) => x.scale !== 'tank')) {
    const [d, prev] = await testDates(db, t.code, lot, 2);
    if (!d) { cards.push({ code: t.code, name: t.name, unit: t.unit, decimals: t.decimals, date: null }); continue; }
    const vals = await valuesOn(db, t.code, d, lot);
    const pv = prev ? await valuesOn(db, t.code, prev, lot) : [];
    const st = { ok: 0, atencao: 0, alerta: 0 };
    vals.forEach((v) => st[statusOf(t, v)]++);
    const value = mean(vals, t.geometric);
    const previous = pv.length ? mean(pv, t.geometric) : null;
    cards.push({
      code: t.code, name: t.name, unit: t.unit, decimals: t.decimals, geometric: t.geometric,
      date: d, previous_date: prev || null, n: vals.length,
      value: round(value, t.decimals + 1), previous: round(previous, t.decimals + 1),
      status_herd: statusOf(t, value),
      counts: st,
      pct_atencao: round((100 * st.atencao) / vals.length, 1),
      pct_alerta: round((100 * st.alerta) / vals.length, 1),
    });
  }
  const tank = [];
  for (const t of types.filter((x) => x.scale !== 'animal')) {
    const { rows } = await db.query(
      `select analysis_date d, value from analyses where scope = 'tank' and type_code = $1 and deleted_at is null
        order by analysis_date desc limit 2`, [t.code]);
    if (!rows.length) continue;
    tank.push({
      code: t.code, name: t.name, unit: t.unit, decimals: t.decimals, date: rows[0].d, value: rows[0].value,
      previous: rows[1]?.value ?? null, status: statusOf(t, rows[0].value, 'tank'),
    });
  }
  return { cards, tank };
}

export async function trend(db, { scope = 'animal', months = 12, lot } = {}) {
  const types = await getTypes(db);
  const byCode = new Map(types.map((t) => [t.code, t]));
  const params = [scope, Math.min(Math.max(+months || 12, 1), 60)];
  const join = scope === 'animal' ? 'join animals a on a.id = an.animal_id and a.deleted_at is null' : '';
  const lotSql = scope === 'animal' ? lotClause(lot, params) : '';
  const { rows } = await db.query(
    `select to_char(date_trunc('month', an.analysis_date), 'YYYY-MM') as month, an.type_code,
            count(*)::int n, avg(an.value) avg,
            exp(avg(ln(nullif(an.value, 0)))) geo
       from analyses an ${join}
      where an.scope = $1 and an.deleted_at is null
        and an.analysis_date >= (date_trunc('month', (select max(analysis_date) from analyses where scope = $1 and deleted_at is null))
                                 - (($2::int - 1) || ' months')::interval)::date
        ${lotSql}
      group by 1, 2 order by 1, 2`, params);
  return rows
    .filter((r) => byCode.has(r.type_code))
    .map((r) => {
      const t = byCode.get(r.type_code);
      return { month: r.month, code: r.type_code, n: r.n, value: round(t.geometric ? r.geo : r.avg, t.decimals + 1) };
    });
}

export async function distribution(db, { code = 'CCS', lot } = {}) {
  const types = await getTypes(db, { onlyActive: false });
  const t = types.find((x) => x.code === code);
  if (!t) return null;
  const [d] = await testDates(db, code, lot, 1);
  if (!d) return { code, date: null, bins: [], counts: { ok: 0, atencao: 0, alerta: 0 } };
  const vals = (await valuesOn(db, code, d, lot)).sort((a, b) => a - b);
  const counts = { ok: 0, atencao: 0, alerta: 0 };
  vals.forEach((v) => counts[statusOf(t, v)]++);
  const cap = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))] || 1;
  const nb = 10; const w = cap / nb || 1;
  const bins = Array.from({ length: nb }, (_, i) => ({ from: round(i * w, 2), to: round((i + 1) * w, 2), n: 0 }));
  vals.forEach((v) => { bins[Math.min(nb - 1, Math.floor(v / w))].n++; });
  return { code, date: d, n: vals.length, counts, bins, last_bin_open: vals[vals.length - 1] > cap };
}

export async function ranking(db, { code = 'CCS', order = 'worst', limit = 20, lot } = {}) {
  const types = await getTypes(db, { onlyActive: false });
  const t = types.find((x) => x.code === code);
  if (!t) return null;
  const [d] = await testDates(db, code, lot, 1);
  if (!d) return { code, date: null, rows: [] };
  const params = [code, d];
  const lotSql = lotClause(lot, params);
  // "pior" = mais alto para CCS/CBT, mais baixo para gordura/proteína
  const worstIsHigh = thresholds(t).alertHigh != null || !!t.geometric;
  const desc = (order === 'worst') === worstIsHigh;
  const { rows } = await db.query(
    `select a.id, a.tag, a.lot, a.status, an.value,
            (select p.value from analyses p where p.animal_id = a.id and p.type_code = $1 and p.scope = 'animal'
                and p.deleted_at is null and p.analysis_date < $2 order by p.analysis_date desc limit 1) as previous
       from analyses an join animals a on a.id = an.animal_id
      where an.scope = 'animal' and an.type_code = $1 and an.analysis_date = $2
        and an.deleted_at is null and a.deleted_at is null ${lotSql}
      order by an.value ${desc ? 'desc' : 'asc'}, a.tag limit ${Math.min(Math.max(+limit || 20, 1), 500)}`, params);
  return { code, date: d, rows: rows.map((r) => ({ ...r, status_value: statusOf(t, r.value) })) };
}

// Alertas por vaca (a partir dos últimos 3 testes de cada uma)
export async function cowAlerts(db, { code = 'CCS', lot } = {}) {
  const types = await getTypes(db, { onlyActive: false });
  const t = types.find((x) => x.code === code);
  if (!t) return null;
  const [d] = await testDates(db, code, lot, 1);
  if (!d) return { code, date: null, items: [] };
  const params = [code, d];
  const lotSql = lotClause(lot, params);
  const { rows } = await db.query(
    `select id, tag, lot, array_agg(value::float8 order by analysis_date desc) vals, array_agg(analysis_date::text order by analysis_date desc) dates
       from (select a.id, a.tag, a.lot, an.value, an.analysis_date,
                    row_number() over (partition by a.id order by an.analysis_date desc) rn
               from analyses an join animals a on a.id = an.animal_id
              where an.scope = 'animal' and an.type_code = $1 and an.deleted_at is null and a.deleted_at is null
                and an.analysis_date <= $2 ${lotSql}) x
      where rn <= 3 group by id, tag, lot`, params);
  const th = thresholds(t);
  const items = [];
  for (const r of rows) {
    if (r.dates[0] !== d) continue;              // só quem foi testada na última coleta
    const [v0, v1, v2] = r.vals;
    const warn = th.warnHigh, alert = th.alertHigh;
    if (warn == null) continue;
    const kinds = [];
    if (alert != null && v0 > alert) kinds.push('alta');
    if (v1 != null && v0 > warn && v1 > warn && (v2 == null || v2 > warn)) kinds.push('cronica');
    else if (v1 != null && v0 > warn && v1 <= warn) kinds.push('nova');
    if (kinds.length) items.push({ id: r.id, tag: r.tag, lot: r.lot, value: v0, previous: v1 ?? null, kinds });
  }
  items.sort((a, b) => b.value - a.value);
  return { code, date: d, warn: th.warnHigh, alert: th.alertHigh, items };
}

export async function lots(db) {
  const { rows } = await db.query(
    `select lot, count(*)::int n from animals where deleted_at is null and lot is not null and lot <> ''
      group by lot order by lot`);
  return rows;
}

// ---------- Relatório de controle leiteiro (por vaca, CCS mês a mês) ----------
// REGRAS PROVISÓRIAS (a confirmar com a veterinária): meta = limite "atenção" da CCS (200 mil);
// a situação usa as duas últimas coletas de cada vaca:
//   sadia = as duas ≤ meta · nova infecção = última > meta e anterior ≤ meta ·
//   crônica = as duas > meta · curada = última ≤ meta e anterior > meta · sem histórico = só uma coleta.
export function qualityStatus(last, prev, goal) {
  if (last == null) return null;
  if (prev == null) return last > goal ? 'acima' : 'sem_historico';
  if (last > goal && prev > goal) return 'cronica';
  if (last > goal) return 'nova';
  if (prev > goal) return 'curada';
  return 'sadia';
}

const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

// Grupos provisórios: lactantes = situação "lactação"; primíparas = LAC 1; paridas = LAC 2 ou mais; novilhas = situação "novilha".
export function inGroup(a, group) {
  switch (group) {
    case 'lactantes': return a.status === 'lactacao';
    case 'primiparas': return a.lactation_number === 1;
    case 'paridas': return a.lactation_number != null && a.lactation_number >= 2;
    case 'novilhas': return a.status === 'novilha';
    default: return true;
  }
}

export async function milkControl(db, { group = 'todas', status = 'todas', lot } = {}) {
  const types = await getTypes(db, { onlyActive: false });
  const t = types.find((x) => x.code === 'CCS');
  if (!t) return null;
  const goal = t.warn_high ?? 200;
  const [latest] = await testDates(db, 'CCS', lot, 1);
  if (!latest) return { goal, latest: null, months: [], rows: [], kpis: null };
  const [y, m] = latest.split('-').map(Number);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (11 - i), 1)); return d.toISOString().slice(0, 7);
  });
  const params = [months[0] + '-01', latest];
  const lotSql = lotClause(lot, params);
  const { rows: raw } = await db.query(
    `select a.id, a.tag, a.lot, a.status, a.lactation_number, a.calving_date, an.analysis_date d, an.value
       from analyses an join animals a on a.id = an.animal_id
      where an.scope = 'animal' and an.type_code = 'CCS' and an.deleted_at is null and a.deleted_at is null
        and an.analysis_date between $1 and $2 ${lotSql} order by a.tag, an.analysis_date`, params);
  const byAnimal = new Map();
  for (const r of raw) {
    if (!byAnimal.has(r.id)) byAnimal.set(r.id, { ...r, tests: [] });
    byAnimal.get(r.id).tests.push({ d: r.d, value: r.value });
  }
  // produção do dia da coleta mais recente (kg) — base do "impacto no tanque"
  const milk = new Map((await db.query(
    `select animal_id, value from analyses where scope = 'animal' and type_code = 'LEITE' and analysis_date = $1 and deleted_at is null`, [latest])).rows.map((r) => [r.animal_id, r.value]));
  let rows = [];
  for (const a of byAnimal.values()) {
    if (!inGroup(a, group)) continue;
    const last = a.tests[a.tests.length - 1]; const prev = a.tests[a.tests.length - 2];
    if (last.d !== latest && group !== 'todas') { /* mantém: vaca sem teste na última coleta segue listada */ }
    const st = qualityStatus(last.value, prev?.value, goal);
    const byMonth = {};
    for (const x of a.tests) byMonth[x.d.slice(0, 7)] = x.value;      // última do mês
    rows.push({
      id: a.id, tag: a.tag, lot: a.lot, lac: a.lactation_number,
      del: a.calving_date ? daysBetween(a.calving_date, latest) : null,
      months: months.map((k) => byMonth[k] ?? null), status: st,
      ccs12: round(mean(a.tests.map((x) => x.value), true), 0), last: last.value,
      stale: last.d !== latest, milk: last.d === latest ? milk.get(a.id) ?? null : null, impact: null,
    });
  }
  // impacto no tanque: parte de cada vaca na soma (CCS x leite) do rebanho — mesma conta do relatório oficial (2.2)
  const tankSum = rows.reduce((sum, r) => sum + (r.milk != null ? r.last * r.milk : 0), 0);
  if (tankSum > 0) rows.forEach((r) => { if (r.milk != null) r.impact = (100 * r.last * r.milk) / tankSum; });
  const dist = { sadia: 0, nova: 0, cronica: 0, curada: 0, acima: 0, sem_historico: 0 };
  rows.forEach((r) => { if (r.status) dist[r.status]++; });
  const accept = { todas: () => true, sadias: (r) => r.status === 'sadia', curadas: (r) => r.status === 'curada', nova: (r) => r.status === 'nova',
    cronicas: (r) => r.status === 'cronica', acima200: (r) => r.last > goal }[status] || (() => true);
  const totalCows = rows.length;
  rows = rows.filter(accept);
  const dels = rows.map((r) => r.del).filter((x) => x != null);
  return {
    goal, latest, months, rows, distribution: dist,
    kpis: {
      quantity: rows.length, pct_herd: totalCows ? round((100 * rows.length) / totalCows, 1) : null,
      avg_del: dels.length ? Math.round(dels.reduce((s, x) => s + x, 0) / dels.length) : null,
      early_high: rows.filter((r) => r.del != null && r.del < 45 && r.last > goal).length,
      avg_milk: (() => { const m = rows.map((r) => r.milk).filter((x) => x != null); return m.length ? round(m.reduce((a, b) => a + b, 0) / m.length, 1) : null; })(),
      tank_impact: tankSum > 0 ? round(rows.reduce((a, r) => a + (r.impact || 0), 0), 1) : null,
      tank_ccs: tankSum > 0 ? round(tankSum / [...byAnimal.values()].reduce((sum, a) => { const l = a.tests[a.tests.length - 1]; return sum + (l.d === latest ? milk.get(a.id) || 0 : 0); }, 0), 0) : null,
    },
  };
}

// ---------- Resultados do tanque: uma linha por data ----------
export async function tankResults(db) {
  const { rows } = await db.query(
    `select analysis_date d, type_code, value from analyses where scope = 'tank' and deleted_at is null order by analysis_date desc, type_code`);
  const byDate = new Map();
  for (const r of rows) { if (!byDate.has(r.d)) byDate.set(r.d, { date: r.d, values: {} }); byDate.get(r.d).values[r.type_code] = r.value; }
  return [...byDate.values()];
}
