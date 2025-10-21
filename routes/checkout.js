// routes/checkoutRoutes.js
import express from 'express';
import {
  showCheckout,
  crearReserva,
  cancelarReserva
} from '../controllers/checkoutController.js';

const router = express.Router();

/**
 * 🧭 Mostrar el checkout (detalle) de un paquete
 * Ejemplo: GET /checkout/CODIGO123
 */
router.get('/:codigo', showCheckout);

/**
 * 🧾 Crear una nueva reserva
 * Ejemplo: POST /checkout
 */
router.post('/', crearReserva);

/**
 * ❌ Cancelar una reserva existente
 * Ejemplo: POST /checkout/cancelar/RES-20251019-ABCD
 */
router.post('/cancelar/:codigo', cancelarReserva);

export default router;
