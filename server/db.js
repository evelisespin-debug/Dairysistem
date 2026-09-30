import pg from 'pg';
import { config } from './config.js';

// DATE vem como texto 'YYYY-MM-DD' (evita problemas de fuso) e NUMERIC como número.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(url = config.databaseUrl) {
  return new pg.Pool({ connectionString: url, max: 10 });
}
