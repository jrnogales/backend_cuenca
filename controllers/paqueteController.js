// controllers/paqueteController.js
import { listPaquetes, getPaqueteByCodigo } from '../models/Paquete.js';

/**
 * Página principal con lista de paquetes
 */
export async function home(req, res) {
  try {
    const paquetes = await listPaquetes();
    res.render('index', {
      title: 'Explorar paquetes',
      paquetes,
      error: null,
    });
  } catch (e) {
    res.render('index', {
      title: 'Explorar paquetes',
      paquetes: [],
      error: e.message || 'No se pudo cargar los paquetes',
    });
  }
}

/**
 * Detalle de un paquete específico
 */
export async function detalle(req, res) {
  try {
    const paquete = await getPaqueteByCodigo(req.params.codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const precioAdulto = Number(paquete.precio_adulto);
    const precioNino   = Number(paquete.precio_nino);

    // --- NUEVO: calcula la fecha mínima (hoy) respetando zona horaria local ---
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    const minDate = today.toISOString().slice(0, 10);

    res.render('detalle', {
      title: paquete.titulo || 'Detalle del paquete',
      paquete: {
        codigo: paquete.codigo,
        titulo: paquete.titulo,
        descripcion: paquete.descripcion,
        imagen: paquete.imagen || 'noimg.jpg',
        stock: paquete.stock,
        precioAdulto,
        precioNino,
      },
      minDate, // se usa en el <input type="date" min="<%= minDate %>" >
    });
  } catch (e) {
    res.status(500).send('Error al cargar el paquete: ' + e.message);
  }
}
