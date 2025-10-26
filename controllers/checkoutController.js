// controllers/checkoutController.js
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';

/** Muestra detalle/checkout (igual que antes) */
export async function showCheckout(req, res) {
  try {
    const { codigo } = req.params;
    const paquete = await getPaqueteByCodigo(codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const precioAdulto = Number(paquete.precio_adulto);
    const precioNino   = Number(paquete.precio_nino);

    // Fecha mínima local (hoy)
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const minDate = today.toISOString().slice(0, 10);

    return res.render('detalle', {
      title: paquete.titulo || 'Detalle del paquete',
      paquete: {
        id: paquete.id,
        codigo: paquete.codigo,
        titulo: paquete.titulo,
        descripcion: paquete.descripcion,
        imagen: paquete.imagen || 'noimg.jpg',
        stock: paquete.stock, // solo informativo
        precioAdulto,
        precioNino
      },
      minDate
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error al cargar checkout: ' + err.message);
  }
}

/** Crea reserva descontando cupos por FECHA (disponibilidad) */
export async function crearReserva(req, res) {
  const client = await pool.connect();
  try {
    const { codigo, fecha, adultos, ninos } = req.body;

    // Validaciones básicas
    if (!fecha) return res.status(400).send('Falta la fecha del viaje');

    const today = new Date(); today.setHours(0,0,0,0);
    const chosen = new Date(fecha); chosen.setHours(0,0,0,0);
    if (isNaN(chosen.getTime())) return res.status(400).send('Fecha inválida');
    if (chosen < today) return res.status(400).send('No puedes seleccionar una fecha pasada');

    const paquete = await getPaqueteByCodigo(codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const ad = parseInt(adultos ?? 0, 10);
    const ni = parseInt(ninos ?? 0, 10);
    if (isNaN(ad) || ad < 1) return res.status(400).send('Debe haber al menos 1 adulto');
    if (isNaN(ni) || ni < 0) return res.status(400).send('Cantidad de niños inválida');

    const solicitados = ad + ni;

    // Transacción
    await client.query('BEGIN');

    // Asegura fila de disponibilidad (upsert)
    await client.query(
      `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES ($1, $2, COALESCE($3,30), 0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING`,
      [paquete.id, fecha, 30]
    );

    // Bloquea fila para leer/modificar con seguridad
    const { rows: dispRows } = await client.query(
      `SELECT id, cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id = $1 AND fecha = $2
        FOR UPDATE`,
      [paquete.id, fecha]
    );
    if (dispRows.length === 0) {
      throw new Error('No fue posible inicializar disponibilidad para esa fecha.');
    }

    const disp = dispRows[0];
    const disponibles = Number(disp.cupos_totales) - Number(disp.cupos_reservados);
    if (disponibles < solicitados) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .send(`Solo quedan ${disponibles} cupos disponibles para esa fecha.`);
    }

    // Calcula total
    const total =
      ad * Number(paquete.precio_adulto) +
      ni * Number(paquete.precio_nino);

    // Código de reserva
    const code =
      'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
      '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

    const usuarioId = req.user?.id ?? null;

    // Inserta reserva
    const insert = `
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,'WEB')
      RETURNING codigo_reserva`;
    const vals = [code, paquete.id, usuarioId, fecha, ad, ni, total];
    const { rows: resRows } = await client.query(insert, vals);

    // Incrementa reservados en disponibilidad
    await client.query(
      `UPDATE disponibilidad
          SET cupos_reservados = cupos_reservados + $1
        WHERE paquete_id = $2 AND fecha = $3`,
      [solicitados, paquete.id, fecha]
    );

    await client.query('COMMIT');

    // Comprobante
    return res.render('comprobante', {
      title: 'Reserva confirmada',
      codigo: resRows[0].codigo_reserva,
      paquete,
      fecha,
      adultos: ad,
      ninos: ni,
      total
    });
  } catch (err) {
    console.error(err);
    try { await client.query('ROLLBACK'); } catch {}
    return res.status(500).send('No se pudo crear la reserva: ' + err.message);
  } finally {
    client.release();
  }
}

/** Cancela una reserva (usa función SQL que libera cupos por fecha) */
export async function cancelarReserva(req, res) {
  try {
    const { codigo } = req.params;
    if (!codigo) return res.status(400).send('Falta el código de reserva.');
    await pool.query('SELECT cancelar_reserva($1)', [codigo]);

    return res.render('comprobante-cancelado', {
      title: 'Reserva cancelada',
      codigo,
      mensaje: 'Tu reserva fue cancelada y los cupos fueron liberados.'
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error al cancelar la reserva: ' + err.message);
  }
}
