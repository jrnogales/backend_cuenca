// controllers/authController.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmail } from '../models/Usuario.js';

/** GET /register */
export async function showRegister(req, res) {
  res.render('register', { title: 'Crear cuenta', error: null });
}

/** GET /login  (acepta ?msg= y ?next=) */
export async function showLogin(req, res) {
  res.render('login', {
    title: 'Ingresar',
    query: { msg: req.query.msg || '', next: req.query.next || '/' },
    error: null,
  });
}

/** POST /register */
export async function register(req, res) {
  try {
    const { nombre, email, telefono, password } = req.body;

    if (!nombre || !email || !password) {
      return res.render('register', {
        title: 'Crear cuenta',
        error: 'Completa nombre, email y contraseña.',
      });
    }

    const exists = await findUserByEmail(email);
    if (exists) {
      return res.render('register', {
        title: 'Crear cuenta',
        error: 'Ya existe un usuario con ese email.',
      });
    }

    // Tu modelo createUser ya hace el hash internamente
    await createUser({ nombre, email, telefono, password });
    return res.redirect('/login?msg=Cuenta creada. Inicia sesión.');
  } catch (e) {
    return res.render('register', {
      title: 'Crear cuenta',
      error: 'Error al registrar: ' + e.message,
    });
  }
}

/** POST /login */
export async function login(req, res) {
  try {
    const { email, password, next } = req.body;

    const u = await findUserByEmail(email);
    if (!u) {
      return res.render('login', {
        title: 'Ingresar',
        error: 'Usuario/contraseña inválidos.',
        query: { msg: '', next: next || '/' },
      });
    }

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      return res.render('login', {
        title: 'Ingresar',
        error: 'Usuario/contraseña inválidos.',
        query: { msg: '', next: next || '/' },
      });
    }

    const token = jwt.sign(
      { id: u.id, nombre: u.nombre, email: u.email },
      process.env.JWT_SECRET,
      { expiresIn: '2d' }
    );

    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    return res.redirect(next || '/');
  } catch (e) {
    return res.render('login', {
      title: 'Ingresar',
      error: 'Error al iniciar sesión: ' + e.message,
      query: { msg: '', next: '/' },
    });
  }
}

/** GET /logout */
export function logout(req, res) {
  res.clearCookie('token');
  res.redirect('/login?msg=Sesión finalizada');
}
