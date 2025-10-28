// routes/admin.js
import express from 'express';
import requireAdmin from '../middleware/admin.js';
import { dashboard, listReservas, listFacturas } from '../controllers/adminController.js';

const router = express.Router();

// Panel
router.get('/admin', requireAdmin, dashboard);

// Listas
router.get('/admin/reservas', requireAdmin, listReservas);
router.get('/admin/facturas', requireAdmin, listFacturas);

export default router;
