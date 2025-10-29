// routes/auth.js
import express from 'express';
import {
  showLogin,
  login,
  logout,
  showRegister,   // 👈 añade
  register        // 👈 añade
} from '../controllers/authController.js';

const router = express.Router();

// Registro
router.get('/register', showRegister);
router.post('/register', register);

// Login/Logout
router.get('/login', showLogin);
router.post('/login', login);
router.get('/logout', logout);

export default router;
