// routes/checkout.js
import express from 'express';
import {
  showCheckout,
  crearReserva,
  cancelarReserva,   // ← importa esto también
} from '../controllers/checkoutController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Detalle/checkout del paquete
router.get('/:codigo', showCheckout);

// Crear una nueva reserva (requiere login)
router.post('/', requireAuth, crearReserva);

// Cancelar una reserva por código (si decides permitirlo aquí)
router.post('/cancelar/:codigo', requireAuth, cancelarReserva);

export default router;

