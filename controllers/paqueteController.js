// controllers/paqueteController.js
import { pool } from '../config/db.js';
import { listPaquetes, getPaqueteByCodigo } from '../models/Paquete.js';

/**
 * Página principal con lista de paquetes
 */
export async function home(req, res) {
  try {
    const paquetes = await listPaquetes();
    res.render('index', {
      title: 'Explorar paquetes',
      paquetes,
      error: null,
    });
  } catch (e) {
    res.render('index', {
      title: 'Explorar paquetes',
      paquetes: [],
      error: e.message || 'No se pudo cargar los paquetes',
    });
  }
}

/**
 * Detalle de un paquete específico
 */
export async function detalle(req, res) {
  try {
    const paquete = await getPaqueteByCodigo(req.params.codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const precioAdulto = Number(paquete.precio_adulto);
    const precioNino   = Number(paquete.precio_nino);

    // --- NUEVO: calcula la fecha mínima (hoy) respetando zona horaria local ---
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const minDate = today.toISOString().slice(0, 10);

    res.render('detalle', {
      title: paquete.titulo || 'Detalle del paquete',
      paquete: {
        codigo: paquete.codigo,
        titulo: paquete.titulo,
        descripcion: paquete.descripcion,
        imagen: paquete.imagen || 'noimg.jpg',
        stock: paquete.stock,
        precioAdulto,
        precioNino,
      },
      minDate, // se usa en el <input type="date" min="<%= minDate %>" >
    });
  } catch (e) {
    res.status(500).send('Error al cargar el paquete: ' + e.message);
  }
}

/**
 * POST /reservas/:codigo/cancelar  (desde "Mis reservas")
 * - Anula factura(s) primero
 * - Luego llama a cancelar_reserva (repone cupos)
 * - Todo en una transacción
 */
export async function cancelarMiReserva(req, res) {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const codigo = req.params.codigo;

    await client.query('BEGIN');

    // Trae la reserva del usuario y bloquéala
    const rRes = await client.query(
      `SELECT r.id, r.fecha_viaje, p.titulo, r.usuario_id
         FROM reservas r
         JOIN paquetes p ON p.id = r.paquete_id
        WHERE r.codigo_reserva = $1 AND r.usuario_id = $2
        FOR UPDATE`,
      [codigo, userId]
    );
    const r = rRes.rows[0];
    if (!r) {
      await client.query('ROLLBACK');
      return res.status(404).send('Reserva no encontrada.');
    }

    // Validar ventana de 8 horas (como ya tenías)
    const ahora = new Date();
    const inicio = new Date(r.fecha_viaje);
    const diffMs = inicio.getTime() - ahora.getTime();
    const ochoHorasMs = 8 * 60 * 60 * 1000;
    if (diffMs < ochoHorasMs) {
      await client.query('ROLLBACK');
      return res.status(400).send('La reserva solo se puede cancelar con 8 horas de antelación.');
    }

    // 1) Anula facturas emitidas ligadas a esa reserva
    await client.query(
      `UPDATE facturas
          SET estado='ANULADA'
        WHERE reserva_id = $1 AND estado='EMITIDA'`,
      [r.id]
    );

    // 2) Cancela la reserva (repone cupos)
    await client.query('SELECT cancelar_reserva($1)', [codigo]);

    await client.query('COMMIT');
    return res.redirect('/mis-reservas');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(e);
    res.status(500).send('No se pudo cancelar: ' + e.message);
  } finally {
    client.release();
  }
}
