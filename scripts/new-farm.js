// Cria a configuração de uma fazenda nova a partir do modelo.
// Uso: npm run new-farm -- <slug> "Nome da Fazenda" --owner-email dono@x.com [--owner-name "Nome"] [--domain x.com.br]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : null; };
const ownerEmail = opt('owner-email'); const ownerName = opt('owner-name') || 'Dono da Fazenda'; const domain = opt('domain');
const [slug, name] = args;
if (!slug || !name || !ownerEmail) {
  console.error('Uso: npm run new-farm -- <slug> "Nome da Fazenda" --owner-email dono@x.com [--owner-name "Nome"] [--domain x.com.br]');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]{2,30}$/.test(slug)) { console.error('O slug deve ter letras minúsculas, números e hífen (ex.: sao-jose).'); process.exit(1); }
const dir = path.join(ROOT, 'farms', slug);
if (fs.existsSync(dir)) { console.error(`Já existe farms/${slug}.`); process.exit(1); }

const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'farms/_template/farm.config.json'), 'utf8'));
tpl.slug = slug; tpl.name = name; tpl.domain = domain || `${slug}.seudominio.com.br`;
tpl.initialUsers = [
  { name: ownerName, email: ownerEmail, role: 'dono' },
  ...tpl.initialUsers.filter((u) => u.role === 'veterinaria' && !u.email.endsWith('@exemplo.com.br')),
];
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'farm.config.json'), JSON.stringify(tpl, null, 2) + '\n');
fs.copyFileSync(path.join(ROOT, 'farms/_template/logo.svg'), path.join(dir, 'logo.svg'));
console.log(`Fazenda criada em farms/${slug}/\n`);
console.log('Próximos passos:');
console.log(`  1. Troque farms/${slug}/logo.svg pelo logotipo da fazenda (SVG ou PNG; ajuste "logo" no farm.config.json).`);
console.log(`  2. Adicione a veterinária em "initialUsers" se ela for atender esta fazenda.`);
console.log(`  3. Crie o banco e rode:  FARM=${slug} DATABASE_URL=<banco desta fazenda> npm run seed`);
console.log(`  4. Suba o sistema:       FARM=${slug} DATABASE_URL=<banco desta fazenda> npm start`);
