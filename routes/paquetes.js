import express from 'express';
import { home, detalle } from '../controllers/paqueteController.js';
const router = express.Router();

router.get('/', home);
router.get('/paquetes/:codigo', detalle);

export default router;
