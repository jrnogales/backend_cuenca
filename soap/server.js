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

function normalizarTuristas(turistasNode) {
  if (!turistasNode || !turistasNode.turista) return [];
  return Array.isArray(turistasNode.turista)
    ? turistasNode.turista
    : [turistasNode.turista];
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
    console.error('listarPaquetesHandler error:', e);
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
    console.error('obtenerDetalleHandler error:', e);
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
    console.error('crearReservaHandler error:', e);
    try { await client.query('ROLLBACK'); } catch {}
    cb({ ok: false, codigoReserva: '', mensaje: e.message });
  } finally {
    client.release();
  }
}


/* ==================================================
   ============ Handlers SOAP “integración” =========
   ================================================== */

const preHolds = new Map(); // memoria: pre-reservas (id -> {expiraEn, id_paquete, fecha, turistas})

/**
 * buscarPaquetes()
 * Filtros según el formato del bus; aquí filtramos sobre listPaquetes().
 */
async function buscarPaquetes(args, cb) {
  try {
    const {
      ciudad,
      pais,
      fecha_inicio,  // no se usa para filtrar, solo potencialmente en la lógica interna
      duracion,
      tipo_actividad,
      capacidad,
      precio_min,
      precio_max,
      sort
    } = args || {};

    const rows = await listPaquetes();
    let list = rows.map(p => ({
      id_paquete:     String(p.codigo),
      ciudad:         p.ciudad || ciudad || 'Cuenca',
      pais:           p.pais   || pais   || 'Ecuador',
      tipo_actividad: p.tipo_actividad || tipo_actividad || 'TOUR',
      capacidad:      Number(p.stock || 0),
      precio_normal:  Number(p.precio_adulto || 0),
      precio_actual:  Number(p.precio_adulto || 0),
      uri_imagen:     p.imagen || ''
    }));

    const minP = precio_min != null ? Number(precio_min) : null;
    const maxP = precio_max != null ? Number(precio_max) : null;
    const minCap = capacidad != null ? Number(capacidad) : null;

    list = list.filter(p => {
      if (minP !== null && p.precio_actual < minP) return false;
      if (maxP !== null && p.precio_actual > maxP) return false;
      if (minCap !== null && p.capacidad < minCap) return false;
      if (tipo_actividad && p.tipo_actividad !== tipo_actividad) return false;
      return true;
    });

    if (sort === 'precio_desc') {
      list.sort((a, b) => b.precio_actual - a.precio_actual);
    } else if (sort === 'precio_asc') {
      list.sort((a, b) => a.precio_actual - b.precio_actual);
    }

    cb({ paquete: list });
  } catch (e) {
    console.error('buscarPaquetes SOAP error:', e);
    cb({ paquete: [] });
  }
}

/**
 * validarDisponibilidadPaquete()
 */
async function validarDisponibilidadPaquete({ idPaquete, fechaInicio, personas }, cb) {
  const client = await pool.connect();
  try {
    const codigo = String(idPaquete || '').trim();
    const fecha  = String(fechaInicio || '').slice(0, 10);
    const pe = Math.max(1, parseInt(personas || '1', 10));
    if (!codigo || !fecha) {
      return cb({ disponible: false });
    }

    const pRes = await client.query(
      'SELECT id FROM paquetes WHERE codigo=$1 LIMIT 1',
      [codigo]
    );
    const p = pRes.rows[0];
    if (!p) return cb({ disponible: false });

    await client.query(
      `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES ($1,$2,30,0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING`,
      [p.id, fecha]
    );

    const { rows } = await client.query(
      `SELECT cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id=$1 AND fecha=$2`,
      [p.id, fecha]
    );
    if (!rows.length) return cb({ disponible: false });

    const disp = rows[0].cupos_totales - rows[0].cupos_reservados;
    cb({ disponible: disp >= pe });
  } catch (e) {
    console.error('validarDisponibilidadPaquete SOAP error:', e);
    cb({ disponible: false });
  } finally {
    client.release();
  }
}

/**
 * crearPreReservaPaquete()
 * Usa memoria (preHolds) para los HOLDs.
 */
async function crearPreReservaPaquete(args, cb) {
  try {
    const { id_paquete, fecha_inicio, turistas, duracionHoldSegundos } = args || {};
    const idPaquete = String(id_paquete || '').trim();
    const fecha     = String(fecha_inicio || '').slice(0, 10);
    const t = normalizarTuristas(turistas);
    if (!idPaquete || !fecha) {
      return cb({ id_hold: '' });
    }

    const holdId = 'HOLD-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const dur = duracionHoldSegundos != null ? parseInt(duracionHoldSegundos, 10) : 600;
    const expira = new Date(Date.now() + dur * 1000).toISOString();

    preHolds.set(holdId, {
      id_paquete: idPaquete,
      fecha,
      turistas: t,
      expiraEn: expira
    });

    cb({ id_hold: holdId });
  } catch (e) {
    console.error('crearPreReservaPaquete SOAP error:', e);
    cb({ id_hold: '' });
  }
}

/**
 * reservarPaquete()
 */
async function reservarPaquete(args, cb) {
  const client = await pool.connect();
  try {
    const { id_paquete, id_hold, correo, turistas } = args || {};
    const codigo = String(id_paquete || '').trim();
    const holdId = String(id_hold || '').trim();
    const email  = String(correo || '').trim();

    if (!codigo || !holdId || !email) {
      return cb({ id_reserva: '' });
    }

    const pre = preHolds.get(holdId);
    if (!pre || pre.id_paquete !== codigo) {
      return cb({ id_reserva: '' });
    }
    if (pre.expiraEn && new Date(pre.expiraEn) < new Date()) {
      preHolds.delete(holdId);
      return cb({ id_reserva: '' });
    }

    const t = normalizarTuristas(turistas || { turista: pre.turistas || [] });
    const adultos = t.length;
    const ninos   = 0;
    const personas = adultos + ninos;

    await client.query('BEGIN');

    const pRes = await client.query(
      'SELECT id, precio_adulto, precio_nino FROM paquetes WHERE codigo=$1 LIMIT 1',
      [codigo]
    );
    const p = pRes.rows[0];
    if (!p) {
      await client.query('ROLLBACK');
      return cb({ id_reserva: '' });
    }

    await client.query(
      `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
       VALUES ($1,$2,30,0)
       ON CONFLICT (paquete_id, fecha) DO NOTHING`,
      [p.id, pre.fecha]
    );

    const { rows: drows } = await client.query(
      `SELECT cupos_totales, cupos_reservados
         FROM disponibilidad
        WHERE paquete_id=$1 AND fecha=$2
        FOR UPDATE`,
      [p.id, pre.fecha]
    );
    if (!drows.length) {
      await client.query('ROLLBACK');
      return cb({ id_reserva: '' });
    }

    const disponibles = drows[0].cupos_totales - drows[0].cupos_reservados;
    if (disponibles < personas) {
      await client.query('ROLLBACK');
      return cb({ id_reserva: '' });
    }

    let usuarioId = null;
    const uRes = await client.query(
      'SELECT id FROM usuarios WHERE email=$1 LIMIT 1',
      [email]
    );
    if (uRes.rows.length) {
      usuarioId = uRes.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO usuarios (nombre, email, rol, estado, creado_en)
         VALUES ($1,$2,'user','activo',NOW())
         RETURNING id`,
        ['Cliente Integracion', email]
      );
      usuarioId = ins.rows[0].id;
    }

    const total = adultos * Number(p.precio_adulto || 0) +
                  ninos   * Number(p.precio_nino   || 0);

    const code =
      'RES-' + new Date().toISOString().slice(0,10).replace(/-/g,'') +
      '-'    + Math.random().toString(36).slice(2,6).toUpperCase();

    const rInsert = await client.query(
      `INSERT INTO reservas
        (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'INTEGRACION')
       RETURNING id`,
      [code, p.id, usuarioId, pre.fecha, adultos, ninos, total]
    );

    await client.query(
      `UPDATE disponibilidad
          SET cupos_reservados = cupos_reservados + $1
        WHERE paquete_id=$2 AND fecha=$3`,
      [personas, p.id, pre.fecha]
    );

    await client.query('COMMIT');
    preHolds.delete(holdId);

    cb({ id_reserva: String(rInsert.rows[0].id) });
  } catch (e) {
    console.error('reservarPaquete SOAP error:', e);
    try { await pool.query('ROLLBACK'); } catch {}
    cb({ id_reserva: '' });
  } finally {
    client.release();
  }
}

/**
 * emitirFacturaPaquete()
 * Se hace una factura simple asociada a la última reserva del usuario.
 */
async function emitirFacturaPaquete(args, cb) {
  const client = await pool.connect();
  try {
    const {
      id_reserva,
      correo,
      nombre,
      apellido,
      tipo_identificacion,
      identificacion,
      valor,
      id_transaccion
    } = args || {};

    const email        = String(correo || '').trim();
    const firstName    = String(nombre || '').trim();
    const lastName     = apellido != null ? String(apellido).trim() : null;
    const monto        = Number(valor || 0);
    const reservaInput = String(id_reserva || '').trim();

    // Validación básica
    if (!email || !firstName || !monto || !reservaInput) {
      return cb({ url_factura: '' });
    }

    await client.query('BEGIN');

    // 1) Crear / actualizar usuario SOLO por correo (el bus no usa bookingUserId)
    let uRes = await client.query(
      'SELECT id, nombre, apellido, email FROM usuarios WHERE email=$1 LIMIT 1',
      [email]
    );

    let usuarioId;
    if (uRes.rows.length) {
      usuarioId = uRes.rows[0].id;
      await client.query(
        `UPDATE usuarios
            SET nombre=$1,
                apellido=COALESCE($2, apellido)
          WHERE id=$3`,
        [firstName, lastName, usuarioId]
      );
    } else {
      const ins = await client.query(
        `INSERT INTO usuarios (nombre, apellido, email, rol, estado, creado_en)
         VALUES ($1,$2,$3,'user','activo',NOW())
         RETURNING id`,
        [firstName, lastName, email]
      );
      usuarioId = ins.rows[0].id;
    }

    // 2) Buscar la reserva exacta por id_reserva (puede ser código o id numérico)
    const rRes = await client.query(
      `SELECT id, codigo_reserva
         FROM reservas
        WHERE codigo_reserva = $1
           OR id::text = $1
        LIMIT 1`,
      [reservaInput]
    );
    const reserva = rRes.rows[0] || null;
    if (!reserva) {
      await client.query('ROLLBACK');
      return cb({ url_factura: '' });
    }

    // 3) Asociar la reserva al usuario si aún no lo está
    await client.query(
      `UPDATE reservas
          SET usuario_id = $1
        WHERE id = $2
          AND (usuario_id IS NULL OR usuario_id <> $1)`,
      [usuarioId, reserva.id]
    );

    // 4) Calcular subtotal + IVA a partir de valor (monto total)
    const subtotal = +(monto / 1.12).toFixed(2);
    const iva      = +(monto - subtotal).toFixed(2);
    const total    = monto;

    const codigoFactura =
      'FAC-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-'    + Math.random().toString(36).slice(2, 6).toUpperCase();

    await client.query(
      `INSERT INTO facturas
        (codigo_factura, reserva_id, fecha_emision, subtotal, iva, total, metodo_pago, estado)
       VALUES ($1,$2,NOW(),$3,$4,$5,$6,$7)`,
      [
        codigoFactura,
        reserva.id,
        subtotal,
        iva,
        total,
        'ONLINE',
        'EMITIDA'
      ]
    );

    // 5) URL de la factura (ajusta dominio si hace falta)
    const url = `https://cuenca-travel.com/facturas/${codigoFactura}.pdf`;

    await client.query('COMMIT');
    cb({ url_factura: url });
  } catch (e) {
    console.error('emitirFacturaPaquete SOAP error:', e);
    try { await client.query('ROLLBACK'); } catch {}
    cb({ url_factura: '' });
  } finally {
    client.release();
  }
}

/**
 * crearUsuarioExterno()
 * SOAP: crearUsuarioExternoRequest
 */
async function crearUsuarioExterno(args, cb) {
  const client = await pool.connect();

  // Sacamos los datos de args FUERA del try/catch
  const { bookingUserId, nombre, apellido, correo } = args || {};
  const email = String(correo || '').trim();
  const bookingId = String(bookingUserId || '').trim();
  const firstName = String(nombre || '').trim();
  const lastName = apellido != null ? String(apellido).trim() : null;

  try {
    // ===== Validación mínima =====
    if (!email || !bookingId || !firstName) {
      return cb({
        usuario: {
          id_usuario: 0,
          bookingUserId: bookingId,
          nombre: firstName,
          apellido: lastName,
          correo: email
        }
      });
    }

    await client.query('BEGIN');

    // 1) Buscar por booking_user_id
    let res = await client.query(
      `SELECT id, nombre, apellido, email
         FROM usuarios
        WHERE booking_user_id::text = $1
        LIMIT 1`,
      [bookingId]
    );

    // 2) Si no existe por booking_user_id, buscar por email
    if (!res.rows.length) {
      res = await client.query(
        `SELECT id, nombre, apellido, email
           FROM usuarios
          WHERE email = $1
          LIMIT 1`,
        [email]
      );
    }

    let user;

    if (res.rows.length) {
      // 3) Si ya existe, actualizamos datos básicos y booking_user_id
      user = res.rows[0];

      await client.query(
        `UPDATE usuarios
            SET nombre = $1,
                apellido = COALESCE($2, apellido),
                booking_user_id = $3
          WHERE id = $4`,
        [
          firstName || user.nombre,
          lastName,
          bookingId,
          user.id
        ]
      );
    } else {
      // 4) Si no existe, insertamos un usuario "externo"
      //    IMPORTANTE: damos un valor a password_hash (p.ej. cadena vacía)
    const ins = await client.query(
  `INSERT INTO usuarios
     (nombre,
      apellido,
      email,
      telefono,
      password_hash,
      rol,
      estado,
      booking_user_id,
      creado_en)
   VALUES
     ($1, $2, $3, '0000000000', '', 'user', 'activo', $4, NOW())
   RETURNING id, nombre, apellido, email`,
  [firstName, lastName, email, bookingId]
);


      user = ins.rows[0];
    }

    await client.query('COMMIT');

    // 5) Respuesta OK
    cb({
      usuario: {
        id_usuario: user.id,
        bookingUserId: bookingId,
        nombre: user.nombre,
        apellido: user.apellido,
        correo: user.email
      }
    });
  } catch (e) {
    console.error('crearUsuarioExterno SOAP error:', e);
    try { await client.query('ROLLBACK'); } catch {}

    // 6) En error, devolvemos el usuario “cero” pero con los datos de entrada
    cb({
      usuario: {
        id_usuario: 0,
        bookingUserId: bookingId,
        nombre: firstName,
        apellido: lastName,
        correo: email
      }
    });
  } finally {
    client.release();
  }
}


/**
 * buscarDatosReserva()
 */
async function buscarDatosReserva({ id_reserva }, cb) {
  const client = await pool.connect();
  try {
    const id = String(id_reserva || '').trim();
    if (!id) return cb({ reserva: null });

    const rRes = await client.query(
      `SELECT r.id,
              r.codigo_reserva,
              r.fecha_viaje,
              r.total_usd,
              r.paquete_id,
              p.codigo        AS paquete_codigo,
              p.tipo_actividad AS tipo_actividad,
              p.duracion_dias AS duracion_dias,
              u.email         AS correo
         FROM reservas r
    LEFT JOIN paquetes p ON p.id = r.paquete_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id
        WHERE r.codigo_reserva = $1 OR r.id::text = $1
        LIMIT 1`,
      [id]
    );
    if (!rRes.rows.length) {
      return cb({ reserva: null });
    }

    const r = rRes.rows[0];

    const fRes = await client.query(
      `SELECT codigo_factura
         FROM facturas
        WHERE reserva_id=$1
        ORDER BY id DESC
        LIMIT 1`,
      [r.id]
    );

    let url_factura = '';
    if (fRes.rows.length) {
      const cod = fRes.rows[0].codigo_factura;
      url_factura = `https://cuenca-travel.com/facturas/${cod}.pdf`;
    }

    const reserva = {
      id_reserva:    r.codigo_reserva || String(r.id),
      id_paquete:    r.paquete_codigo || String(r.paquete_id),
      correo:        r.correo || '',
      fecha_inicio:  r.fecha_viaje ? r.fecha_viaje.toISOString().slice(0,10) : '',
      duracion:      r.duracion_dias || 1,
      tipo_actividad: r.tipo_actividad || 'TOUR',
      turistas:      { turista: [] }, // no guardas turistas a nivel detalle, lo dejamos vacío
      valor_pagado:  Number(r.total_usd || 0),
      uri_factura:   url_factura
    };

    cb({ reserva });
  } catch (e) {
    console.error('buscarDatosReserva SOAP error:', e);
    cb({ reserva: null });
  } finally {
    client.release();
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
      buscarPaquetes,
      validarDisponibilidadPaquete,
      crearPreReservaPaquete,
      reservarPaquete,
      emitirFacturaPaquete,
      crearUsuarioExterno,
      buscarDatosReserva
    }
  }
};


/* ==================================================
   ============ Helper para alias .asmx ==============
   ================================================== */

function mountSoapAlias(app, routeBase, wsdlXml, service) {
  app.get(routeBase, (req, res) => {
    if (
      String(req.query.wsdl || '').toLowerCase() === 'true' ||
      req.url.includes('?wsdl')
    ) {
      const addr = `${req.protocol}://${req.get('host')}${routeBase}`;
      return res
        .type('text/xml')
        .send(wsdlXml.replace(/REPLACE_ME_AT_RUNTIME/g, addr));
    }
    res
      .type('text/html')
      .send(
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
    res
      .type('text/xml')
      .send(wsdlXmlRaw.replace(/REPLACE_ME_AT_RUNTIME/g, addr));
  });

  soap.listen(
    app,
    '/soap',
    {
      PaquetesService: {
        PaquetesPort: {
          listarPaquetes: listarPaquetesHandler,
          obtenerDetalle: obtenerDetalleHandler,
          crearReserva: crearReservaHandler
        }
      }
    },
    wsdlXmlRaw
  );

  // Alias estilo .asmx (compatibilidad .NET)
  mountSoapAlias(app, '/WS_GestionPaquetes.asmx', wsdlXmlRaw, servicePaquetes);
  mountSoapAlias(app, '/WS_GestionReservas.asmx', wsdlXmlRaw, serviceReservas);

  // ====== Servicio de Integración con el NUEVO WSDL ======
  const intWSDL = path.join(__dirname, 'integracion.wsdl');
  const intXml  = fs.readFileSync(intWSDL, 'utf8');
  mountSoapAlias(app, '/WS_Integracion.asmx', intXml, serviceIntegracion);
}
