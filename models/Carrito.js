// models/Carrito.js
import { pool } from '../config/db.js';

export async function addOrUpdateItem({ usuarioId, paqueteId, fecha, adultos, ninos, totalLinea }) {
  const sql = `
    INSERT INTO carrito (usuario_id, paquete_id, fecha, adultos, ninos, total_linea)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (usuario_id, paquete_id, fecha)
    DO UPDATE SET adultos = EXCLUDED.adultos,
                  ninos   = EXCLUDED.ninos,
                  total_linea = EXCLUDED.total_linea
    RETURNING *;
  `;
  const { rows } = await pool.query(sql, [usuarioId, paqueteId, fecha, adultos, ninos, totalLinea]);
  return rows[0];
}

export async function listCartByUser(usuarioId) {
  const sql = `
    SELECT c.*, 
           p.codigo, p.titulo, p.imagen,
           p.precio_adulto, p.precio_nino
    FROM carrito c
    JOIN paquetes p ON p.id = c.paquete_id
    WHERE c.usuario_id = $1
    ORDER BY c.creado DESC;
  `;
  const { rows } = await pool.query(sql, [usuarioId]);
  return rows;
}

export async function removeItem(usuarioId, itemId) {
  await pool.query(`DELETE FROM carrito WHERE id = $1 AND usuario_id = $2`, [itemId, usuarioId]);
}

export async function clearCart(usuarioId) {
  await pool.query(`DELETE FROM carrito WHERE usuario_id = $1`, [usuarioId]);
}

export async function updateItem(usuarioId, itemId, { adultos, ninos, totalLinea }) {
  const sql = `
    UPDATE carrito
       SET adultos = $3,
           ninos   = $4,
           total_linea = $5
     WHERE id = $1
       AND usuario_id = $2
   RETURNING *;
  `;
  const { rows } = await pool.query(sql, [itemId, usuarioId, adultos, ninos, totalLinea]);
  return rows[0];
}
