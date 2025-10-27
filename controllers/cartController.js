// controllers/cartController.js
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';
import {
  addOrUpdateItem,
  listCartByUser,
  removeItem,
  clearCart,
  updateItem
} from '../models/Carrito.js';

/** Util: calcula totales con IVA 15% */
function calcTotals(items) {
  const subtotal = items.reduce((acc, it) => acc + Number(it.total_linea || 0), 0);
  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), iva, total };
}

export async function showCart(req, res) {
  const items = await listCartByUser(req.user.id);
  const totals = calcTotals(items);
  res.render('cart', { title: 'Mi carrito', items, totals });
}

/** POST /cart/add  {codigo, fecha, adultos, ninos} */
export async function addToCart(req, res) {
  try {
    const { codigo, fecha, adultos, ninos } = req.body;

    // Validaciones básicas
    const ad = Math.max(1, parseInt(adultos ?? 1, 10));
    const ni = Math.max(0, parseInt(ninos ?? 0, 10));
    if (!codigo || !fecha) return res.status(400).send('Faltan datos.');

    const p = await getPaqueteByCodigo(codigo);
    if (!p) return res.status(404).send('Paquete no encontrado');

    // Recalculamos total de la línea
    const totalLinea = ad * Number(p.precio_adulto || 0) + ni * Number(p.precio_nino || 0);

    // Persistimos (uno por fecha)
    await addOrUpdateItem({
      usuarioId: req.user.id,
      paqueteId: p.id,
      fecha,
      adultos: ad,
      ninos: ni,
      totalLinea
    });

    // Respondemos JSON para que UI actualice
    const items = await listCartByUser(req.user.id);
    const totals = calcTotals(items);
    res.json({ ok: true, items, totals });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

/** POST /cart/update  {itemId, adultos, ninos} */
export async function updateCartItem(req, res) {
  try {
    const { itemId, adultos, ninos } = req.body;

    // Traemos el ítem con paquete para recalcular precio
    const all = await listCartByUser(req.user.id);
    const it = all.find(r => String(r.id) === String(itemId));
    if (!it) return res.status(404).send('Ítem no encontrado');

    const ad = Math.max(1, parseInt(adultos ?? it.adultos, 10));
    const ni = Math.max(0, parseInt(ninos ?? it.ninos, 10));

    const totalLinea = ad * Number(it.precio_adulto || 0) + ni * Number(it.precio_nino || 0);

    await updateItem(req.user.id, itemId, { adultos: ad, ninos: ni, totalLinea });

    const items = await listCartByUser(req.user.id);
    const totals = calcTotals(items);
    res.json({ ok: true, items, totals });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

/** POST /cart/remove/:id */
export async function removeFromCart(req, res) {
  try {
    await removeItem(req.user.id, req.params.id);
    const items = await listCartByUser(req.user.id);
    const totals = calcTotals(items);
    res.json({ ok: true, items, totals });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}

/**
 * POST /cart/checkout – compra TODO el carrito
 * Usa la tabla disponibilidad(paquete_id, fecha, cupos_totales, cupos_reservados)
 */
export async function checkoutCart(req, res) {
  const client = await pool.connect();
  try {
    const usuarioId = req.user.id;
    const items = await listCartByUser(usuarioId);
    if (!items.length) return res.status(400).send('Carrito vacío');

    await client.query('BEGIN');

    // Suma para mostrar comprobante
    let totalLote = 0;

    for (const it of items) {
      const { paquete_id, fecha, adultos, ninos } = it;

      // 1) Bloquea/lee disponibilidad de ese día
      const dispQ = `
        SELECT id, cupos_totales, cupos_reservados
        FROM disponibilidad
        WHERE paquete_id = $1 AND fecha = $2
        FOR UPDATE
      `;
      const dispRes = await client.query(dispQ, [paquete_id, fecha]);

      let dispId = null;
      let cuposTotales = 30;
      let cuposReservados = 0;

      if (dispRes.rowCount) {
        dispId = dispRes.rows[0].id;
        cuposTotales = Number(dispRes.rows[0].cupos_totales || 30);
        cuposReservados = Number(dispRes.rows[0].cupos_reservados || 0);
      } else {
        // Si no existe fila para ese día, crea base 30
        const ins = await client.query(
          `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
           VALUES ($1,$2,30,0) RETURNING id`,
          [paquete_id, fecha]
        );
        dispId = ins.rows[0].id;
      }

      const solicitados = Number(adultos) + Number(ninos);
      if (cuposReservados + solicitados > cuposTotales) {
        throw new Error(`Sin cupos para ${it.titulo} el ${fecha}.`);
      }

      // 2) Calcula total real con precios vigentes
      const pRes = await client.query('SELECT * FROM paquetes WHERE id=$1', [paquete_id]);
      const p = pRes.rows[0];
      const total = (Number(adultos) * Number(p.precio_adulto || 0)) +
                    (Number(ninos)   * Number(p.precio_nino   || 0));
      totalLote += total;

      const bookingId =
        'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
        '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

      // 3) Inserta reserva
      await client.query(
        `INSERT INTO reservas
          (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CART')`,
        [bookingId, paquete_id, usuarioId, fecha, adultos, ninos, total]
      );

      // 4) Actualiza cupos_reservados
      await client.query(
        `UPDATE disponibilidad
           SET cupos_reservados = cupos_reservados + $2
         WHERE id = $1`,
        [dispId, solicitados]
      );
    }

    // 5) Vacía carrito del usuario
    await client.query(`DELETE FROM carrito WHERE usuario_id=$1`, [usuarioId]);

    await client.query('COMMIT');

    // IVA 15% para mostrar
    const iva = +(totalLote * 0.15).toFixed(2);
    const totalConIva = +(totalLote + iva).toFixed(2);

    res.render('comprobante', {
      title: 'Compra confirmada',
      codigo: 'LOTE-' + Date.now().toString(36).toUpperCase(),
      paquete: { titulo: 'Múltiples paquetes (carrito)' },
      fecha: new Date().toISOString().slice(0, 10),
      adultos: 0,
      ninos: 0,
      total: totalConIva
    });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(400).send('No se pudo completar el checkout: ' + e.message);
  } finally {
    client.release();
  }
}
