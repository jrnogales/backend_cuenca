// controllers/paqueteController.js
import { listPaquetes, getPaqueteByCodigo } from '../models/Paquete.js';

export async function home(req, res) {
  try {
    const paquetes = await listPaquetes();
    // Enviamos siempre title y error para que EJS no falle
    res.render('index', {
      title: 'Explorar paquetes',
      paquetes,
      error: null
    });
  } catch (e) {
    res.render('index', {
      title: 'Explorar paquetes',
      paquetes: [],
      error: e.message || 'No se pudo cargar los paquetes'
    });
  }
}

export async function detalle(req, res) {
  try {
    const paquete = await getPaqueteByCodigo(req.params.codigo);
    if (!paquete) return res.status(404).send('Paquete no encontrado');

    const precioAdulto = Number(paquete.precio_adulto);
    const precioNino   = Number(paquete.precio_nino);
    const today        = new Date().toISOString().slice(0, 10);

    res.render('detalle', {
      title: paquete.titulo || 'Detalle del paquete',
      paquete: {
        codigo: paquete.codigo,
        titulo: paquete.titulo,
        descripcion: paquete.descripcion,
        imagen: paquete.imagen || 'cuenca1.png',
        stock: paquete.stock,
        precioAdulto,
        precioNino
      },
      minDate: today
    });
  } catch (e) {
    res.status(500).send('Error al cargar el paquete: ' + e.message);
  }
}
