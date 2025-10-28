// models/Factura.js
import { pool } from '../config/db.js';

/** Genera código de factura único */
function genFacturaCode() {
  return (
    'FAC-' +
    new Date().toISOString().slice(0, 10).replace(/-/g, '') +
    '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase()
  );
}

/**
 * Crea una factura con sus líneas de detalle
 * @param {object|null} client - conexión de transacción activa o null
 * @param {object} data - { reservaId, metodoPago, lineas: [{ descripcion, cantidad, precio_unitario }] }
 */
export async function crearFactura(client, data) {
  const c = client || pool;
  const { reservaId, metodoPago = 'WEB', lineas = [] } = data;

  if (!reservaId || !Array.isArray(lineas) || lineas.length === 0) {
    throw new Error('Datos incompletos para la factura');
  }

  // Calcular totales
  const subtotal = lineas.reduce(
    (s, l) => s + Number(l.cantidad || 0) * Number(l.precio_unitario || 0),
    0
  );
  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);

  // Insertar cabecera
  const codigo = genFacturaCode();
  const q1 = `
    INSERT INTO facturas (codigo_factura, reserva_id, fecha_emision, subtotal, iva, total, metodo_pago, estado)
    VALUES ($1, $2, NOW(), $3, $4, $5, $6, 'EMITIDA')
    RETURNING id, codigo_factura
  `;
  const { rows } = await c.query(q1, [codigo, reservaId, subtotal, iva, total, metodoPago]);
  const facturaId = rows[0].id;

  // Insertar líneas de detalle
  const q2 = `
    INSERT INTO detalle_factura (factura_id, descripcion, cantidad, precio_unitario, total_linea)
    VALUES ($1, $2, $3, $4, $5)
  `;
  for (const ln of lineas) {
    const cant = Number(ln.cantidad || 0);
    const pu = Number(ln.precio_unitario || 0);
    const totalLinea = +(cant * pu).toFixed(2);
    await c.query(q2, [facturaId, ln.descripcion || '', cant, pu, totalLinea]);
  }

  return {
    facturaId,
    codigo_factura: rows[0].codigo_factura,
    subtotal,
    iva,
    total,
  };
}

/** Anula facturas por reserva_id */
export async function anularFacturaPorReservaId(client, reservaId) {
  const c = client || pool;
  await c.query(
    `UPDATE facturas SET estado = 'ANULADA'
     WHERE reserva_id = $1 AND estado = 'EMITIDA'`,
    [reservaId]
  );
}

/** Anula facturas por código de reserva (JOIN con tabla reservas) */
export async function anularFacturaPorCodigoReserva(client, codigoReserva) {
  const c = client || pool;
  await c.query(
    `UPDATE facturas f
       SET estado = 'ANULADA'
      FROM reservas r
     WHERE f.reserva_id = r.id
       AND r.codigo_reserva = $1
       AND f.estado = 'EMITIDA'`,
    [codigoReserva]
  );
}
