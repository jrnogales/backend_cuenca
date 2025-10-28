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
import { crearFactura } from '../models/Factura.js'; // ← NUEVO

/* ============== Utils ============== */
function calcTotals(items) {
  const subtotal = items.reduce((acc, it) => acc + Number(it.total_linea || 0), 0);
  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), iva, total };
}
const day = x => String(x).slice(0, 10);

/**
 * Lee disponibilidad del día para un paquete (NO considera carrito).
 * Devuelve { totales, reservados, restantes }.
 */
async function getDisponibilidadDia(paqueteId, fecha) {
  console.log('🔎 [getDisponibilidadDia] preparando query', { paqueteId, fecha: day(fecha) });

  const q = `
    SELECT
      COALESCE(cupos_totales, 30)::int        AS totales,
      COALESCE(cupos_reservados, 0)::int      AS reservados,
      (COALESCE(cupos_totales, 30)::int - COALESCE(cupos_reservados, 0)::int) AS restantes
    FROM disponibilidad
    WHERE paquete_id = $1
      AND fecha = $2::date
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [paqueteId, fecha]);

  console.log('📦 [getDisponibilidadDia] rows devueltas', rows);

  if (!rows.length) {
    console.log('ℹ️ [getDisponibilidadDia] no había fila, asumo 30/0');
    return { totales: 30, reservados: 0, restantes: 30 };
  }
  return rows[0];
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
    console.log('🧾 [addToCart] payload recibido', { codigo, fecha, adultos, ninos, userId });

    if (!codigo || !fecha) {
      return res.status(400).json({ ok: false, message: 'Faltan datos: código y fecha.' });
    }

    const ad = Math.max(1, parseInt(adultos ?? 1, 10));
    const ni = Math.max(0, parseInt(ninos ?? 0, 10));

    const p = await getPaqueteByCodigo(codigo);
    console.log('📘 [addToCart] paquete encontrado', p);

    if (!p) return res.status(404).json({ ok: false, message: 'Paquete no encontrado' });

    // Disponibilidad real (solo BD)
    console.log('🧩 [addToCart] consultando disponibilidad con', { paqueteId: p.id, fecha: day(fecha) });
    const { totales, reservados, restantes } = await getDisponibilidadDia(p.id, fecha);
    console.log('📊 [addToCart] disponibilidad', { totales, reservados, restantes });

    const solicitados = ad + ni;

    if (restantes <= 0) {
      return res.status(409).json({ ok: false, message: `No quedan cupos disponibles para ${day(fecha)}.` });
    }
    if (solicitados > restantes) {
      return res.status(409).json({
        ok: false,
        message: `No hay cupos suficientes para ${day(fecha)}. Puedes agregar como máximo ${restantes} más.`
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
    console.log('✅ [addToCart] añadido OK. Totales:', totals);

    res.json({ ok: true, items, totals });
  } catch (e) {
    console.error('❌ [addToCart] error', e);
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
    console.log('📝 [updateCartItem] payload', { itemId, adultos, ninos });

    const all = await listCartByUser(userId);
    const it = all.find(r => String(r.id) === String(itemId));
    if (!it) return res.status(404).json({ ok: false, message: 'Ítem no encontrado' });

    const ad = Math.max(1, parseInt(adultos ?? it.adultos, 10));
    const ni = Math.max(0, parseInt(ninos ?? it.ninos, 10));
    const newQty = ad + ni;
    const currentQty = Number(it.adultos || 0) + Number(it.ninos || 0);

    // Cuántos asientos hay disponibles en DB (no carrito)
    const { restantes } = await getDisponibilidadDia(it.paquete_id, it.fecha);
    // Solo necesitamos asientos adicionales si newQty > currentQty
    const delta = newQty - currentQty;

    console.log('🔧 [updateCartItem] currentQty/newQty/delta/restantes', { currentQty, newQty, delta, restantes });

    if (delta > 0 && delta > restantes) {
      return res.status(409).json({
        ok: false,
        message: `No hay cupos suficientes para ${day(it.fecha)}. Puedes aumentar como máximo ${restantes} más.`
      });
    }

    const totalLinea = ad * Number(it.precio_adulto || 0) + ni * Number(it.precio_nino || 0);
    await updateItem(userId, itemId, { adultos: ad, ninos: ni, totalLinea });

    const items = await listCartByUser(userId);
    const totals = calcTotals(items);
    console.log('✅ [updateCartItem] actualizado OK. Totales:', totals);

    res.json({ ok: true, items, totals });
  } catch (e) {
    console.error('❌ [updateCartItem] error', e);
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
    console.log('🗑️ [removeFromCart] eliminado. Totales:', totals);

    res.json({ ok: true, items, totals });
  } catch (e) {
    console.error('❌ [removeFromCart] error', e);
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

    console.log('🧾 [checkout] items', items);

    await client.query('BEGIN');
    let totalLote = 0;

    // 🔢 Acumuladores para el comprobante
    let sumAdultos = 0;
    let sumNinos = 0;
    const fechas = new Set();

    for (const it of items) {
      const { paquete_id, fecha, adultos, ninos } = it;
      console.log('🔒 [checkout] bloqueando disponibilidad', { paquete_id, fecha: day(fecha) });

      // Acumular para comprobante
      sumAdultos += Number(adultos || 0);
      sumNinos   += Number(ninos   || 0);
      fechas.add(String(fecha).slice(0,10));

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

      const pRes = await client.query('SELECT * FROM paquetes WHERE id=$1', [paquete_id]);
      const p = pRes.rows[0];
      const total = (Number(adultos) * Number(p.precio_adulto || 0)) +
                    (Number(ninos)   * Number(p.precio_nino   || 0));
      totalLote += total;

      const bookingId =
        'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
        '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

      // ⬇️ MODIFICADO: pedimos el id de la reserva para facturar
      const resReserva = await client.query(
        `INSERT INTO reservas
           (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CART')
         RETURNING id`,
        [bookingId, paquete_id, usuarioId, fecha, adultos, ninos, total]
      );
      const reservaId = resReserva.rows[0].id;

      // 🔖 FACTURA por cada reserva del carrito (MISMA transacción)
      const lineas = [];
      const titulo = p?.titulo || 'Paquete';
      if (Number(adultos) > 0) {
        lineas.push({
          descripcion: `${titulo} - Adultos`,
          cantidad: Number(adultos),
          precio_unitario: Number(p.precio_adulto || 0)
        });
      }
      if (Number(ninos) > 0) {
        lineas.push({
          descripcion: `${titulo} - Niños`,
          cantidad: Number(ninos),
          precio_unitario: Number(p.precio_nino || 0)
        });
      }
      // Por seguridad, si no hay líneas, crea 1 línea con el total
      if (lineas.length === 0) {
        lineas.push({
          descripcion: titulo,
          cantidad: 1,
          precio_unitario: Number(total || 0)
        });
      }
      await crearFactura(client, {
        reservaId,
        metodoPago: 'WEB',
        lineas
      });

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

    // 🗓️ Fecha de resumen: única fecha o “Varias fechas”
    const fechaResumen = (fechas.size === 1) ? [...fechas][0] : 'Varias fechas';

    console.log('✅ [checkout] OK total sin IVA / con IVA', { totalLote, totalConIva, sumAdultos, sumNinos, fechaResumen });

    // Ahora sí mostramos adultos/niños reales
    res.render('comprobante', {
      title: 'Compra confirmada',
      codigo: 'LOTE-' + Date.now().toString(36).toUpperCase(),
      paquete: { titulo: 'Múltiples paquetes (carrito)' },
      fecha: fechaResumen,
      adultos: sumAdultos,
      ninos: sumNinos,
      total: totalConIva
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ [checkout] error', e);
    res.status(400).send('No se pudo completar el checkout: ' + e.message);
  } finally {
    client.release();
  }
}
