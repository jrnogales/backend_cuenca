// src/soap/server.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import soap from 'soap';

import { listPaquetes, getPaqueteByCodigo } from '../models/Paquete.js';
import { pool } from '../config/db.js'; // para crearReserva con DB

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== Handlers reutilizables ==========
async function listarPaquetesHandler(_, cb) {
  try {
    const data = await listPaquetes();
    const paquete = data.map(p => ({
      packageId:   p.codigo,
      packageName: p.titulo,
      adultPrice:  p.precio_adulto,
      childPrice:  p.precio_nino,
      stock:       p.stock
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
      codigo:     p.codigo,
      titulo:     p.titulo,
      descripcion:p.descripcion,
      adultPrice: p.precio_adulto,
      childPrice: p.precio_nino,
      stock:      p.stock
    });
  } catch (e) {
    cb({});
  }
}

async function crearReservaHandler(args, cb) {
  try {
    // Validaciones mínimas
    const a = Math.max(1, parseInt(args.adultos || '1', 10));
    const k = Math.max(0, parseInt(args.ninos   || '0', 10));
    const codigo = String(args.codigo || '').trim();
    const fecha  = String(args.fecha  || '').trim();
    if (!codigo || !fecha) {
      return cb({ ok: false, codigoReserva: '', mensaje: 'Datos incompletos' });
    }

    // Verificar paquete / stock
    const pRes = await pool.query('SELECT * FROM paquetes WHERE codigo=$1 LIMIT 1', [codigo]);
    const p = pRes.rows[0];
    if (!p) return cb({ ok: false, codigoReserva: '', mensaje: 'Paquete no encontrado' });

    const solicitados = a + k;
    if (p.stock < solicitados) {
      return cb({ ok: false, codigoReserva: '', mensaje: `Stock insuficiente (${p.stock})` });
    }

    // Calcular total
    const total = a * Number(p.precio_adulto) + k * Number(p.precio_nino);

    const code =
      'RES-' +
      new Date().toISOString().slice(0, 10).replace(/-/g, '') +
      '-' +
      Math.random().toString(36).slice(2, 6).toUpperCase();

    await pool.query(
      `INSERT INTO reservas
         (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, origen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'SOAP')`,
      [code, p.id, null, fecha, a, k, total]
    );

    await pool.query('UPDATE paquetes SET stock = stock - $1 WHERE id = $2', [solicitados, p.id]);

    cb({ ok: true, codigoReserva: code, mensaje: '' });
  } catch (e) {
    cb({ ok: false, codigoReserva: '', mensaje: e.message });
  }
}

// ========== Servicios (divididos por alias .asmx) ==========
const servicePaquetes = {
  PaquetesService: {
    PaquetesPort: {
      listarPaquetes:  listarPaquetesHandler,
      obtenerDetalle:  obtenerDetalleHandler
    }
  }
};

const serviceReservas = {
  ReservasService: {
    ReservasPort: {
      crearReserva:    crearReservaHandler
    }
  }
};

// ========== Helper para montar un alias .asmx ==========
function mountSoapAlias(app, routeBase, wsdlXml, service) {
  // ?wsdl como en .asmx
  app.get(`${routeBase}`, (req, res) => {
    // Si viene ?wsdl devolvemos el WSDL; si no, damos una página mínima informativa
    if (String(req.query.wsdl || '').toLowerCase() === 'true' || req.url.includes('?wsdl')) {
      const addr = `${req.protocol}://${req.get('host')}${routeBase}`;
      res.type('text/xml').send(wsdlXml.replace('REPLACE_ME_AT_RUNTIME', addr));
    } else {
      res.type('text/html').send(
        `<h3>SOAP endpoint</h3>
         <p>Endpoint: <code>${routeBase}</code></p>
         <p>WSDL: <a href="${routeBase}?wsdl">${routeBase}?wsdl</a></p>`
      );
    }
  });

  // El listener SOAP en la misma ruta (como .asmx)
  soap.listen(app, routeBase, service, wsdlXml);
}

// ========== Export principal ==========
export function attachSoap(app) {
  const wsdlPath = path.join(__dirname, 'paquetes.wsdl');
  const wsdlXmlRaw = fs.readFileSync(wsdlPath, 'utf8');

  // 1) Rutas originales que ya tenías (/soap/paquetes.wsdl y /soap)
  app.get('/soap/paquetes.wsdl', (req, res) => {
    const addr = `${req.protocol}://${req.get('host')}/soap`;
    res.type('text/xml').send(wsdlXmlRaw.replace('REPLACE_ME_AT_RUNTIME', addr));
  });
  soap.listen(app, '/soap', { PaquetesService: { PaquetesPort: {
    listarPaquetes: listarPaquetesHandler,
    obtenerDetalle: obtenerDetalleHandler,
    crearReserva:   crearReservaHandler
  }}}, wsdlXmlRaw);

  // 2) Alias .asmx (Paquetes: listar/obtener)
  mountSoapAlias(app, '/WS_GestionPaquetes.asmx', wsdlXmlRaw, servicePaquetes);

  // 3) Alias .asmx (Reservas: crear)
  mountSoapAlias(app, '/WS_GestionReservas.asmx', wsdlXmlRaw, serviceReservas);
}
