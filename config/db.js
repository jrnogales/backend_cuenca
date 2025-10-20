// config/db.js
import pkg from 'pg';
const { Pool } = pkg;

// Activa SSL cuando DB_SSL=true (Render/Producción)
const useSSL = (process.env.DB_SSL || '').toLowerCase() === 'true';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false
});

export default pool;
