// src/soap/server.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import soap from 'soap';

import checkoutRoutes from '../routes/checkout.js';



// Modelos y lógica de negocio
import { listPaquetes, getPaqueteByCodigo } from '../models/Paquete.js';
// 👇 Import correcto: usar la función que ya crea reservas en tu controlador
import { crearReserva } from '../controllers/checkoutController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export function attachSoap(app) {
  // Carga WSDL
  const wsdlPath = path.join(__dirname, 'paquetes.wsdl');
  const wsdlXml  = fs.readFileSync(wsdlPath, 'utf8');

  // Implementación del servicio SOAP
  const service = {
    PaquetesService: {
      PaquetesPort: {
        // Lista resumida para el BUS
        async listarPaquetes(_, cb) {
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
        },

        // Detalle de un paquete
        async obtenerDetalle(args, cb) {
          try {
            const p = await getPaqueteByCodigo(args.codigo);
            if (!p) return cb({});
            cb({
              codigo:      p.codigo,
              titulo:      p.titulo,
              descripcion: p.descripcion,
              adultPrice:  p.precio_adulto,
              childPrice:  p.precio_nino,
              stock:       p.stock
            });
          } catch (e) {
            cb({});
          }
        },

        // Crear reserva (bloquea cupos y devuelve código)
        async crearReserva(args, cb) {
          try {
            const a = Math.max(1, parseInt(args.adultos ?? '1', 10));
            const k = Math.max(0, parseInt(args.ninos   ?? '0', 10));

            const out = await crearReserva({
              codigo:     args.codigo,
              usuarioId:  null,            // viene del BUS
              fechaViaje: args.fecha,
              adultos:    a,
              ninos:      k,
              total:      0                // lo calcula el controlador con precios
            });

            cb({
              ok:            out.ok,
              codigoReserva: out.codigoReserva || '',
              mensaje:       out.ok ? '' : out.error
            });
          } catch (e) {
            cb({ ok: false, codigoReserva: '', mensaje: e.message });
          }
        }
      }
    }
  };

  // Exponer WSDL con la URL real del host (Render/localhost)
  app.get('/soap/paquetes.wsdl', (req, res) => {
    const addr = `${req.protocol}://${req.get('host')}/soap`;
    res
      .type('text/xml')
      .send(wsdlXml.replace('REPLACE_ME_AT_RUNTIME', addr));
  });

  // Montar el endpoint SOAP
  soap.listen(app, '/soap', service, wsdlXml);
}
