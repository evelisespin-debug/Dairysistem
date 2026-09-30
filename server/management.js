// Dashboard de gestão da qualidade do leite: indicadores de rebanho calculados controle a controle.
// Base: CCS e leite por vaca em cada controle enviado (importação de arquivo). Meta = limite "atenção" da CCS (200 mil).
import { getTypes, mean, round } from './quality.js';

export const BANDS = [['ate45', 'Até 45 DEL', 0, 45], ['46a100', '46 a 100 DEL', 46, 100], ['101a200', '101 a 200 DEL', 101, 200], ['201a300', '201 a 300 DEL', 201, 300], ['301mais', 'Mais de 300 DEL', 301, 99999]];
const bandOf = (del) => (del == null ? null : (BANDS.find((b) => del >= b[2] && del <= b[3]) || [null])[0]);
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const pct = (a, b, d = 1) => (b ? round((100 * a) / b, d) : null);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export async function management(db, { controls = 12, lot } = {}) {
  const N = Math.min(Math.max(+controls || 12, 3), 36);
  const types = await getTypes(db, { onlyActive: false });
  const ccsType = types.find((t) => t.code === 'CCS');
  const goal = ccsType?.warn_high ?? 200;
  const severe = ccsType?.alert_high ?? 400;

  const { rows: dr } = await db.query(
    `select distinct analysis_date::text d from analyses where scope = 'animal' and type_code = 'CCS' and source = 'importacao' and deleted_at is null
      order by d desc limit ${N + 2}`);
  const all = dr.map((r) => r.d).reverse();                       // datas de controle, da mais antiga para a mais recente
  if (all.length < 1) return { goal, severe, dates: [], series: [], empty: true };
  const window = all.slice(-N);                                   // controles exibidos
  const firstShown = all.indexOf(window[0]);

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
  const prevTest = (a, di) => { for (const k of [di - 1, di - 2]) if (k >= 0 && a.t[all[k]]?.ccs != null) return a.t[all[k]].ccs; return null; };

  const { rows: tk } = await db.query(`select analysis_date::text d, value from analyses where scope = 'tank' and type_code = 'CCS' and deleted_at is null and analysis_date = any($1::date[])`, [all]);
  const tankLab = new Map(tk.map((r) => [r.d, r.value]));

  const series = []; const bandAgg = Object.fromEntries(BANDS.map((b) => [b[0], { n: 0, high: 0, nova: 0, healthyPrev: 0 }]));
  let testsWindow = 0; let testsWithDel = 0;
  for (let i = 0; i < window.length; i++) {
    const d = window[i]; const di = firstShown + i;
    const tested = []; for (const a of animals.values()) { const t = a.t[d]; if (t?.ccs != null) tested.push({ a, ccs: t.ccs, milk: t.milk ?? null }); }
    const st = { sadia: 0, nova: 0, cronica: 0, curada: 0 }; let high = 0; let high4 = 0;
    const early = { n: 0, high: 0 }; const late = { n: 0, high: 0 }; const mLo = []; const mHi = []; let sumCM = 0; let sumM = 0;
    for (const r of tested) {
      const isHigh = r.ccs >= goal; if (isHigh) high++; if (r.ccs >= severe) high4++;
      if (r.milk != null) { (isHigh ? mHi : mLo).push(r.milk); sumCM += r.ccs * r.milk; sumM += r.milk; }
      const lc = lacAt(r.a.id, d); const del = lc ? daysBetween(lc.c, d) : null;
      testsWindow++; const band = bandOf(del);
      if (band) { testsWithDel++; bandAgg[band].n++; if (isHigh) bandAgg[band].high++; (del <= 45 ? early : late).n++; if (isHigh) (del <= 45 ? early : late).high++; }
      const p = prevTest(r.a, di);
      if (p != null) {
        const k = isHigh && p >= goal ? 'cronica' : isHigh ? 'nova' : p >= goal ? 'curada' : 'sadia'; st[k]++;
        if (band && !(isHigh && p >= goal) && !(p >= goal)) { bandAgg[band].healthyPrev++; if (isHigh) bandAgg[band].nova++; }
      }
    }
    const withPrev = st.sadia + st.nova + st.cronica + st.curada;
    series.push({
      date: d, tested: tested.length, healthy: tested.length - high, high, high400: high4,
      pct_healthy: pct(tested.length - high, tested.length), pct_high: pct(high, tested.length), pct_high400: pct(high4, tested.length),
      gm_ccs: round(mean(tested.map((r) => r.ccs), true), 0), tank_lab: tankLab.get(d) ?? null, tank_calc: sumM ? round(sumCM / sumM, 0) : null,
      ...st, with_prev: withPrev,
      pct_sadia: pct(st.sadia, withPrev), pct_nova: pct(st.nova, withPrev), pct_cronica: pct(st.cronica, withPrev), pct_curada: pct(st.curada, withPrev),
      incidence: pct(st.nova, st.nova + st.sadia), cure_rate: pct(st.curada, st.curada + st.cronica),
      del_early: early.n ? { n: early.n, high: early.high, pct: pct(early.high, early.n) } : null, del_late: late.n ? { n: late.n, high: late.high, pct: pct(late.high, late.n) } : null,
      milk_low: round(avg(mLo), 1), milk_high: round(avg(mHi), 1),
    });
  }
  const last = series[series.length - 1]; const prev = series[series.length - 2] || null;
  const latest = window[window.length - 1]; const li = all.length - 1;

  // ---- último controle: impacto no tanque, perda de produção, lactação, recorrentes ----
  const cur = []; for (const a of animals.values()) { const t = a.t[latest]; if (t?.ccs != null) cur.push({ a, ccs: t.ccs, milk: t.milk ?? null }); }
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
  for (const r of cur) { const lc = lacAt(r.a.id, latest); const l = lc?.l ?? r.a.lacNow; if (l == null || l < 1) continue; const g = byLac[Math.min(l, 4)]; g.n++; if (r.ccs >= goal) g.high++; }
  const lactation = Object.entries(byLac).map(([l, g]) => ({ lac: +l, label: +l === 4 ? '4 ou mais' : `${l}ª lactação`, n: g.n, high: g.high, pct: pct(g.high, g.n) }));

  const K = Math.min(6, all.length); const recent = all.slice(-K); const recurrent = [];
  for (const a of animals.values()) {
    const vals = recent.map((d) => a.t[d]?.ccs ?? null); if (vals[vals.length - 1] == null) continue;
    let consec = 0; for (let i = vals.length - 1; i >= 0 && vals[i] != null && vals[i] >= goal; i--) consec++;
    const highN = vals.filter((v) => v != null && v >= goal).length; const testedN = vals.filter((v) => v != null).length;
    if (consec >= 3 || (testedN >= 4 && highN >= 4)) {
      const lc = lacAt(a.id, latest);
      recurrent.push({ id: a.id, tag: a.tag, lot: a.lot, consecutive: consec, high_of: `${highN}/${testedN}`, last: vals[vals.length - 1], values: vals, lac: lc?.l ?? a.lacNow, del: lc ? daysBetween(lc.c, latest) : null, milk: a.t[latest]?.milk ?? null });
    }
  }
  recurrent.sort((x, y) => y.consecutive - x.consecutive || y.last - x.last);

  const bands = BANDS.map((b) => { const g = bandAgg[b[0]]; return { key: b[0], label: b[1], tests: g.n, high: g.high, prevalence: pct(g.high, g.n), new_cases: g.nova, healthy_prev: g.healthyPrev, incidence: pct(g.nova, g.healthyPrev) }; });
  const sum = (k) => series.reduce((s, x) => s + (x[k] || 0), 0);
  return {
    goal, severe, dates: window, latest, controls_available: dr.length, series, last, prev,
    kpis: { herd: last.tested, ...last }, avg: {
      incidence: pct(sum('nova'), sum('nova') + sum('sadia')), cure_rate: pct(sum('curada'), sum('curada') + sum('cronica')), months: series.length,
    },
    impact, loss, lactation, bands, recurrent: recurrent.slice(0, 25), recurrent_total: recurrent.length,
    del_coverage: pct(testsWithDel, testsWindow, 0),
  };
}
