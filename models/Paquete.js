// models/Paquete.js
import { pool } from '../config/db.js';

export async function listPaquetes() {
  const q = `
    SELECT id, codigo, titulo, descripcion, imagen,
           precio_adulto, precio_nino, stock
    FROM paquetes
    ORDER BY creado_en DESC, id DESC
  `;
  const { rows } = await pool.query(q);
  return rows;
}

export async function getPaqueteByCodigo(codigo) {
  const { rows } = await pool.query(
    `SELECT id, codigo, titulo, descripcion, imagen,
            precio_adulto, precio_nino, stock
     FROM paquetes
     WHERE codigo = $1
     LIMIT 1`,
    [codigo]
  );
  return rows[0];
}
