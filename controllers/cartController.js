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

/* ============== Utils ============== */
function calcTotals(items) {
  const subtotal = items.reduce((acc, it) => acc + Number(it.total_linea || 0), 0);
  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), iva, total };
}
const day = x => String(x).slice(0, 10);

/**
 * Disponibilidad REAL del día para un paquete (NO descuenta el carrito del usuario)
 * restantes = cupos_totales(30 por defecto) - cupos_reservados
 */
async function getDisponibilidadDia(paqueteId, fecha) {
  const q = `
    SELECT
      COALESCE(cupos_totales, 30)::int   AS totales,
      COALESCE(cupos_reservados, 0)::int AS reservados
    FROM disponibilidad
    WHERE paquete_id = $1 AND fecha = $2::date
    LIMIT 1
  `;
  const { rows, rowCount } = await pool.query(q, [paqueteId, fecha]);
  const totales = rowCount ? Number(rows[0].totales) : 30;
  const reservados = rowCount ? Number(rows[0].reservados) : 0;
  const restantes = Math.max(0, totales - reservados);
  return { totales, reservados, restantes };
}

/* ============== Controladores ============== */

export async function showCart(req, res) {
  const items = await listCartByUser(req.user.id);
  const totals = calcTotals(items);
  res.render('cart', { title: 'Mi carrito', items, totals });
}

/** POST /cart/add  {codigo, fecha, adultos, ninos} */
export async function addToCart(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: 'Debes iniciar sesión',
        redirect: `/login?msg=${encodeURIComponent('Debes iniciar sesión')}&next=${encodeURIComponent('/cart')}`
      });
    }

    const { codigo, fecha, adultos, ninos } = req.body;
    if (!codigo || !fecha) {
      return res.status(400).json({ ok: false, message: 'Faltan datos: código y fecha.' });
    }

    const ad = Math.max(1, parseInt(adultos ?? 1, 10));
    const ni = Math.max(0, parseInt(ninos ?? 0, 10));

    const p = await getPaqueteByCodigo(codigo);
    if (!p) return res.status(404).json({ ok: false, message: 'Paquete no encontrado' });

    // Disponibilidad real del día (no se descuenta lo del carrito)
    const { restantes } = await getDisponibilidadDia(p.id, fecha);
    const solicitados = ad + ni;

    if (solicitados > restantes) {
      return res.status(409).json({
        ok: false,
        message: `No hay cupos suficientes para ${day(fecha)}. Quedan ${restantes}.`
      });
    }

    const totalLinea = ad * Number(p.precio_adulto || 0) + ni * Number(p.precio_nino || 0);
    await addOrUpdateItem({
      usuarioId: userId,
      paqueteId: p.id,
      fecha,
      adultos: ad,
      ninos: ni,
      totalLinea
    });

    const items = await listCartByUser(userId);
    const totals = calcTotals(items);
    res.json({ ok: true, items, totals });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

/** POST /cart/update  {itemId, adultos, ninos} */
export async function updateCartItem(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: 'Debes iniciar sesión',
        redirect: `/login?msg=${encodeURIComponent('Debes iniciar sesión')}&next=${encodeURIComponent('/cart')}`
      });
    }

    const { itemId, adultos, ninos } = req.body;

    const all = await listCartByUser(userId);
    const it = all.find(r => String(r.id) === String(itemId));
    if (!it) return res.status(404).json({ ok: false, message: 'Ítem no encontrado' });

    const ad = Math.max(1, parseInt(adultos ?? it.adultos, 10));
    const ni = Math.max(0, parseInt(ninos ?? it.ninos, 10));
    const newQty = ad + ni;

    // Disponibilidad real del día (no se descuenta lo del carrito)
    const { restantes } = await getDisponibilidadDia(it.paquete_id, it.fecha);

    if (newQty > restantes) {
      return res.status(409).json({
        ok: false,
        message: `No hay cupos suficientes para ${day(it.fecha)}. Quedan ${restantes}.`
      });
    }

    const totalLinea = ad * Number(it.precio_adulto || 0) + ni * Number(it.precio_nino || 0);
    await updateItem(userId, itemId, { adultos: ad, ninos: ni, totalLinea });

    const items = await listCartByUser(userId);
    const totals = calcTotals(items);
    res.json({ ok: true, items, totals });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

/** POST /cart/remove/:id */
export async function removeFromCart(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: 'Debes iniciar sesión',
        redirect: `/login?msg=${encodeURIComponent('Debes iniciar sesión')}&next=${encodeURIComponent('/cart')}`
      });
    }

    await removeItem(userId, req.params.id);
    const items = await listCartByUser(userId);
    const totals = calcTotals(items);
    res.json({ ok: true, items, totals });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * POST /cart/checkout – procesa TODO el carrito con bloqueo de disponibilidad
 */
export async function checkoutCart(req, res) {
  const client = await pool.connect();
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      return res.status(401).json({
        ok: false,
        message: 'Debes iniciar sesión',
        redirect: `/login?msg=${encodeURIComponent('Debes iniciar sesión')}&next=${encodeURIComponent('/cart')}`
      });
    }

    const items = await listCartByUser(usuarioId);
    if (!items.length) return res.status(400).send('Carrito vacío');

    await client.query('BEGIN');
    let totalLote = 0;

    for (const it of items) {
      const { paquete_id, fecha, adultos, ninos } = it;

      // Bloqueo/lectura de disponibilidad del día
      const dispQ = `
        SELECT id, cupos_totales, cupos_reservados
        FROM disponibilidad
        WHERE paquete_id = $1 AND fecha = $2::date
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
        const ins = await client.query(
          `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
           VALUES ($1,$2,30,0)
           RETURNING id`,
          [paquete_id, fecha]
        );
        dispId = ins.rows[0].id;
      }

      const solicitados = Number(adultos) + Number(ninos);
      if (cuposReservados + solicitados > cuposTotales) {
        throw new Error(`Sin cupos para ${day(fecha)}.`);
      }

      // Total con precios vigentes
      const pRes = await client.query('SELECT * FROM paquetes WHERE id=$1', [paquete_id]);
      const p = pRes.rows[0];
      const total = (Number(adultos) * Number(p.precio_adulto || 0)) +
                    (Number(ninos)   * Number(p.precio_nino   || 0));
      totalLote += total;

      const bookingId =
        'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
        '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

      await client.query(
        `INSERT INTO reservas
           (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CART')`,
        [bookingId, paquete_id, usuarioId, fecha, adultos, ninos, total]
      );

      await client.query(
        `UPDATE disponibilidad
           SET cupos_reservados = cupos_reservados + $2
         WHERE id = $1`,
        [dispId, solicitados]
      );
    }

    await client.query(`DELETE FROM carrito WHERE usuario_id = $1`, [usuarioId]);
    await client.query('COMMIT');

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
