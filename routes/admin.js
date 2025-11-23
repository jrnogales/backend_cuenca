// routes/admin.js
import express from 'express';
import { requireAdmin } from '../middleware/roles.js';
import {
  dashboard,
  listReservas,
  listFacturas,
  showFactura,
  // Gestión
  listPaquetes, savePaquete, deletePaquete,
  listDisponibilidad, upsertDisponibilidad,
  listUsuarios, updateUsuarioRol,
} from '../controllers/adminController.js';

const router = express.Router();

// Dashboard + secciones
router.get('/admin', requireAdmin, dashboard);

router.get('/admin/reservas',   requireAdmin, listReservas);
router.get('/admin/facturas',   requireAdmin, listFacturas);
router.get('/admin/facturas/:id', requireAdmin, showFactura);

router.get('/admin/paquetes',   requireAdmin, listPaquetes);
router.post('/admin/paquetes/save', requireAdmin, savePaquete);


router.get('/admin/usuarios',   requireAdmin, listUsuarios);
router.post('/admin/usuarios/:id/rol', requireAdmin, updateUsuarioRol);
router.post('/admin/paquetes/delete/:id', requireAdmin, deletePaquete);


export default router;
