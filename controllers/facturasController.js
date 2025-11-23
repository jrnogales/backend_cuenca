// controllers/facturasController.js
import { pool } from '../config/db.js';

/**
 * Crea UNA sola factura a partir de varias reservas
 *   - reservaIds: array de IDs de reservas [23, 24, ...]
 *   - metodoPago: 'WEB', 'EFECTIVO', etc.
 */
export async function crearFacturaDesdeReservas(reservaIds, metodoPago = 'WEB') {
  if (!reservaIds || !reservaIds.length) {
    throw new Error('No se enviaron reservas para facturar');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Traer info de reservas + paquete
    const { rows: reservas } = await client.query(
      `
      SELECT
        r.id,
        r.codigo_reserva,
        r.fecha_viaje,
        r.adultos,
        r.ninos,
        r.total_usd,
        r.usuario_id,
        p.titulo,
        p.precio_adulto,
        p.precio_nino
      FROM reservas r
      JOIN paquetes p ON p.id = r.paquete_id
      WHERE r.id = ANY($1::int[])
      ORDER BY r.id
      `,
      [reservaIds]
    );

    if (!reservas.length) {
      throw new Error('Reservas no encontradas');
    }

    const usuarioId = reservas[0].usuario_id; // asumimos mismo usuario

    // 2) Subtotal = suma de total_usd (neto sin IVA)
    let subtotal = 0;
    for (const r of reservas) {
      subtotal += Number(r.total_usd || 0);
    }

    const IVA_RATE = 0.15; // 15%
    const iva   = +(subtotal * IVA_RATE).toFixed(2);
    const total = +(subtotal + iva).toFixed(2);

    // 3) Generar código de factura
    const today = new Date();
    const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, '');
    const { rows: seqRows } = await client.query(
      `SELECT COALESCE(MAX(id),0)+1 AS sec FROM facturas`
    );
    const sec = String(seqRows[0].sec).padStart(3, '0');
    const codigoFactura = `FAC-${yyyymmdd}-${sec}`;

    // 4) Insertar la factura (la vinculamos a la PRIMERA reserva)
    const { rows: facRows } = await client.query(
      `
      INSERT INTO facturas
        (codigo_factura, reserva_id, fecha_emision,
         subtotal, iva, total, metodo_pago, estado)
      VALUES
        ($1, $2, NOW(), $3, $4, $5, $6, 'EMITIDA')
      RETURNING id
      `,
      [codigoFactura, reservas[0].id, subtotal, iva, total, metodoPago]
    );

    const facturaId = facRows[0].id;

    // 5) Insertar el detalle (Adultos / Niños de cada reserva)
    for (const r of reservas) {
      // Adultos
      if (r.adultos > 0 && r.precio_adulto != null) {
        // totalLinea solo informativo, la BD calcula total_linea
        const totalLinea = +(r.adultos * Number(r.precio_adulto)).toFixed(2);
        await client.query(
          `
          INSERT INTO detalle_factura
            (factura_id, descripcion, cantidad, precio_unitario)
          VALUES
            ($1, $2, $3, $4)
          `,
          [
            facturaId,
            `${r.titulo} - Adultos (Reserva ${r.codigo_reserva})`,
            r.adultos,
            r.precio_adulto
          ]
        );
      }

      // Niños
      if (r.ninos > 0 && r.precio_nino != null) {
        const totalLinea = +(r.ninos * Number(r.precio_nino)).toFixed(2);
        await client.query(
          `
          INSERT INTO detalle_factura
            (factura_id, descripcion, cantidad, precio_unitario)
          VALUES
            ($1, $2, $3, $4)
          `,
          [
            facturaId,
            `${r.titulo} - Niños (Reserva ${r.codigo_reserva})`,
            r.ninos,
            r.precio_nino
          ]
        );
      }
    }

    await client.query('COMMIT');

    return { facturaId, codigoFactura, total, subtotal, iva, usuarioId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
