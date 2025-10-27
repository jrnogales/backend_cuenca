// routes/debug.js
import express from 'express';
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';

const router = express.Router();

function day(x) {
  return String(x).slice(0, 10);
}

// Consulta directa a la tabla disponibilidad (sin depender del cartController)
async function getDisponibilidadDia(paqueteId, fecha) {
  const f = day(fecha);
  console.log('🔎 [/debug] getDisponibilidadDia', { paqueteId, fecha: f });

  const q = `
    SELECT
      COALESCE(cupos_totales, 30)::int        AS totales,
      COALESCE(cupos_reservados, 0)::int      AS reservados,
      (COALESCE(cupos_totales, 30)::int - COALESCE(cupos_reservados, 0)::int) AS restantes
    FROM disponibilidad
    WHERE paquete_id = $1
      AND fecha = $2::date
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [paqueteId, f]);
  if (!rows.length) {
    console.log('ℹ️ [/debug] sin fila en disponibilidad; asumo 30/0');
    return { totales: 30, reservados: 0, restantes: 30 };
  }
  return rows[0];
}

// Ping simple para verificar que llegan peticiones y ver logs
router.get('/debug/ping', (req, res) => {
  console.log('🟢 /debug/ping recibido');
  res.json({ ok: true, now: new Date().toISOString() });
});

/**
 * GET /debug/disp?codigo=CUEN-GEMAS&fecha=2025-10-28
 * Devuelve disponibilidad que ve el servidor para ese paquete/fecha.
 * No requiere login. NO usa datos del carrito.
 */
router.get('/debug/disp', async (req, res) => {
  try {
    const { codigo, fecha } = req.query;
    if (!codigo || !fecha) {
      return res.status(400).json({
        ok: false,
        message: 'Faltan query params: codigo y fecha (YYYY-MM-DD)',
      });
    }

    const p = await getPaqueteByCodigo(codigo);
    if (!p) return res.status(404).json({ ok: false, message: 'Paquete no encontrado' });

    const disp = await getDisponibilidadDia(p.id, fecha);

    // Trae filas crudas para verificar
    const raw = await pool.query(
      `SELECT id, paquete_id, fecha, cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id = $1 AND fecha = $2::date`,
      [p.id, fecha]
    );

    res.json({
      ok: true,
      input: { codigo, fecha: day(fecha) },
      paquete: { id: p.id, codigo: p.codigo, titulo: p.titulo },
      disponibilidad: disp,
      filas_en_bd: raw.rows,
    });
  } catch (e) {
    console.error('❌ [/debug/disp] error', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

export default router;
