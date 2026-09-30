import { loadFarmConfig } from '../server/config.js';
import { createPool } from '../server/db.js';
import { migrate } from '../server/migrate.js';
import { seed } from '../server/seed.js';
import { buildApp } from '../server/app.js';

export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://dairy:dairy_dev@localhost:5432/dairy_test';

const ROLES = ['dono', 'gerente', 'almoxarife', 'encarregado', 'funcionario', 'veterinaria'];
export async function setup({ services } = {}) {
  const pool = createPool(TEST_DB);
  await pool.query('drop schema public cascade; create schema public');
  await migrate(pool);
  const farm = { ...loadFarmConfig({ FARM: '_template' }), name: 'Fazenda Teste' };
  farm.initialUsers = ROLES.map((r) => ({ name: r, email: `${r}@t.com`, role: r, password: 'senha-teste-1' }));
  await seed(pool, farm, { quiet: true });
  const app = await buildApp({ pool, farm, services });
  const tokens = {};
  for (const r of ROLES) {
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { email: `${r}@t.com`, password: 'senha-teste-1' } });
    tokens[r] = res.json().token;
  }
  const call = async (role, method, url, payload) => {
    const res = await app.inject({ method, url, payload, headers: { authorization: `Bearer ${tokens[role]}` } });
    return { status: res.statusCode, body: res.body ? (res.headers['content-type']?.includes('json') ? res.json() : res.body) : null, res };
  };
  const upload = async (role, csv, fields = {}, filename = 'a.csv') => {
    const b = '----b'; const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
    parts.push(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${b}--\r\n`);
    const res = await app.inject({ method: 'POST', url: '/api/import', payload: parts.join(''),
      headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': `multipart/form-data; boundary=${b}` } });
    return { status: res.statusCode, body: res.json() };
  };
  // envia arquivos (multipart) para qualquer rota
  const files = async (role, url, list, fields = {}) => {
    const b = '----bb'; const chunks = [];
    for (const [k, v] of Object.entries(fields)) chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    for (const f of list) {
      chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: ${f.type || 'application/octet-stream'}\r\n\r\n`), Buffer.from(f.data), Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${b}--\r\n`));
    const res = await app.inject({ method: 'POST', url, payload: Buffer.concat(chunks), headers: { authorization: `Bearer ${tokens[role]}`, 'content-type': `multipart/form-data; boundary=${b}` } });
    return { status: res.statusCode, body: res.json() };
  };
  return { pool, app, tokens, call, upload, files, close: async () => { await app.close(); await pool.end(); } };
}
