// controllers/checkoutController.js
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';

/**
 * Muestra la vista de checkout (detalle del paquete)
 */
export async function showCheckout(req, res) {
  try {
    const { codigo } = req.params;
    const paquete = await getPaqueteByCodigo(codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const precioAdulto = Number(paquete.precio_adulto);
    const precioNino = Number(paquete.precio_nino);

    // Fecha mínima (hoy)
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
        stock: paquete.stock,
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

/**
 * Crea la reserva desde el formulario
 * Valida: fecha válida, adultos >=1, niños >=0, stock suficiente
 */
export async function crearReserva(req, res) {
  try {
    const { codigo, fecha, adultos, ninos } = req.body;

    if (!fecha) return res.status(400).send('Falta la fecha del viaje');

    // Validar que la fecha no sea pasada
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const chosen = new Date(fecha);
    chosen.setHours(0, 0, 0, 0);

    if (isNaN(chosen.getTime())) {
      return res.status(400).send('Fecha inválida');
    }
    if (chosen < today) {
      return res.status(400).send('No puedes seleccionar una fecha pasada');
    }

    const paquete = await getPaqueteByCodigo(codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const ad = parseInt(adultos ?? 0, 10);
    const ni = parseInt(ninos ?? 0, 10);
    const totalSolicitado = ad + ni;

    if (isNaN(ad) || ad < 1)
      return res.status(400).send('Debe haber al menos 1 adulto');
    if (isNaN(ni) || ni < 0)
      return res.status(400).send('Cantidad de niños inválida');

    if (paquete.stock < totalSolicitado) {
      return res.status(400).send(
        `Solo quedan ${paquete.stock} cupos disponibles para este tour.`
      );
    }

    const total =
      ad * Number(paquete.precio_adulto) +
      ni * Number(paquete.precio_nino);

    const code =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const usuarioId = req.user?.id ?? null;

    const insert = `
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'WEB')
      RETURNING codigo_reserva
    `;
    const vals = [code, paquete.id, usuarioId, fecha, ad, ni, total];
    const { rows } = await pool.query(insert, vals);

    await pool.query(
      'UPDATE paquetes SET stock = stock - $1 WHERE id = $2',
      [totalSolicitado, paquete.id]
    );

    return res.render('comprobante', {
      title: 'Reserva confirmada',
      codigo: rows[0].codigo_reserva,
      paquete,
      fecha,
      adultos: ad,
      ninos: ni,
      total
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send('No se pudo crear la reserva: ' + err.message);
  }
}

/**
 * Cancela una reserva existente y repone el stock.
 */
export async function cancelarReserva(req, res) {
  try {
    const { codigo } = req.params;
    if (!codigo)
      return res.status(400).send('Falta el código de la reserva.');

    // Ejecuta la función SQL que repone el stock y elimina la reserva
    const result = await pool.query('SELECT cancelar_reserva($1)', [codigo]);

    // Mensaje devuelto por la función SQL
    const mensaje = result.rows[0]?.cancelar_reserva || 
                    'La reserva fue cancelada correctamente.';

    // Renderizar página de confirmación
    return res.render('comprobante-cancelado', {
      title: 'Reserva cancelada',
      codigo,
      mensaje
    });
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error al cancelar la reserva: ' + err.message);
  }
}
