import { parseDate, parseNumber } from './importer.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9$%]/g, '');
const HAPLOS = ['HH1', 'HH3', 'HH4', 'HH5', 'HH6', 'DUMPS'];
// coluna do arquivo -> campo da tabela (os demais índices vão para `traits`)
const FIELDS = { id: 'tag', dtnasc: 'birth', idgenomico: 'genomic_id', naab: 'naab', pai: 'sire_name', ic: 'ic', nm: 'nm', tpi: 'tpi',
  leite: 'milk', gor: 'fat', pro: 'protein', '%gor': 'fat_pct', '%pro': 'pro_pct', dpr: 'dpr', betac: 'beta_casein', kappac: 'kappa_casein',
  tourocorreto: 'sire_check', touroenviado: 'sire_sent', mae: 'dam_reg', batchdate: 'batch_date' };

// Escolhe a aba que tem as colunas ID + TPI (o arquivo vem com várias abas de resumo).
export function genomicsTable(sheets) {
  for (const raw of sheets) {
    const hi = raw.findIndex((r) => { const h = r.map(norm); return h.includes('id') && h.includes('tpi'); });
    if (hi >= 0) return { headers: raw[hi].map((h) => String(h ?? '').trim()), rows: raw.slice(hi + 1).filter((r) => r.some((c) => c !== null && String(c).trim() !== '')), first: hi + 2 };
  }
  return null;
}

export function buildGenomics({ headers, rows, first }) {
  const col = headers.map((h) => FIELDS[norm(h)] || null);
  const records = []; const errors = [];
  rows.forEach((cells, i) => {
    const rec = { traits: {}, haplotypes: [] };
    headers.forEach((h, j) => {
      const v = cells[j]; if (v == null || String(v).trim() === '') return;
      const f = col[j];
      if (f === 'tag') rec.tag = String(v).trim();
      else if (f === 'birth' || f === 'batch_date') rec[f] = parseDate(v);
      else if (['ic', 'nm', 'tpi', 'milk', 'fat', 'protein', 'fat_pct', 'pro_pct', 'dpr'].includes(f)) rec[f] = parseNumber(v, 4);
      else if (f) rec[f] = String(v).trim();
      else if (HAPLOS.includes(h.trim().toUpperCase())) { if (Number(v) >= 1) rec.haplotypes.push(h.trim().toUpperCase()); }
      else { const n = parseNumber(v, 4); rec.traits[h.trim()] = n ?? String(v).trim(); }
    });
    if (!rec.tag) errors.push({ line: first + i, error: 'Sem ID do animal.' });
    else records.push(rec);
  });
  const uniq = new Map(records.map((r) => [r.tag.toUpperCase(), r]));   // última linha vence
  return { records: [...uniq.values()], errors, recognized: col.filter(Boolean).length };
}

export function sireMismatch(r) {
  const c = r.sire_check;
  return !!c && c !== 'OK' && c !== 'No ABS found' && c !== r.sire_sent;
}

export async function saveGenomics(db, records, { createMissing, userId }) {
  const { rows: ex } = await db.query('select id, upper(tag) t, birth_date from animals where deleted_at is null');
  const byTag = new Map(ex.map((a) => [a.t, a]));
  let created = 0; let matched = 0; let skipped = 0;
  for (const r of records) {
    let a = byTag.get(r.tag.toUpperCase());
    if (!a) {
      if (!createMissing) { skipped++; continue; }
      const days = r.birth ? (Date.now() - Date.parse(r.birth)) / 864e5 : 999;
      a = (await db.query(`insert into animals (tag, birth_date, status, breed) values ($1,$2,$3,'Holandesa') returning id, birth_date`,
        [r.tag, r.birth || null, days < 180 ? 'bezerra' : 'novilha'])).rows[0];
      created++;
    } else {
      matched++;
      if (!a.birth_date && r.birth) await db.query('update animals set birth_date = $2, updated_at = now() where id = $1', [a.id, r.birth]);
    }
    await db.query(
      `insert into animal_genomics (animal_id, genomic_id, naab, sire_name, sire_sent, sire_check, dam_reg, ic, nm, tpi, milk, fat, protein, fat_pct, pro_pct, dpr,
         beta_casein, kappa_casein, haplotypes, traits, batch_date, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21, now())
       on conflict (animal_id) do update set genomic_id=excluded.genomic_id, naab=excluded.naab, sire_name=excluded.sire_name, sire_sent=excluded.sire_sent,
         sire_check=excluded.sire_check, dam_reg=excluded.dam_reg, ic=excluded.ic, nm=excluded.nm, tpi=excluded.tpi, milk=excluded.milk, fat=excluded.fat,
         protein=excluded.protein, fat_pct=excluded.fat_pct, pro_pct=excluded.pro_pct, dpr=excluded.dpr, beta_casein=excluded.beta_casein,
         kappa_casein=excluded.kappa_casein, haplotypes=excluded.haplotypes, traits=excluded.traits, batch_date=excluded.batch_date, updated_at=now()`,
      [a.id, r.genomic_id ?? null, r.naab ?? null, r.sire_name ?? null, r.sire_sent ?? null, r.sire_check ?? null, r.dam_reg ?? null,
        r.ic ?? null, r.nm ?? null, r.tpi ?? null, r.milk ?? null, r.fat ?? null, r.protein ?? null, r.fat_pct ?? null, r.pro_pct ?? null, r.dpr ?? null,
        r.beta_casein ?? null, r.kappa_casein ?? null, r.haplotypes, JSON.stringify(r.traits), r.batch_date ?? null]);
  }
  return { created, matched, skipped };
}

// Painel de genética: evolução por ano de nascimento, pais, haplótipos, paternidade, melhores animais.
export const AGE_BANDS = [['0-6', 'Até 6 meses', 0, 6], ['6-12', '6 a 12 meses', 6, 12], ['12-24', '12 a 24 meses', 12, 24], ['24+', 'Mais de 24 meses', 24, 9999]];
const ageMonths = (bd) => (bd ? (Date.now() - Date.parse(bd)) / (30.4375 * 864e5) : null);

export async function genetics(db, { age, tpi_min, tpi_max } = {}) {
  const { rows: all } = await db.query(
    `select a.id, a.tag, a.birth_date::text bd, a.status, g.sire_name, g.naab, g.sire_sent, g.sire_check, g.tpi, g.nm, g.milk, g.fat_pct, g.dpr, g.haplotypes, g.beta_casein, g.kappa_casein
       from animal_genomics g join animals a on a.id = g.animal_id where a.deleted_at is null`);
  const band = AGE_BANDS.find((b) => b[0] === age);
  const lo = tpi_min === '' || tpi_min == null ? null : Number(tpi_min); const hi = tpi_max === '' || tpi_max == null ? null : Number(tpi_max);
  const ages = all.map((r) => ageMonths(r.bd));
  const bands = AGE_BANDS.map(([key, label, a, b]) => ({ key, label, n: ages.filter((m) => m != null && m >= a && m < b).length }));
  const rows = all.filter((r, i) => {
    if (band && !(ages[i] != null && ages[i] >= band[2] && ages[i] < band[3])) return false;
    if (Number.isFinite(lo) && lo != null && !(r.tpi != null && +r.tpi >= lo)) return false;
    if (Number.isFinite(hi) && hi != null && !(r.tpi != null && +r.tpi <= hi)) return false;
    return true;
  });
  const avg = (xs) => { const v = xs.filter((x) => x != null).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const group = (keyFn) => { const m = new Map(); for (const r of rows) { const k = keyFn(r); if (k == null) continue; (m.get(k) || m.set(k, []).get(k)).push(r); } return m; };
  const byYear = [...group((r) => (r.bd ? +r.bd.slice(0, 4) : null))].sort((a, b) => a[0] - b[0])
    .map(([year, g]) => ({ year, n: g.length, tpi: avg(g.map((r) => r.tpi)), milk: avg(g.map((r) => r.milk)), fat_pct: avg(g.map((r) => r.fat_pct)), dpr: avg(g.map((r) => r.dpr)) }));
  const sires = [...group((r) => r.sire_name)].map(([sire, g]) => ({ sire, n: g.length, tpi: avg(g.map((r) => r.tpi)), milk: avg(g.map((r) => r.milk)), dpr: avg(g.map((r) => r.dpr)) }))
    .sort((a, b) => b.n - a.n).slice(0, 30);
  const haplo = {};
  for (const r of rows) for (const h of r.haplotypes) (haplo[h] ||= []).push(r.tag);
  const count = (k) => { const m = {}; for (const r of rows) if (r[k]) m[r[k]] = (m[r[k]] || 0) + 1; return m; };
  const mism = rows.filter(sireMismatch).map((r) => ({ id: r.id, tag: r.tag, sent: r.sire_sent, correct: r.sire_check }));
  const top = [...rows].filter((r) => r.tpi != null).sort((a, b) => b.tpi - a.tpi).slice(0, 15).map((r) => ({ id: r.id, tag: r.tag, sire: r.sire_name, bd: r.bd, tpi: +r.tpi, milk: r.milk == null ? null : +r.milk, dpr: r.dpr == null ? null : +r.dpr }));
  return {
    total: rows.length, total_all: all.length, bands, tpi_range: [Math.min(...all.map((r) => +r.tpi).filter(Number.isFinite)), Math.max(...all.map((r) => +r.tpi).filter(Number.isFinite))], tpi_avg: avg(rows.map((r) => r.tpi)), milk_avg: avg(rows.map((r) => r.milk)), dpr_avg: avg(rows.map((r) => r.dpr)),
    by_year: byYear, sires,
    haplotypes: Object.entries(haplo).map(([h, tags]) => ({ code: h, n: tags.length, sample: tags.slice(0, 10) })),
    beta_casein: count('beta_casein'), kappa_casein: count('kappa_casein'),
    sire_mismatch: mism.length, sire_mismatch_list: mism.slice(0, 50), sire_not_found: rows.filter((r) => r.sire_check === 'No ABS found').length,
    top,
  };
}
