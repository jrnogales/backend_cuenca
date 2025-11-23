// controllers/checkoutController.js
import { pool } from '../config/db.js';
import { getPaqueteByCodigo } from '../models/Paquete.js';
import { crearFactura, anularFacturaPorCodigoReserva } from '../models/Factura.js'; // (import ok)

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

/** Crea UNA sola reserva (flujo normal WEB) + su factura */
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

    // Inserta reserva (devuelve también el id para facturación)
    const insert = `
      INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,'WEB')
      RETURNING id, codigo_reserva`;
    const vals = [code, paquete.id, usuarioId, fecha, ad, ni, total];
    const { rows: resRows } = await client.query(insert, vals);

    // >>> FACTURA (dentro de la MISMA transacción)
    const lineas = [];
    if (ad > 0) lineas.push({
      descripcion: `${paquete.titulo} - Adultos`,
      cantidad: ad,
      precio_unitario: Number(paquete.precio_adulto || 0)
    });
    if (ni > 0) lineas.push({
      descripcion: `${paquete.titulo} - Niños`,
      cantidad: ni,
      precio_unitario: Number(paquete.precio_nino || 0)
    });

    await crearFactura(client, {
      reservaId: resRows[0].id,
      metodoPago: 'WEB',
      lineas
    });

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

/** Cancela una reserva: ANULA FACTURAS primero y luego repone cupos (todo en TX) */
export async function cancelarReserva(req, res) {
  const client = await pool.connect();
  try {
    const { codigo } = req.params;
    if (!codigo) return res.status(400).send('Falta el código de reserva.');

    await client.query('BEGIN');

    // 1) Obtener y bloquear la reserva por código (para que exista durante la anulación)
    const rRes = await client.query(
      `SELECT id FROM reservas WHERE codigo_reserva = $1 FOR UPDATE`,
      [codigo]
    );
    if (rRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).send('Reserva no encontrada.');
    }
    const reservaId = rRes.rows[0].id;

    // 2) Anular facturas EMITIDAS ligadas a esa reserva
    await client.query(
      `UPDATE facturas
          SET estado = 'ANULADA'
        WHERE reserva_id = $1
          AND estado = 'EMITIDA'`,
      [reservaId]
    );

    // 3) Cancelar la reserva (tu función SQL repone cupos por fecha)
    await client.query(`SELECT cancelar_reserva($1)`, [codigo]);

    await client.query('COMMIT');

    return res.render('comprobante-cancelado', {
      title: 'Reserva cancelada',
      codigo,
      mensaje: 'Tu reserva fue cancelada, la(s) factura(s) anulada(s) y los cupos repuestos.'
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error(err);
    return res.status(500).send('Error al cancelar la reserva: ' + err.message);
  } finally {
    client.release();
  }
}

/* ===========================================================
   NUEVO: crear varias reservas desde CARRITO y UNA sola factura
   Espera en req.body:
   {
     items: [
       { codigo, fecha, adultos, ninos },
       { codigo, fecha, adultos, ninos },
       ...
     ]
   }
   =========================================================== */
export async function crearReservasDesdeCarrito(req, res) {
  const client = await pool.connect();
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).send('El carrito está vacío.');
    }

    const usuarioId = req.user?.id ?? null;
    const hoy = new Date(); hoy.setHours(0,0,0,0);

    await client.query('BEGIN');

    const reservasCreadas = [];
    const lineasFactura = [];

    for (const item of items) {
      const { codigo, fecha, adultos, ninos } = item;

      if (!fecha) {
        throw new Error(`Falta la fecha para el paquete ${codigo}`);
      }

      const chosen = new Date(fecha); chosen.setHours(0,0,0,0);
      if (isNaN(chosen.getTime())) {
        throw new Error(`Fecha inválida para el paquete ${codigo}`);
      }
      if (chosen < hoy) {
        throw new Error(`No puedes seleccionar una fecha pasada para el paquete ${codigo}`);
      }

      const paquete = await getPaqueteByCodigo(codigo);
      if (!paquete) {
        throw new Error(`Paquete no encontrado: ${codigo}`);
      }

      const ad = parseInt(adultos ?? 0, 10);
      const ni = parseInt(ninos ?? 0, 10);
      if (isNaN(ad) || ad < 1) {
        throw new Error(`Debe haber al menos 1 adulto en el paquete ${codigo}`);
      }
      if (isNaN(ni) || ni < 0) {
        throw new Error(`Cantidad de niños inválida en el paquete ${codigo}`);
      }

      const solicitados = ad + ni;

      // Asegura fila de disponibilidad (upsert)
      await client.query(
        `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
         VALUES ($1, $2, COALESCE($3,30), 0)
         ON CONFLICT (paquete_id, fecha) DO NOTHING`,
        [paquete.id, fecha, 30]
      );

      // Bloquea fila de disponibilidad
      const { rows: dispRows } = await client.query(
        `SELECT id, cupos_totales, cupos_reservados
           FROM disponibilidad
          WHERE paquete_id = $1 AND fecha = $2
          FOR UPDATE`,
        [paquete.id, fecha]
      );
      if (dispRows.length === 0) {
        throw new Error(`No fue posible inicializar disponibilidad para ${codigo} en esa fecha.`);
      }

      const disp = dispRows[0];
      const disponibles = Number(disp.cupos_totales) - Number(disp.cupos_reservados);
      if (disponibles < solicitados) {
        throw new Error(`Solo quedan ${disponibles} cupos para el paquete ${codigo} en esa fecha.`);
      }

      // Total de esta reserva (solo informativo)
      const totalReserva =
        ad * Number(paquete.precio_adulto) +
        ni * Number(paquete.precio_nino);

      // Código de reserva
      const code =
        'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
        '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

      // Insertar reserva
      const insert = `
        INSERT INTO reservas
          (codigo_reserva, paquete_id, usuario_id, fecha_viaje,
           adultos, ninos, total_usd, origen)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,'CART')
        RETURNING id, codigo_reserva`;
      const vals = [code, paquete.id, usuarioId, fecha, ad, ni, totalReserva];
      const { rows: resRows } = await client.query(insert, vals);

      reservasCreadas.push({
        id: resRows[0].id,
        codigo_reserva: resRows[0].codigo_reserva,
        paquete,
        fecha,
        adultos: ad,
        ninos: ni,
        total: totalReserva
      });

      // Actualizar disponibilidad
      await client.query(
        `UPDATE disponibilidad
            SET cupos_reservados = cupos_reservados + $1
          WHERE paquete_id = $2 AND fecha = $3`,
        [solicitados, paquete.id, fecha]
      );

      // Construir líneas de factura para ESTE paquete
      if (ad > 0) {
        lineasFactura.push({
          descripcion: `${paquete.titulo} - Adultos (Reserva ${resRows[0].codigo_reserva})`,
          cantidad: ad,
          precio_unitario: Number(paquete.precio_adulto || 0)
        });
      }
      if (ni > 0) {
        lineasFactura.push({
          descripcion: `${paquete.titulo} - Niños (Reserva ${resRows[0].codigo_reserva})`,
          cantidad: ni,
          precio_unitario: Number(paquete.precio_nino || 0)
        });
      }
    } // fin for items

    if (reservasCreadas.length === 0) {
      throw new Error('No se creó ninguna reserva desde el carrito.');
    }

    // 👉 Crear UNA SOLA FACTURA para todas las reservas del carrito.
    // La factura se asocia a la primera reserva (por compatibilidad con tu esquema actual).
    const reservaPrincipal = reservasCreadas[0];

    await crearFactura(client, {
      reservaId: reservaPrincipal.id,
      metodoPago: 'WEB',
      lineas: lineasFactura
    });

    await client.query('COMMIT');

    // Para el flujo de admin es práctico ir directo a la lista de facturas
    return res.redirect('/admin/facturas');
  } catch (err) {
    console.error(err);
    try { await client.query('ROLLBACK'); } catch {}
    return res.status(500).send('No se pudieron crear las reservas del carrito: ' + err.message);
  } finally {
    client.release();
  }
}
