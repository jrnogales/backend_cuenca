// soap/server.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import soap from 'soap';

import { listPaquetes, getPaqueteByCodigo } from '../models/Paquete.js';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ===================== Utils ===================== */
function brief(txt = '', len = 140) {
  const s = String(txt).replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : s.slice(0, len - 1) + '…';
}

function toServicioRow(p) {
  return {
    id: String(p.codigo),
    name: p.titulo,
    adultPrice: Number(p.precio_adulto || 0),
    childPrice: Number(p.precio_nino || 0),
    currency: p.currency || 'USD',
    durationDays: Number(p.duracion_dias || 1),
    agencyName: p.agency_name || 'cuenca-travel',
    imageUrl: p.imagen || '',
    description: brief(p.descripcion || ''),
    stock: Number(p.stock || 0)
  };
}

/* ==================================================
   ============== Handlers SOAP “paquetes” ===========
   ================================================== */

async function listarPaquetesHandler(_, cb) {
  try {
    const data = await listPaquetes();
    const paquete = data.map(p => ({
      packageId:   p.codigo,
      packageName: p.titulo,
      adultPrice:  Number(p.precio_adulto || 0),
      childPrice:  Number(p.precio_nino   || 0),
      stock:       Number(p.stock || 0),
      currency:            p.currency || 'USD',
      durationDays:        Number(p.duracion_dias || 1),
      agencyName:          p.agency_name || 'cuenca-travel',
      cancellationPolicy:  p.cancellation_policy || 'Cancelación gratuita hasta 8 horas antes del inicio',
      imageUrl:            p.imagen || '',
      description:         brief(p.descripcion || '')
    }));
    cb({ paquete });
  } catch (e) {
    cb({ paquete: [] });
  }
}

async function obtenerDetalleHandler(args, cb) {
  try {
    const p = await getPaqueteByCodigo(args.codigo);
    if (!p) return cb({});
    cb({
      codigo:        p.codigo,
      titulo:        p.titulo,
      descripcion:   p.descripcion || '',
      adultPrice:    Number(p.precio_adulto || 0),
      childPrice:    Number(p.precio_nino   || 0),
      stock:         Number(p.stock || 0),
      currency:            p.currency || 'USD',
      durationDays:        Number(p.duracion_dias || 1),
      agencyName:          p.agency_name || 'cuenca-travel',
      cancellationPolicy:  p.cancellation_policy || 'Cancelación gratuita hasta 8 horas antes del inicio',
      imageUrl:            p.imagen || ''
    });
  } catch (e) {
    cb({});
  }
}

async function crearReservaHandler(args, cb) {
  const client = await pool.connect();
  try {
    const a = Math.max(1, parseInt(args.adultos || '1', 10));
    const k = Math.max(0, parseInt(args.ninos   || '0', 10));
    const codigo = String(args.codigo || '').trim();
    const fecha  = String(args.fecha  || '').trim();
    if (!codigo || !fecha) {
      return cb({ ok: false, codigoReserva: '', mensaje: 'Datos incompletos' });
    }

    const pRes = await client.query('SELECT * FROM paquetes WHERE codigo=$1 LIMIT 1', [codigo]);
    const p = pRes.rows[0];
    if (!p) return cb({ ok: false, codigoReserva: '', mensaje: 'Paquete no encontrado' });

    const solicitados = a + k;

    await client.query('BEGIN');

    await client.query(
      `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES ($1,$2,30,0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING`,
      [p.id, fecha]
    );

    const { rows: drows } = await client.query(
      `SELECT cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id=$1 AND fecha=$2
        FOR UPDATE`,
      [p.id, fecha]
    );
    if (drows.length === 0) {
      await client.query('ROLLBACK');
      return cb({ ok:false, codigoReserva:'', mensaje:'No hay disponibilidad para esa fecha.' });
    }

    const disponibles = drows[0].cupos_totales - drows[0].cupos_reservados;
    if (disponibles < solicitados) {
      await client.query('ROLLBACK');
      return cb({ ok:false, codigoReserva:'', mensaje:`Stock insuficiente (${disponibles})` });
    }

    const total = a * Number(p.precio_adulto || 0) + k * Number(p.precio_nino || 0);
    const code =
      'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
      '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

    await client.query(
      `INSERT INTO reservas
         (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'SOAP')`,
      [code, p.id, null, fecha, a, k, total]
    );

    await client.query(
      `UPDATE disponibilidad
          SET cupos_reservados = cupos_reservados + $1
        WHERE paquete_id=$2 AND fecha=$3`,
      [solicitados, p.id, fecha]
    );

    await client.query('COMMIT');
    cb({ ok: true, codigoReserva: code, mensaje: '' });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    cb({ ok: false, codigoReserva: '', mensaje: e.message });
  } finally {
    client.release();
  }
}


/* ==================================================
   ============ Handlers SOAP “integración” =========
   ================================================== */

const preHolds = new Map(); // memoria: pre-reservas (id -> {expiraEn, itinerario})

async function buscarServicios({ filtros = {} }, cb) {
  try {
    const rows = await listPaquetes();
    // filtros muy básicos (puedes ampliar): min/max precio
    const minP = filtros.minPrecio ? Number(filtros.minPrecio) : null;
    const maxP = filtros.maxPrecio ? Number(filtros.maxPrecio) : null;

    const list = rows
      .map(toServicioRow)
      .filter(s => (minP === null || s.adultPrice >= minP) && (maxP === null || s.adultPrice <= maxP));

    cb({ servicio: list });
  } catch {
    cb({ servicio: [] });
  }
}

async function obtenerDetalleServicio({ idServicio }, cb) {
  try {
    const p = await getPaqueteByCodigo(idServicio);
    if (!p) return cb({});
    cb({ servicio: toServicioRow(p) });
  } catch {
    cb({});
  }
}

async function verificarDisponibilidad({ sku, inicio, fin, unidades }, cb) {
  try {
    const date = String(inicio || '').slice(0, 10); // usamos inicio como fecha
    const pRes = await pool.query('SELECT id FROM paquetes WHERE codigo=$1 LIMIT 1', [sku]);
    const p = pRes.rows[0];
    if (!p || !date) return cb({ ok: false });

    // asegura fila de disponibilidad
    await pool.query(
      `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES ($1,$2,30,0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING`,
      [p.id, date]
    );

    const { rows } = await pool.query(
      `SELECT cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id=$1 AND fecha=$2`,
      [p.id, date]
    );
    if (rows.length === 0) return cb({ ok: false });

    const disp = rows[0].cupos_totales - rows[0].cupos_reservados;
    const u = Math.max(0, parseInt(unidades || '0', 10));
    cb({ ok: disp >= u });
  } catch {
    cb({ ok: false });
  }
}


async function cotizarReserva(args, cb) {
  try {
    const items = Array.isArray(args.item) ? args.item : [args.item];
    let total = 0;
    const parts = [];

    for (const it of items) {
      if (!it) continue;
      const p = await getPaqueteByCodigo(it.codigo);
      if (!p) continue;
      const ad = Math.max(0, parseInt(it.adultos || '0', 10));
      const ni = Math.max(0, parseInt(it.ninos   || '0', 10));
      const subt = ad * Number(p.precio_adulto || 0) + ni * Number(p.precio_nino || 0);
      total += subt;
      parts.push(`${it.codigo}:${subt.toFixed(2)}`);
    }

    cb({ total: total.toFixed(2), breakdown: parts.join('|') });
  } catch {
    cb({ total: '0.00', breakdown: '' });
  }
}

async function crearPreReserva({ itinerario, cliente, holdMinutes, idemKey }, cb) {
  try {
    const preId = 'PRE-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const mins = Math.max(1, parseInt(holdMinutes || '10', 10));
    const expira = new Date(Date.now() + mins * 60000).toISOString();

    preHolds.set(preId, { expiraEn: expira, itinerario: String(itinerario || ''), cliente: String(cliente || ''), idemKey: String(idemKey || '') });
    cb({ preBookingId: preId, expiraEn: expira });
  } catch {
    cb({ preBookingId: '', expiraEn: '' });
  }
}

async function confirmarReserva({ preBookingId, metodoPago, datosPago }, cb) {
  try {
    const pre = preHolds.get(String(preBookingId || ''));
    if (!pre) return cb({ bookingId: '', estado: 'NO_ENCONTRADA' });

    // Se espera que "itinerario" sea un JSON con: { items: [{ codigo, adultos, ninos, fecha }, ...] }
    let it;
    try { it = JSON.parse(pre.itinerario || '{}'); } catch { it = {}; }
    const item = Array.isArray(it.items) ? it.items[0] : null;
    if (!item) return cb({ bookingId: '', estado: 'SIN_ITEMS' });

    const resP = await pool.query('SELECT * FROM paquetes WHERE codigo=$1 LIMIT 1', [item.codigo]);
    const p = resP.rows[0];
    if (!p) return cb({ bookingId: '', estado: 'SKU_INVALIDO' });

    const solicit = Number(item.adultos || 0) + Number(item.ninos || 0);
    if (Number(p.stock || 0) < solicit) return cb({ bookingId: '', estado: 'SIN_STOCK' });

    const total = (Number(item.adultos || 0) * Number(p.precio_adulto || 0)) +
                  (Number(item.ninos   || 0) * Number(p.precio_nino   || 0));

    const bookingId =
      'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
      '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

    await pool.query(
      `INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'INTEGRACION')`,
      [bookingId, p.id, null, String(item.fecha || ''), Number(item.adultos || 0), Number(item.ninos || 0), total]
    );
    await pool.query('UPDATE paquetes SET stock = stock - $1 WHERE id = $2', [solicit, p.id]);

    preHolds.delete(String(preBookingId || ''));
    cb({ bookingId, estado: 'CONFIRMADA' });
  } catch {
    cb({ bookingId: '', estado: 'ERROR' });
  }
}

async function cancelarReservaIntegracion({ bookingId, motivo }, cb) {
  try {
    await pool.query('SELECT cancelar_reserva($1)', [String(bookingId || '')]);
    cb({ ok: true });
  } catch {
    cb({ ok: false });
  }
}


/* ==================================================
   ============== Objetos “service” WSDL =============
   ================================================== */

const servicePaquetes = {
  PaquetesService: {
    PaquetesPort: {
      listarPaquetes: listarPaquetesHandler,
      obtenerDetalle: obtenerDetalleHandler
    }
  }
};

const serviceReservas = {
  ReservasService: {
    ReservasPort: {
      crearReserva: crearReservaHandler
    }
  }
};

const serviceIntegracion = {
  IntegracionService: {
    IntegracionPort: {
      buscarServicios,
      obtenerDetalleServicio,
      verificarDisponibilidad,
      cotizarReserva,
      crearPreReserva,
      confirmarReserva,
      cancelarReservaIntegracion
    }
  }
};

/* ==================================================
   ============ Helper para alias .asmx ==============
   ================================================== */

function mountSoapAlias(app, routeBase, wsdlXml, service) {
  app.get(routeBase, (req, res) => {
    if (String(req.query.wsdl || '').toLowerCase() === 'true' || req.url.includes('?wsdl')) {
      const addr = `${req.protocol}://${req.get('host')}${routeBase}`;
      return res.type('text/xml').send(wsdlXml.replace(/REPLACE_ME_AT_RUNTIME/g, addr));
    }
    res.type('text/html').send(
      `<h3>SOAP endpoint</h3>
       <p>Endpoint: <code>${routeBase}</code></p>
       <p>WSDL: <a href="${routeBase}?wsdl">${routeBase}?wsdl</a></p>`
    );
  });
  soap.listen(app, routeBase, service, wsdlXml);
}

/* ==================================================
   ================= Export principal =================
   ================================================== */

export function attachSoap(app) {
  // WSDL principal de paquetes/ reservas
  const wsdlPath = path.join(__dirname, 'paquetes.wsdl');
  const wsdlXmlRaw = fs.readFileSync(wsdlPath, 'utf8');

  // Endpoint histórico /soap y su WSDL
  app.get('/soap/paquetes.wsdl', (req, res) => {
    const addr = `${req.protocol}://${req.get('host')}/soap`;
    res.type('text/xml').send(wsdlXmlRaw.replace(/REPLACE_ME_AT_RUNTIME/g, addr));
  });
  soap.listen(
    app,
    '/soap',
    { PaquetesService: { PaquetesPort: {
        listarPaquetes: listarPaquetesHandler,
        obtenerDetalle: obtenerDetalleHandler,
        crearReserva:   crearReservaHandler
    }}},
    wsdlXmlRaw
  );

  // Alias estilo .asmx (compatibilidad .NET)
  mountSoapAlias(app, '/WS_GestionPaquetes.asmx', wsdlXmlRaw, servicePaquetes);
  mountSoapAlias(app, '/WS_GestionReservas.asmx', wsdlXmlRaw, serviceReservas);

  // ====== NUEVO: Servicio de Integración ======
  const intWSDL = path.join(__dirname, 'integracion.wsdl');
  const intXml  = fs.readFileSync(intWSDL, 'utf8');
  mountSoapAlias(app, '/WS_Integracion.asmx', intXml, serviceIntegracion);
}

