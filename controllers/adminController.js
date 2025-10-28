import { pool } from '../config/db.js';

export async function dashboard(req, res) {
  res.render('admin/dashboard', { title: 'Panel de administración' });
}

export async function listReservas(req, res) {
  const q = `
    SELECT r.*, p.titulo AS paquete_titulo, u.nombre AS usuario_nombre, u.email AS usuario_email
    FROM reservas r
    LEFT JOIN paquetes p ON p.id = r.paquete_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    ORDER BY r.creado_en DESC NULLS LAST
  `;
  const { rows } = await pool.query(q);
  res.render('admin/reservas', { title: 'Reservas', reservas: rows });
}

export async function listFacturas(req, res) {
  const q = `
    SELECT f.*, r.codigo_reserva
    FROM facturas f
    LEFT JOIN reservas r ON r.id = f.reserva_id
    ORDER BY f.fecha_emision DESC
  `;
  const { rows } = await pool.query(q);
  res.render('admin/facturas', { title: 'Facturas', facturas: rows });
}
