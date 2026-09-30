import { loadFarmConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { hashSecret, randomPassword } from './security.js';

// Sincroniza a fazenda e os usuários iniciais a partir de farm.config.json.
// Usuários novos recebem uma senha temporária que aparece UMA vez aqui no terminal.
export async function seed(pool, farm, { quiet = false } = {}) {
  await pool.query(
    `insert into farm(id, slug, name) values (1, $1, $2)
     on conflict (id) do update set slug = excluded.slug, name = excluded.name, updated_at = now()`, [farm.slug, farm.name]);
  const created = [];
  for (const u of farm.initialUsers) {
    const exists = await pool.query('select 1 from users where lower(email) = lower($1) and deleted_at is null', [u.email]);
    if (exists.rows.length) continue;
    const password = u.password || randomPassword();
    await pool.query(
      'insert into users(name, email, role, pass_hash, must_change_password) values ($1,$2,$3,$4,true)',
      [u.name, u.email, u.role, hashSecret(password)]);
    created.push({ email: u.email, role: u.role, password });
  }
  if (!quiet) {
    if (!created.length) console.log('Nenhum usuário novo para criar.');
    for (const c of created) console.log(`Usuário criado: ${c.email} (${c.role}) — senha temporária: ${c.password}`);
    if (created.length) console.log('Anote as senhas agora: elas não aparecem de novo. Cada pessoa troca a senha no primeiro acesso.');
  }
  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = createPool();
  try { await migrate(pool); await seed(pool, loadFarmConfig()); } catch (e) { console.error(e.message); process.exitCode = 1; } finally { await pool.end(); }
}
