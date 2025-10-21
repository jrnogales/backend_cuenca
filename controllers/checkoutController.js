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

    // Fecha mínima (hoy) en formato YYYY-MM-DD
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const minDate = today.toISOString().slice(0, 10);

    // Renderiza vista detalle.ejs reutilizada para el checkout
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
 * Valida: fecha no pasada, adultos >= 1, niños >= 0
 */
export async function crearReserva(req, res) {
  try {
    const { codigo, fecha, adultos, ninos } = req.body;

    // --- Validación básica ---
    if (!fecha) return res.status(400).send('Falta la fecha del viaje');

    // Validación: no permitir fechas pasadas
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

    if (isNaN(ad) || ad < 1)
      return res.status(400).send('Debe haber al menos 1 adulto');
    if (isNaN(ni) || ni < 0)
      return res.status(400).send('Cantidad de niños inválida');

    // --- Cálculo total ---
    const total =
      ad * Number(paquete.precio_adulto) +
      ni * Number(paquete.precio_nino);

    // Código de reserva único
    const code =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    const usuarioId = req.user?.id ?? null;

    // --- Inserta reserva ---
    const insert = `
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'WEB')
      RETURNING codigo_reserva
    `;
    const vals = [code, paquete.id, usuarioId, fecha, ad, ni, total];
    const { rows } = await pool.query(insert, vals);

    // --- Actualiza stock ---
    await pool.query(
      'UPDATE paquetes SET stock = stock - $1 WHERE id = $2',
      [ad + ni, paquete.id]
    );

    // --- Renderiza comprobante ---
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
