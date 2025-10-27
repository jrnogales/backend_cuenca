import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';
import {
  addOrUpdateItem,
  listCartByUser,
  removeItem,
  updateItem
} from '../models/Carrito.js';

/* ================== Utils ================== */

/** Totales con IVA 15% */
function calcTotals(items) {
  const subtotal = items.reduce((acc, it) => acc + Number(it.total_linea || 0), 0);
  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), iva, total };
}

/** Normaliza a YYYY-MM-DD */
function day(x) {
  return String(x).slice(0, 10);
}

/** Obtiene disponibilidad del día. Si no hay registro, asume 30 libres */
async function getDisponibilidad(paqueteId, fecha) {
  const sql = `
    SELECT
      COALESCE(cupos_totales, 30)::int   AS cupos_totales,
      COALESCE(cupos_reservados, 0)::int AS cupos_reservados,
      (COALESCE(cupos_totales, 30)::int - COALESCE(cupos_reservados, 0)::int) AS restantes
    FROM disponibilidad
    WHERE paquete_id = $1 AND fecha = $2::date
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [paqueteId, day(fecha)]);
  if (!rows.length) return { cupos_totales: 30, cupos_reservados: 0, restantes: 30 };
  return rows[0];
}

/* ================== Controladores ================== */

export async function showCart(req, res) {
  const items = await listCartByUser(req.user.id);
  const totals = calcTotals(items);
  res.render('cart', { title: 'Mi carrito', items, totals });
}

/**
 * POST /cart/add
 * Valida disponibilidad del día antes de agregar al carrito
 */
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
    const ad = Math.max(1, parseInt(adultos ?? 1, 10));
    const ni = Math.max(0, parseInt(ninos ?? 0, 10));
    if (!codigo || !fecha) {
      return res.status(400).json({ ok: false, message: 'Faltan datos: código y fecha.' });
    }

    const p = await getPaqueteByCodigo(codigo);
    if (!p) return res.status(404).json({ ok: false, message: 'Paquete no encontrado' });

    const disp = await getDisponibilidad(p.id, fecha);
    const solicitadosAhora = ad + ni;

    if (disp.restantes <= 0) {
      return res.status(409).json({ ok: false, message: `No quedan cupos para ${day(fecha)}.` });
    }

    if (solicitadosAhora > disp.restantes) {
      return res.status(409).json({
        ok: false,
        message: `No hay cupos suficientes para ${day(fecha)}. Puedes agregar como máximo ${disp.restantes}.`,
        restantes: disp.restantes
      });
    }

    const totalLinea =
      ad * Number(p.precio_adulto || 0) +
      ni * Number(p.precio_nino   || 0);

    await addOrUpdateItem({
      usuarioId: userId,
      paqueteId: p.id,
      fecha: day(fecha),
      adultos: ad,
      ninos: ni,
      totalLinea
    });

    const items = await listCartByUser(userId);
    const totals = calcTotals(items);
    return res.json({ ok: true, items, totals });

  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * POST /cart/update
 */
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
    const currentQty = Number(it.adultos || 0) + Number(it.ninos || 0);

    const disp = await getDisponibilidad(it.paquete_id, it.fecha);
    const maxPermitido = currentQty + Number(disp.restantes);

    if (newQty > maxPermitido) {
      return res.status(409).json({
        ok: false,
        message: `No hay cupos suficientes para ${day(it.fecha)}. Puedes aumentar como máximo ${disp.restantes} más.`
      });
    }

    const totalLinea =
      ad * Number(it.precio_adulto || 0) +
      ni * Number(it.precio_nino   || 0);

    await updateItem(userId, itemId, { adultos: ad, ninos: ni, totalLinea });
    const items = await listCartByUser(userId);
    const totals = calcTotals(items);
    return res.json({ ok: true, items, totals });

  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
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
    return res.json({ ok: true, items, totals });

  } catch (e) {
    return res.status(500).json({ ok: false, message: e.message });
  }
}

/**
 * POST /cart/checkout
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

      const dispQ = `
        SELECT id, cupos_totales, cupos_reservados
        FROM disponibilidad
        WHERE paquete_id = $1 AND fecha = $2::date
        FOR UPDATE
      `;
      const dispRes = await client.query(dispQ, [paquete_id, day(fecha)]);

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
          [paquete_id, day(fecha)]
        );
        dispId = ins.rows[0].id;
      }

      const solicitados = Number(adultos) + Number(ninos);
      if (cuposReservados + solicitados > cuposTotales) {
        throw new Error(`Sin cupos para ${day(fecha)}.`);
      }

      const pRes = await client.query('SELECT * FROM paquetes WHERE id=$1', [paquete_id]);
      const p = pRes.rows[0];
      const total =
        (Number(adultos) * Number(p.precio_adulto || 0)) +
        (Number(ninos)   * Number(p.precio_nino   || 0));
      totalLote += total;

      const bookingId =
        'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
        '-' + Math.random().toString(36).slice(2,6).toUpperCase();

      await client.query(
        `INSERT INTO reservas
          (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'CART')`,
        [bookingId, paquete_id, usuarioId, day(fecha), adultos, ninos, total]
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
