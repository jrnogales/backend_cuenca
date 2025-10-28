import express from 'express';
import { requireAdmin } from '../middleware/roles.js';
import { dashboard, listReservas, listFacturas } from '../controllers/adminController.js';

const router = express.Router();
router.get('/admin', requireAdmin, dashboard);
router.get('/admin/reservas', requireAdmin, listReservas);
router.get('/admin/facturas', requireAdmin, listFacturas);

export default router;
