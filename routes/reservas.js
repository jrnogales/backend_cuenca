import express from 'express';
import { listMine, cancelarMiReserva } from '../controllers/reservasController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.get('/mis-reservas', requireAuth, listMine);
router.post('/reservas/:codigo/cancelar', requireAuth, cancelarMiReserva);

export default router;
