import { audit } from './auth.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lança uma análise manual (também usada pela sincronização offline).
 * Retorna { status: 'criado'|'atualizado'|'duplicado'|'erro', error?, id? }
 * Idempotente: o mesmo client_uuid nunca cria duas vezes.
 */
export async function saveManualAnalysis(db, user, item, types) {
  const type = types.find((t) => t.code === String(item.type || '').toUpperCase());
  if (!type) return { status: 'erro', error: 'Tipo de análise desconhecido.' };
  const value = Number(String(item.value).replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return { status: 'erro', error: 'Valor inválido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || '') || isNaN(new Date(item.date))) return { status: 'erro', error: 'Data inválida.' };
  const uuid = item.client_uuid && UUID.test(item.client_uuid) ? item.client_uuid : null;

  if (uuid) {
    const dup = await db.query('select id from analyses where client_uuid = $1', [uuid]);
    if (dup.rows.length) return { status: 'duplicado', id: dup.rows[0].id };
  }
  let animalId = null;
  if (item.scope !== 'tank') {
    const a = await db.query('select id from animals where upper(tag) = upper($1) and deleted_at is null', [String(item.tag || '').trim()]);
    if (!a.rows.length) return { status: 'erro', error: `Brinco ${item.tag} não cadastrado.` };
    animalId = a.rows[0].id;
  }
  const scope = animalId ? 'animal' : 'tank';
  const existing = await db.query(
    `select id, value from analyses where scope = $1 and coalesce(animal_id, 0) = coalesce($2::bigint, 0)
        and analysis_date = $3 and type_code = $4 and deleted_at is null`,
    [scope, animalId, item.date, type.code]);
  if (existing.rows.length) {
    const old = existing.rows[0];
    await db.query('update analyses set value = $2, updated_at = now(), source = $3 where id = $1', [old.id, value, 'manual']);
    await audit(db, user.id, 'alterar', 'analysis', old.id, { value: { de: old.value, para: value } });
    return { status: 'atualizado', id: old.id };
  }
  const ins = await db.query(
    `insert into analyses (scope, animal_id, analysis_date, type_code, value, source, client_uuid, created_by)
     values ($1,$2,$3,$4,$5,'manual',$6,$7) returning id`,
    [scope, animalId, item.date, type.code, value, uuid, user.id]);
  await audit(db, user.id, 'criar', 'analysis', ins.rows[0].id, { type: type.code, value, date: item.date });
  return { status: 'criado', id: ins.rows[0].id };
}
