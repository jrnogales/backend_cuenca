// routes/checkout.js
import express from 'express';
import { showCheckout, crearReserva } from '../controllers/checkoutController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Mostrar la vista del checkout de un paquete (opcional)
router.get('/:codigo', showCheckout);

// Crear la reserva (POST desde formulario o AJAX)
router.post('/', crearReserva);


export default router;
