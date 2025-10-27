// routes/api.js
import express from 'express';
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';

const router = express.Router();

router.get('/disponibilidad/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { fecha } = req.query;

    if (!fecha) {
      return res.status(400).json({ ok: false, error: 'Falta ?fecha=YYYY-MM-DD' });
    }

    const paquete = await getPaqueteByCodigo(codigo);
    if (!paquete) {
      return res.status(404).json({ ok: false, error: 'Paquete no encontrado' });
    }

    const q = `
      SELECT
        COALESCE(cupos_totales, 30)::int   AS totales,
        COALESCE(cupos_reservados, 0)::int AS reservados,
        (COALESCE(cupos_totales, 30)::int - COALESCE(cupos_reservados, 0)::int) AS restantes
      FROM disponibilidad
      WHERE paquete_id = $1 AND fecha = $2::date
      LIMIT 1
    `;
    const { rows } = await pool.query(q, [paquete.id, fecha]);

    const base = rows[0] ?? { totales: 30, reservados: 0, restantes: 30 };

    return res.json({
      ok: true,
      codigo,
      fecha: String(fecha).slice(0, 10),
      ...base,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
