import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from './db.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

export async function migrate(pool) {
  await pool.query(`create table if not exists schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await pool.query('select name from schema_migrations')).rows.map((r) => r.name));
  const applied = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(fs.readFileSync(path.join(DIR, f), 'utf8'));
      await client.query('insert into schema_migrations(name) values ($1)', [f]);
      await client.query('commit');
      applied.push(f);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`Migração ${f} falhou: ${e.message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool();
  migrate(pool)
    .then((a) => console.log(a.length ? `Migrações aplicadas: ${a.join(', ')}` : 'Banco já está atualizado.'))
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
