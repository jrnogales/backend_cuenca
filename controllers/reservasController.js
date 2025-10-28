import { pool } from '../config/db.js';

// controllers/reservasController.js (o donde tengas listMine)
export async function listMine(req, res) {
  try {
    const userId = req.user.id;
    const sql = `
      SELECT r.codigo_reserva, r.fecha_viaje, r.adultos, r.ninos, r.total_usd,
             r.creado_en, r.estado,           -- 👈 añade estado
             p.titulo, p.imagen
      FROM reservas r
      JOIN paquetes p ON p.id = r.paquete_id
      WHERE r.usuario_id = $1
      ORDER BY r.creado_en DESC
    `;
    const { rows } = await pool.query(sql, [userId]);
    res.render('mis-reservas', { title: 'Mis reservas', reservas: rows });
  } catch (e) {
    res.status(500).send('No se pudo cargar tus reservas: ' + e.message);
  }
}


// POST /reservas/:codigo/cancelar
export async function cancelarMiReserva(req, res) {
  try {
    const userId = req.user.id;
    const codigo = req.params.codigo;

    const { rows } = await pool.query(
      `SELECT r.*, p.titulo
         FROM reservas r
         JOIN paquetes p ON p.id = r.paquete_id
        WHERE r.codigo_reserva = $1 AND r.usuario_id = $2
        LIMIT 1`,
      [codigo, userId]
    );
    const r = rows[0];
    if (!r) return res.status(404).send('Reserva no encontrada.');

    // Validar ventana de 8 horas
    const ahora = new Date();
    const inicio = new Date(r.fecha_viaje); // yyyy-mm-dd
    // asumimos 00:00 local; si manejas horas exactas, guarda datetime
    const diffMs = inicio.getTime() - ahora.getTime();
    const ochoHorasMs = 8 * 60 * 60 * 1000;

    if (diffMs < ochoHorasMs) {
      return res.status(400).send('La reserva solo se puede cancelar con 8 horas de antelación.');
    }

    // Llama a tu función SQL que repone stock y elimina
    await pool.query('SELECT cancelar_reserva($1)', [codigo]);

    return res.redirect('/mis-reservas');
  } catch (e) {
    res.status(500).send('No se pudo cancelar: ' + e.message);
  }
}
