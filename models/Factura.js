// models/Factura.js
import { pool } from '../config/db.js';

/** Genera código de factura */
function genFacturaCode() {
  return (
    'FAC-' +
    new Date().toISOString().slice(0,10).replace(/-/g,'') +
    '-' + Math.random().toString(36).slice(2,6).toUpperCase()
  );
}

/**
 * Crea una factura con N líneas de detalle.
 * - client: pg client (Transacción existente) o null para usar pool
 * - data: { reservaId, metodoPago, lineas: [{descripcion, cantidad, precio_unitario}] }
 * Retorna { facturaId, codigo_factura }
 */
export async function crearFactura(client, data) {
  const c = client || pool;
  const { reservaId, metodoPago = 'WEB', lineas = [] } = data;

  if (!reservaId || !Array.isArray(lineas) || !lineas.length) {
    throw new Error('Datos incompletos para la factura');
  }

  const subtotal = lineas.reduce((s, l) => s + Number(l.cantidad || 0) * Number(l.precio_unitario || 0), 0);
  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);

  const codigo = genFacturaCode();
  const insF = `
    INSERT INTO facturas (codigo_factura, reserva_id, fecha_emision, subtotal, iva, total, metodo_pago, estado)
    VALUES ($1,$2, CURRENT_DATE, $3,$4,$5, $6, 'EMITIDA')
    RETURNING id, codigo_factura
  `;
  const { rows } = await c.query(insF, [codigo, reservaId, subtotal, iva, total, metodoPago]);
  const facturaId = rows[0].id;

  const insD = `
    INSERT INTO detalle_factura (factura_id, descripcion, cantidad, precio_unitario, total_linea)
    VALUES ($1,$2,$3,$4,$5)
  `;
  for (const ln of lineas) {
    const cant = Number(ln.cantidad || 0);
    const pu   = Number(ln.precio_unitario || 0);
    await c.query(insD, [facturaId, ln.descripcion || '', cant, pu, +(cant*pu).toFixed(2)]);
  }

  return { facturaId, codigo_factura: rows[0].codigo_factura, subtotal, iva, total };
}

/** Anula facturas por reserva_id */
export async function anularFacturaPorReservaId(client, reservaId) {
  const c = client || pool;
  await c.query(
    `UPDATE facturas SET estado='ANULADA' WHERE reserva_id=$1 AND estado='EMITIDA'`,
    [reservaId]
  );
}

/** Anula facturas por código de reserva (join) */
export async function anularFacturaPorCodigoReserva(client, codigoReserva) {
  const c = client || pool;
  await c.query(
    `UPDATE facturas f
       SET estado = 'ANULADA'
      FROM reservas r
     WHERE r.id = f.reserva_id
       AND r.codigo_reserva = $1
       AND f.estado = 'EMITIDA'`,
    [codigoReserva]
  );
}
