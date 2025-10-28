// models/Usuario.js
import { pool } from '../config/db.js';
import bcrypt from 'bcryptjs';

/**
 * Crea un usuario. Hace hash del password.
 * Campos nuevos: apellido, cedula (varchar(10))
 */
export async function createUser({ nombre, apellido, cedula, email, telefono, password }) {
  const hash = await bcrypt.hash(password, 10);
  const q = `
    INSERT INTO usuarios (nombre, apellido, cedula, email, telefono, password_hash)
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING id, nombre, apellido, cedula, email, telefono
  `;
  const vals = [
    nombre,
    apellido || null,
    cedula || null,
    email,
    telefono || null,
    hash
  ];
  const { rows } = await pool.query(q, vals);
  return rows[0];
}

/** Busca por email. Devuelve * (incluye password_hash para login) */
export async function findUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE email=$1 LIMIT 1', [email]);
  return rows[0];
}
