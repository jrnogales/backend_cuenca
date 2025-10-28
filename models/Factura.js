// models/Factura.js
import { pool } from '../config/db.js';

/** Genera un código de factura único */
function genFacturaCode() {
  return (
    'FAC-' +
    new Date().toISOString().slice(0,10).replace(/-/g,'') +
    '-' + Math.random().toString(36).substring(2,6).toUpperCase()
  );
}

/**
 * Crear una factura con sus líneas
 * @param {*} client - conexión o transacción activa
 * @param {*} data { reservaId, metodoPago, lineas: [{descripcion, cantidad, precio_unitario}] }
 */
export async function crearFactura(client, data) {
  const c = client || pool;
  const { reservaId, metodoPago = 'WEB', lineas = [] } = data;

  if (!reservaId || !Array.isArray(lineas) || lineas.length === 0) {
    throw new Error('Datos insuficientes para crear la factura');
  }

  const subtotal = lineas.reduce((acc, l) => acc + (Number(l.cantidad) * Number(l.precio_unitario)), 0);
  const iva = +(subtotal * 0.15).toFixed(2);
  const total = +(subtotal + iva).toFixed(2);
  const codigo = genFacturaCode();

  const insertFactura = `
    INSERT INTO facturas (codigo_factura, reserva_id, fecha_emision, subtotal, iva, total, metodo_pago, estado)
    VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4, $5, $6, 'EMITIDA')
    RETURNING id, codigo_factura
  `;
  const { rows } = await c.query(insertFactura, [codigo, reservaId, subtotal, iva, total, metodoPago]);
  const facturaId = rows[0].id;

  const insertDetalle = `
    INSERT INTO detalle_factura (factura_id, descripcion, cantidad, precio_unitario, total_linea)
    VALUES ($1, $2, $3, $4, $5)
  `;
  for (const l of lineas) {
    const totalLinea = Number(l.cantidad) * Number(l.precio_unitario);
    await c.query(insertDetalle, [facturaId, l.descripcion, l.cantidad, l.precio_unitario, totalLinea]);
  }

  return { facturaId, codigo_factura: rows[0].codigo_factura, subtotal, iva, total };
}

/** Anula la factura si existe para una reserva */
export async function anularFacturaPorCodigoReserva(client, codigoReserva) {
  const c = client || pool;
  await c.query(`
    UPDATE facturas f
       SET estado = 'ANULADA'
      FROM reservas r
     WHERE r.id = f.reserva_id
       AND r.codigo_reserva = $1
       AND f.estado = 'EMITIDA'
  `, [codigoReserva]);
}
