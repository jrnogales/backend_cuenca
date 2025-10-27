// routes/debug.js
import express from 'express';
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';
import { getDisponibilidadDia } from '../controllers/cartController.js';

const router = express.Router();

// Ping simple para comprobar que llegan las peticiones y ver logs
router.get('/debug/ping', (req, res) => {
  console.log('🟢 /debug/ping recibido');
  res.json({ ok: true, now: new Date().toISOString() });
});

/**
 * GET /debug/disp?codigo=CUEN-GEMAS&fecha=2025-10-28
 * Devuelve la disponibilidad (totales/reservados/restantes) que ve el servidor.
 * No requiere login y NO usa datos del carrito.
 */
router.get('/debug/disp', async (req, res) => {
  try {
    const { codigo, fecha } = req.query;
    if (!codigo || !fecha) {
      return res.status(400).json({ ok: false, message: 'Faltan query params: codigo y fecha (YYYY-MM-DD)' });
    }

    const p = await getPaqueteByCodigo(codigo);
    if (!p) return res.status(404).json({ ok: false, message: 'Paquete no encontrado' });

    const disp = await getDisponibilidadDia(p.id, fecha);

    // Además, listamos filas crudas que existan ese día para confirmar
    const raw = await pool.query(
      `SELECT id, paquete_id, fecha, cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id=$1 AND fecha=$2::date`,
      [p.id, fecha]
    );

    res.json({
      ok: true,
      input: { codigo, fecha },
      paquete: { id: p.id, titulo: p.titulo, codigo: p.codigo },
      disponibilidad: disp,
      filas_en_bd: raw.rows
    });
  } catch (e) {
    console.error('❌ [/debug/disp] error', e);
    res.status(500).json({ ok: false, message: e.message });
  }
});

export default router;
