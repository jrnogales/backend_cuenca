// routes/admin.js
import express from 'express';
import { requireAdmin } from '../middleware/roles.js';
import {
  dashboard,
  listReservas,
  listFacturas,
  showFactura,
  listPaquetes,
  savePaquete,
  deletePaquete,
  listUsuarios,
  updateUsuarioRol
} from '../controllers/adminController.js';

const router = express.Router();

// Dashboard
router.get('/admin', requireAdmin, dashboard);

// Reservas
router.get('/admin/reservas', requireAdmin, listReservas);

// Facturas
router.get('/admin/facturas', requireAdmin, listFacturas);
router.get('/admin/facturas/:id', requireAdmin, showFactura);

// Paquetes
router.get('/admin/paquetes', requireAdmin, listPaquetes);
router.post('/admin/paquetes/save', requireAdmin, savePaquete);

// 🔥 ESTA RUTA ES LA QUE TE FALTABA
router.post('/admin/paquetes/delete/:id', requireAdmin, deletePaquete);

// Usuarios
router.get('/admin/usuarios', requireAdmin, listUsuarios);
router.post('/admin/usuarios/:id/rol', requireAdmin, updateUsuarioRol);

export default router;
