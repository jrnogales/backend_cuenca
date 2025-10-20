import { pool } from '../config/db.js'; import bcrypt from 'bcryptjs';
export async function createUser({nombre,email,telefono,password}){ const hash = await bcrypt.hash(password,10);
  const { rows } = await pool.query(`INSERT INTO usuarios (nombre,email,telefono,password_hash) VALUES ($1,$2,$3,$4) RETURNING id,nombre,email,telefono`, [nombre,email,telefono,hash]); return rows[0]; }
export async function findUserByEmail(email){ const { rows } = await pool.query('SELECT * FROM usuarios WHERE email=$1',[email]); return rows[0]; }
