import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROLES = ['dono', 'encarregado', 'funcionario', 'veterinaria'];

// A fazenda é escolhida por variável de ambiente (FARM=mariana) ou caminho direto (FARM_CONFIG).
// Nada de nome de fazenda fica escrito no código: tudo vem de farms/<slug>/farm.config.json.
export function loadFarmConfig(env = process.env) {
  const file = env.FARM_CONFIG
    ? path.resolve(env.FARM_CONFIG)
    : path.join(ROOT, 'farms', env.FARM || 'mariana', 'farm.config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.dir = path.dirname(file);
  for (const k of ['slug', 'name']) if (!cfg[k]) throw new Error(`farm.config.json: falta "${k}"`);
  cfg.timezone ||= 'America/Sao_Paulo';
  cfg.modules = { quality: true, animals: true, ...(cfg.modules || {}) };
  cfg.initialUsers ||= [];
  for (const u of cfg.initialUsers) {
    if (!u.email || !u.name || !ROLES.includes(u.role)) {
      throw new Error(`farm.config.json: usuário inválido ${JSON.stringify(u)} (perfis: ${ROLES.join(', ')})`);
    }
  }
  return cfg;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://dairy:dairy_dev@localhost:5432/dairy_mariana',
};
export { ROLES };
