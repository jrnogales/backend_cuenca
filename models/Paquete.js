import { pool } from '../config/db.js';
export async function listPaquetes(){ const { rows } = await pool.query('SELECT * FROM paquetes ORDER BY titulo'); return rows; }
export async function getPaqueteByCodigo(codigo){ const { rows } = await pool.query('SELECT * FROM paquetes WHERE codigo=$1',[codigo]); return rows[0]; }
