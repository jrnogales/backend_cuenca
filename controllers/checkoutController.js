// controllers/checkoutController.js
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';

/**
 * Muestra la vista de checkout de un paquete.
 * Si aún no tienes una vista checkout.ejs, reutilizamos detalle.ejs para elegir fecha/cantidades.
 */
export async function showCheckout(req, res) {
  try {
    const { codigo } = req.params;
    const paquete = await getPaqueteByCodigo(codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const precioAdulto = Number(paquete.precio_adulto);
    const precioNino = Number(paquete.precio_nino);
    const today = new Date().toISOString().slice(0, 10);

    // Reutilizamos la vista "detalle" para seleccionar fecha/adultos/niños
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
      minDate: today
    });
  } catch (err) {
    return res.status(500).send('Error al cargar checkout: ' + err.message);
  }
}

/**
 * Crea la reserva desde el formulario (o AJAX)
 * Requiere: body { codigo, fecha, adultos, ninos }
 */
export async function crearReserva(req, res) {
  try {
    const { codigo, fecha, adultos, ninos } = req.body;

    const paquete = await getPaqueteByCodigo(codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const ad = parseInt(adultos ?? 0, 10);
    const ni = parseInt(ninos ?? 0, 10);
    if (!fecha) return res.status(400).send('Falta la fecha del viaje');
    if (isNaN(ad) || ad < 1) return res.status(400).send('Debe haber al menos 1 adulto');
    if (isNaN(ni) || ni < 0) return res.status(400).send('Cantidad de niños inválida');

    // Calcula total
    const total =
      ad * Number(paquete.precio_adulto) +
      ni * Number(paquete.precio_nino);

    // Código de reserva simple (puedes cambiarlo por una función/UUID)
    const code =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    // Usuario (si tienes auth)
    const usuarioId = req.user?.id ?? null;

    // Inserta la reserva
    const insert = `
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'WEB')
      RETURNING codigo_reserva
    `;
    const vals = [
      code, paquete.id, usuarioId, fecha, ad, ni, total
    ];
    const { rows } = await pool.query(insert, vals);

    // Descuenta stock
    await pool.query(
      'UPDATE paquetes SET stock = stock - $1 WHERE id = $2',
      [ad + ni, paquete.id]
    );

    // Renderiza comprobante
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
    return res.status(500).send('No se pudo crear la reserva: ' + err.message);
  }
}
