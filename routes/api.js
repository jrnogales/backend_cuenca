import express from 'express';
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';

const api = express.Router();

api.get('/api/disponibilidad', async (req, res) => {
  try {
    const { codigo, fecha } = req.query;
    if (!codigo || !fecha) return res.status(400).json({ restantes: 0 });

    const p = await getPaqueteByCodigo(codigo);
    if (!p) return res.json({ restantes: 0 });

    const q = `SELECT vendidos, capacidad FROM disponibilidad_paquete WHERE paquete_id=$1 AND fecha=$2`;
    const { rows } = await pool.query(q, [p.id, fecha]);
    if (!rows.length) return res.json({ restantes: 30 });

    const { vendidos, capacidad } = rows[0];
    return res.json({ restantes: Number(capacidad) - Number(vendidos) });
  } catch {
    return res.json({ restantes: 0 });
  }
});

export default api;
