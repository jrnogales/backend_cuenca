import express from 'express';
import { showCheckout, crearReserva } from '../controllers/checkoutController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/:codigo', showCheckout);
// Si quieres permitir reservar sin login, quita requireAuth temporalmente
router.post('/', /* requireAuth, */ crearReserva);

export default router;

