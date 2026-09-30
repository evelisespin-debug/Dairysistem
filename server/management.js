// Dashboard de gestão da qualidade do leite: indicadores de rebanho calculados controle a controle.
// Definições alinhadas ao sistema DairyUp em uso (conferidas com os números da Fazenda Mariana):
//  - CCS alta = CCS >= 200 mil (meta). "Anterior" = última medição anterior da vaca.
//  - Nova infecção = anterior < 200 e agora >= 200 · Crônica = as duas >= 200 · Curada = anterior >= 200 e agora < 200 · Sadia = as duas < 200.
//  - "Parida" = vaca recém-parida (DEL até 45). Prevalência até/após 45 DEL usa o TOTAL de vacas testadas como divisor.
//  - CCS nunca é média: o valor do período é o do último controle. Taxas (%) são somadas e recalculadas no período.
import { getTypes, mean, round } from './quality.js';

export const BANDS = [['ate45', 'Até 45 DEL', 0, 45], ['46a150', '46 a 150 DEL', 46, 150], ['151a250', '151 a 250 DEL', 151, 250], ['251mais', 'Mais de 250 DEL', 251, 99999]];
const bandOf = (del) => (del == null ? null : (BANDS.find((b) => del >= b[2] && del <= b[3]) || [null])[0]);
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const pct = (a, b, d = 1) => (b ? round((100 * a) / b, d) : null);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

// Metas padrão (as do sistema em uso); a fazenda ajusta em Configurações. Todas em %, exceto os tanques (mil/mL).
export const DEFAULT_TARGETS = {
  pct_healthy: 80, pct_high: 15, high_early: 8, high_late: 10, incidence: 8, cured: 15, chronic: 8, clinical_mastitis: 3,
  tank_ccs: 180, tank_cbt: 5,
};
export async function getTargets(db) {
  const { rows } = await db.query(`select settings from farm where id = 1`);
  return { ...DEFAULT_TARGETS, ...((rows[0]?.settings || {}).targets || {}) };
}

const periodKey = (d, group) => {
  const y = d.slice(0, 4); const m = +d.slice(5, 7);
  if (group === 'anual') return y;
  if (group === 'semestral') return `${y}-S${m <= 6 ? 1 : 2}`;
  if (group === 'trimestral') return `${y}-T${Math.ceil(m / 3)}`;
  return d.slice(0, 7);
};

function emptyRaw(date) {
  return { date, tested: 0, high: 0, high400: 0, sadia: 0, nova: 0, cronica: 0, curada: 0, with_prev: 0, high_early: 0, high_late: 0, high_unknown: 0, early_n: 0,
    par: { sadia: 0, nova: 0, cronica: 0, curada: 0 }, milkLo: [], milkHi: [], sumCM: 0, sumM: 0, delSum: 0, delN: 0,
    bands: Object.fromEntries(BANDS.map((b) => [b[0], { n: 0, high: 0, nova: 0, healthyPrev: 0 }])), tank_lab: null };
}

// Junta os controles de um período: somam-se as contagens; CCS do período = a do último controle.
function finalize(raws, key) {
  const S = (f) => raws.reduce((s, r) => s + f(r), 0);
  const last = raws[raws.length - 1];
  const tested = S((r) => r.tested); const withPrev = S((r) => r.with_prev);
  const nova = S((r) => r.nova); const sadia = S((r) => r.sadia); const cron = S((r) => r.cronica); const cur = S((r) => r.curada);
  const milkLo = raws.flatMap((r) => r.milkLo); const milkHi = raws.flatMap((r) => r.milkHi);
  const lastLab = [...raws].reverse().find((r) => r.tank_lab != null);
  return {
    key, date: last.date, dates: raws.map((r) => r.date), controls: raws.length,
    tested, high: S((r) => r.high), healthy: tested - S((r) => r.high), high400: S((r) => r.high400), with_prev: withPrev, sadia, nova, cronica: cron, curada: cur,
    pct_healthy: pct(tested - S((r) => r.high), tested), pct_high: pct(S((r) => r.high), tested), pct_high400: pct(S((r) => r.high400), tested),
    pct_sadia: pct(sadia, tested), pct_nova: pct(nova, tested), pct_cronica: pct(cron, tested), pct_curada: pct(cur, tested),
    incidence: pct(nova, tested), incidence_rate: pct(nova, nova + sadia), cure_rate: pct(cur, cur + cron),
    high_early_n: S((r) => r.high_early), high_late_n: S((r) => r.high_late), early_n: S((r) => r.early_n),
    high_early: pct(S((r) => r.high_early), tested), high_late: pct(S((r) => r.high_late), tested),
    milk_low: round(avg(milkLo), 1), milk_high: round(avg(milkHi), 1), milk_diff: milkLo.length && milkHi.length ? round(avg(milkLo) - avg(milkHi), 1) : null,
    milk_avg: round(avg([...milkLo, ...milkHi]), 1),
    // CCS: sem média. Vale o último controle do período.
    tank_calc: last.sumM ? round(last.sumCM / last.sumM, 0) : null, tank_lab: lastLab ? lastLab.tank_lab : null,
    del_mean: S((r) => r.delN) ? Math.round(S((r) => r.delSum) / S((r) => r.delN)) : null,
    status_shares: withPrev ? { sadia: pct(sadia, withPrev), curada: pct(cur, withPrev), nova: pct(nova, withPrev), cronica: pct(cron, withPrev) } : null,
  };
}

export async function management(db, { controls, from, to, group = 'mensal', filter = 'todas', lot } = {}) {
  const types = await getTypes(db, { onlyActive: false });
  const ccsType = types.find((t) => t.code === 'CCS');
  const goal = ccsType?.warn_high ?? 200; const severe = ccsType?.alert_high ?? 400;
  const targets = await getTargets(db);
  const G = ['mensal', 'trimestral', 'semestral', 'anual'].includes(group) ? group : 'mensal';

  const { rows: dr } = await db.query(
    `select distinct analysis_date::text d from analyses where scope = 'animal' and type_code = 'CCS' and source = 'importacao' and deleted_at is null order by d desc limit 72`);
  const all = dr.map((r) => r.d).reverse();                               // todas as datas de controle (antiga -> recente)
  if (!all.length) return { goal, severe, targets, dates: [], series: [], empty: true };
  // janela exibida: de/até (AAAA-MM) ou os últimos N controles
  let shown = all;
  if (from || to) shown = all.filter((d) => (!from || d.slice(0, 7) >= from) && (!to || d.slice(0, 7) <= to));
  else { const N = Math.min(Math.max(+controls || 12, 3), 72); shown = all.slice(-N); }
  if (!shown.length) return { goal, severe, targets, dates: [], series: [], empty: true, controls_available: all.length, available_from: all[0].slice(0, 7), available_to: all[all.length - 1].slice(0, 7) };

  const params = [all]; let lotSql = '';
  if (lot) { params.push(lot); lotSql = ` and a.lot = $${params.length}`; }
  const { rows } = await db.query(
    `select a.id, a.tag, a.lot, a.lactation_number lac_now, x.analysis_date::text d, x.type_code c, x.value
       from analyses x join animals a on a.id = x.animal_id
      where x.scope = 'animal' and x.deleted_at is null and a.deleted_at is null and x.type_code in ('CCS', 'LEITE')
        and x.analysis_date = any($1::date[]) ${lotSql}`, params);
  const { rows: lr } = await db.query(`select animal_id, calving_date::text c, lactation_number l from animal_lactations order by animal_id, calving_date`);
  const lacs = new Map(); for (const r of lr) { if (!lacs.has(r.animal_id)) lacs.set(r.animal_id, []); lacs.get(r.animal_id).push(r); }
  const lacAt = (id, d) => { const arr = lacs.get(id); if (!arr) return null; let f = null; for (const x of arr) { if (x.c <= d) f = x; else break; } return f; };
  const animals = new Map();
  for (const r of rows) {
    if (!animals.has(r.id)) animals.set(r.id, { id: r.id, tag: r.tag, lot: r.lot, lacNow: r.lac_now, t: {} });
    (animals.get(r.id).t[r.d] ||= {})[r.c === 'CCS' ? 'ccs' : 'milk'] = r.value;
  }
  // "anterior" = última medição anterior da vaca (sem limite de intervalo)
  const prevTest = (a, di) => { for (let k = di - 1; k >= 0; k--) if (a.t[all[k]]?.ccs != null) return a.t[all[k]].ccs; return null; };
  const { rows: tk } = await db.query(`select analysis_date::text d, value from analyses where scope = 'tank' and type_code = 'CCS' and deleted_at is null and analysis_date = any($1::date[])`, [all]);
  const tankLab = new Map(tk.map((r) => [r.d, r.value]));
  const inFilter = (a, d, lc) => {
    if (filter === 'todas') return true;
    const del = lc ? daysBetween(lc.c, d) : null;
    if (filter === 'paridas') return del != null && del <= 45;
    if (filter === 'primiparas') return (lc?.l ?? a.lacNow) === 1;
    return true;
  };

  const rawByDate = new Map(); let testsWithDel = 0; let testsAll = 0;
  for (const d of shown) {
    const di = all.indexOf(d); const R = emptyRaw(d); R.tank_lab = tankLab.get(d) ?? null;
    for (const a of animals.values()) {
      const t = a.t[d]; if (t?.ccs == null) continue;
      const lc = lacAt(a.id, d); if (!inFilter(a, d, lc)) continue;
      const ccs = t.ccs; const isHigh = ccs >= goal; const del = lc ? daysBetween(lc.c, d) : null; const parida = del != null && del <= 45; const band = bandOf(del);
      R.tested++; testsAll++; if (isHigh) R.high++; if (ccs >= severe) R.high400++;
      if (del != null) { R.delSum += del; R.delN++; testsWithDel++; }
      if (parida) R.early_n++;
      if (isHigh) { if (del == null) R.high_unknown++; else if (parida) R.high_early++; else R.high_late++; }
      if (t.milk != null) { (isHigh ? R.milkHi : R.milkLo).push(t.milk); R.sumCM += ccs * t.milk; R.sumM += t.milk; }
      if (band) { const g = R.bands[band]; g.n++; if (isHigh) g.high++; }
      const p = prevTest(a, di);
      if (p != null) {
        const st = isHigh && p >= goal ? 'cronica' : isHigh ? 'nova' : p >= goal ? 'curada' : 'sadia';
        R[st]++; R.with_prev++; if (parida) R.par[st]++;
        if (band && p < goal) { R.bands[band].healthyPrev++; if (isHigh) R.bands[band].nova++; }
      }
    }
    rawByDate.set(d, R);
  }
  // períodos (mensal = 1 por mês; trimestral/semestral/anual agrupam)
  const groups = new Map();
  for (const d of shown) { const k = periodKey(d, G); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(rawByDate.get(d)); }
  const series = [...groups.entries()].map(([k, rs]) => finalize(rs, k));
  const last = series[series.length - 1]; const prev = series[series.length - 2] || null;
  const latest = shown[shown.length - 1]; const raws = shown.map((d) => rawByDate.get(d));
  const sumRaw = (f) => raws.reduce((s, r) => s + f(r), 0);

  // ---- fase da lactação em que as vacas se infectam (todo o período exibido) ----
  const totNew = sumRaw((r) => BANDS.reduce((s, b) => s + r.bands[b[0]].nova, 0));
  const bands = BANDS.map((b) => {
    const n = sumRaw((r) => r.bands[b[0]].n); const high = sumRaw((r) => r.bands[b[0]].high); const nv = sumRaw((r) => r.bands[b[0]].nova); const hp = sumRaw((r) => r.bands[b[0]].healthyPrev);
    return { key: b[0], label: b[1], tests: n, high, prevalence: pct(high, n), new_cases: nv, share_new: pct(nv, totNew), healthy_prev: hp, incidence_rate: pct(nv, hp) };
  });
  const wp = sumRaw((r) => r.with_prev);
  const pie = wp ? { sadia: pct(sumRaw((r) => r.sadia), wp), curada: pct(sumRaw((r) => r.curada), wp), nova: pct(sumRaw((r) => r.nova), wp), cronica: pct(sumRaw((r) => r.cronica), wp) } : null;

  // ---- último controle: impacto no tanque, perda de produção, lactação, recorrentes ----
  const li = all.indexOf(latest);
  const cur = []; for (const a of animals.values()) { const t = a.t[latest]; if (t?.ccs == null) continue; const lc = lacAt(a.id, latest); if (!inFilter(a, latest, lc)) continue; cur.push({ a, ccs: t.ccs, milk: t.milk ?? null, lc }); }
  const withMilk = cur.filter((r) => r.milk != null); const tot = withMilk.reduce((s, r) => s + r.ccs * r.milk, 0);
  const ranked = withMilk.map((r) => ({ id: r.a.id, tag: r.a.tag, lot: r.a.lot, ccs: r.ccs, milk: r.milk, impact: tot ? (100 * r.ccs * r.milk) / tot : 0 })).sort((x, y) => y.impact - x.impact);
  let acc = 0; let half = 0; for (const r of ranked) { acc += r.impact; half++; if (acc >= 50) break; }
  const top10n = Math.max(1, Math.round(ranked.length / 10));
  const impact = {
    cows: ranked.length, top: ranked.slice(0, 10).map((r) => ({ ...r, impact: round(r.impact, 2) })),
    top10_share: round(ranked.slice(0, 10).reduce((s, r) => s + r.impact, 0), 1),
    top10pct_share: round(ranked.slice(0, top10n).reduce((s, r) => s + r.impact, 0), 1), top10pct_n: top10n,
    half_n: ranked.length ? half : 0, half_pct: pct(half, ranked.length, 0),
  };
  const hi = withMilk.filter((r) => r.ccs >= goal); const lo = withMilk.filter((r) => r.ccs < goal);
  const aLo = avg(lo.map((r) => r.milk)); const aHi = avg(hi.map((r) => r.milk));
  const loss = aLo != null && aHi != null ? {
    n_high: hi.length, avg_low: round(aLo, 1), avg_high: round(aHi, 1), diff: round(aLo - aHi, 1), pct: pct(aLo - aHi, aLo),
    kg_day: Math.round(hi.length * (aLo - aHi)), share_of_milk: pct(hi.length * (aLo - aHi), withMilk.reduce((s, r) => s + r.milk, 0)),
  } : null;
  const byLac = { 1: { n: 0, high: 0 }, 2: { n: 0, high: 0 }, 3: { n: 0, high: 0 }, 4: { n: 0, high: 0 } };
  for (const r of cur) { const l = r.lc?.l ?? r.a.lacNow; if (l == null || l < 1) continue; const g = byLac[Math.min(l, 4)]; g.n++; if (r.ccs >= goal) g.high++; }
  const lactation = Object.entries(byLac).map(([l, g]) => ({ lac: +l, label: +l === 4 ? '4 ou mais' : `${l}ª lactação`, n: g.n, high: g.high, pct: pct(g.high, g.n) }));

  const K = Math.min(6, li + 1); const recent = all.slice(li + 1 - K, li + 1); const recurrent = [];
  for (const a of animals.values()) {
    const vals = recent.map((d) => a.t[d]?.ccs ?? null); if (vals[vals.length - 1] == null) continue;
    let consec = 0; for (let i = vals.length - 1; i >= 0 && vals[i] != null && vals[i] >= goal; i--) consec++;
    const highN = vals.filter((v) => v != null && v >= goal).length; const testedN = vals.filter((v) => v != null).length;
    if (consec >= 3 || (testedN >= 4 && highN >= 4)) {
      const lc = lacAt(a.id, latest);
      recurrent.push({ id: a.id, tag: a.tag, lot: a.lot, consecutive: consec, high_of: `${highN}/${testedN}`, last: vals[vals.length - 1], values: vals, dates: recent, lac: lc?.l ?? a.lacNow, del: lc ? daysBetween(lc.c, latest) : null, milk: a.t[latest]?.milk ?? null });
    }
  }
  recurrent.sort((x, y) => y.consecutive - x.consecutive || y.last - x.last);
  const avgOf = (k) => { const v = series.map((s) => s[k]).filter((x) => x != null); return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 1) : null; };
  return {
    goal, severe, targets, group: G, filter, dates: shown, latest, controls_available: all.length, available_from: all[0].slice(0, 7), available_to: all[all.length - 1].slice(0, 7),
    series, last, prev, kpis: last, pie, bands, impact, loss, lactation, recurrent: recurrent.slice(0, 25), recurrent_total: recurrent.length,
    avg: { incidence: avgOf('incidence'), cure_rate: avgOf('cure_rate'), cured: avgOf('pct_curada'), chronic: avgOf('pct_cronica'), months: series.length },
    del_coverage: pct(testsWithDel, testsAll, 0),
  };
}
