// routes/api.js
import express from 'express';
import { pool } from '../config/db.js';

const router = express.Router();

/**
 * GET /api/disponibilidad/:codigo?fecha=YYYY-MM-DD
 * Devuelve { restantes } (base 30 si no hay fila en disponibilidad)
 */
router.get('/disponibilidad/:codigo', async (req, res) => {
  try {
    const { codigo } = req.params;
    const { fecha } = req.query;
    if (!codigo || !fecha) return res.status(400).json({ restantes: 0, error: 'Faltan parámetros' });

    const pRes = await pool.query('SELECT id FROM paquetes WHERE codigo=$1 LIMIT 1', [codigo]);
    const p = pRes.rows[0];
    if (!p) return res.status(404).json({ restantes: 0, error: 'Paquete no encontrado' });

    const dRes = await pool.query(
      'SELECT cupos_totales, cupos_reservados FROM disponibilidad WHERE paquete_id=$1 AND fecha=$2',
      [p.id, fecha]
    );
    let restantes = 30;
    if (dRes.rowCount) {
      const tot = Number(dRes.rows[0].cupos_totales || 30);
      const resv = Number(dRes.rows[0].cupos_reservados || 0);
      restantes = Math.max(0, tot - resv);
    }
    res.json({ restantes });
  } catch (e) {
    res.status(500).json({ restantes: 0, error: e.message });
  }
});

export default router;
