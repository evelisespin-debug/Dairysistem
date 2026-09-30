import { newToken, tokenHash, verifySecret } from './security.js';

const SESSION_DAYS = 90;   // o celular mantém a sessão
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

// Permissões por perfil. O financeiro é tratado à parte (can_see_finance).
export const PERMS = {
  dono:        ['ver_ficha', 'lancar', 'corrigir', 'relatorios', 'importar', 'exportar', 'apagar', 'usuarios', 'config', 'auditoria',
                'estoque_ver', 'estoque_cadastros', 'estoque_entrada', 'estoque_saida', 'estoque_transferir', 'estoque_inventario', 'estoque_aprovar'],
  gerente:     ['ver_ficha', 'lancar', 'corrigir', 'relatorios', 'importar', 'exportar', 'config',
                'estoque_ver', 'estoque_cadastros', 'estoque_entrada'],
  almoxarife:  ['estoque_ver', 'estoque_entrada', 'estoque_saida', 'estoque_transferir', 'estoque_inventario'],
  encarregado: ['ver_ficha', 'lancar', 'corrigir', 'relatorios', 'importar', 'estoque_ver', 'estoque_saida'],   // encarregado de setor
  funcionario: ['ver_ficha', 'lancar'],
  veterinaria: ['ver_ficha', 'lancar', 'corrigir', 'relatorios', 'exportar', 'config', 'estoque_ver'],
};
export const can = (user, perm) => !!user && (PERMS[user.role] || []).includes(perm);

export async function audit(db, userId, action, entity, entityId, changes) {
  await db.query(
    'insert into audit_log(user_id, action, entity, entity_id, changes) values ($1,$2,$3,$4,$5)',
    [userId ?? null, action, entity, entityId == null ? null : String(entityId), changes ? JSON.stringify(changes) : null],
  );
}

export async function login(pool, { email, password, pin, userAgent }) {
  const { rows } = await pool.query(
    'select * from users where lower(email) = lower($1) and deleted_at is null', [String(email || '')]);
  const u = rows[0];
  const generic = { error: 'E-mail ou senha incorretos.' };
  if (!u || !u.active) return generic;
  if (u.locked_until && u.locked_until > new Date()) {
    return { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };
  }
  const ok = pin ? verifySecret(pin, u.pin_hash) : verifySecret(password, u.pass_hash);
  if (!ok) {
    const fails = u.failed_attempts + 1;
    await pool.query('update users set failed_attempts = $2, locked_until = $3 where id = $1',
      [u.id, fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000) : null]);
    return generic;
  }
  await pool.query('update users set failed_attempts = 0, locked_until = null where id = $1', [u.id]);
  const token = newToken();
  await pool.query('insert into sessions(token_hash, user_id, expires_at, user_agent) values ($1,$2,$3,$4)',
    [tokenHash(token), u.id, new Date(Date.now() + SESSION_DAYS * 864e5), (userAgent || '').slice(0, 200)]);
  await audit(pool, u.id, 'login', 'user', u.id);
  return { token, user: publicUser(u) };
}

export const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
  must_change_password: u.must_change_password, has_pin: !!u.pin_hash,
  can_see_finance: u.role === 'dono' || u.can_see_finance,
  permissions: PERMS[u.role] || [],
});

// Carrega o usuário a cada requisição: desativar bloqueia o acesso na hora.
export async function userFromRequest(pool, req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const { rows } = await pool.query(
    `select u.* from sessions s join users u on u.id = s.user_id
      where s.token_hash = $1 and s.expires_at > now() and u.active and u.deleted_at is null`,
    [tokenHash(token)]);
  return rows[0] || null;
}
