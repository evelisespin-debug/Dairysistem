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
        and an.analysis_date >= current_date - interval '400 days'
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
        and an.analysis_date >= (date_trunc('month', current_date) - (($2::int - 1) || ' months')::interval)::date
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
