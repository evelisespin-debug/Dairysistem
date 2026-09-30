import { config, loadFarmConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { buildApp } from './app.js';

const farm = loadFarmConfig();
const pool = createPool();
const applied = await migrate(pool);           // banco sempre atualizado ao iniciar
if (applied.length) console.log('Migrações aplicadas:', applied.join(', '));
await seed(pool, farm);
const app = await buildApp({ pool, farm, logger: { level: 'info' } });
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`${farm.name} no ar na porta ${config.port}`);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await app.close(); await pool.end(); process.exit(0); });
