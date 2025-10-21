// controllers/authController.js
import { createUser, findUserByEmail } from '../models/Usuario.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export async function showRegister(req, res) {
  res.render('register', { title: 'Registrarse' });
}

export async function register(req, res) {
  const { nombre, email, telefono, password } = req.body;
  try {
    const exists = await findUserByEmail(email);
    if (exists) return res.render('register', { title: 'Registrarse', error: 'Ya existe un usuario con ese email.' });
    await createUser({ nombre, email, telefono, password });
    return res.redirect('/login');
  } catch (e) {
    return res.render('register', { title: 'Registrarse', error: 'Error al registrar: ' + e.message });
  }
}

// GET /login
export function showLogin(req, res) {
  res.render('login', {
    title: 'Ingresar',
    query: { msg: req.query.msg || '', next: req.query.next || '/' }
  });
}

// POST /login
export async function login(req, res) {
  const { email, password, next: nextBody } = req.body;
  const nextUrl = nextBody || req.query.next || '/';

  const u = await findUserByEmail(email);
  if (!u) return res.render('login', { title: 'Ingresar', error: 'Usuario/contraseña inválidos.', query: { next: nextUrl } });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.render('login', { title: 'Ingresar', error: 'Usuario/contraseña inválidos.', query: { next: nextUrl } });

  const token = jwt.sign({ id: u.id, nombre: u.nombre, email: u.email }, process.env.JWT_SECRET, { expiresIn: '2d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  return res.redirect(nextUrl);
}

export function logout(req, res) {
  res.clearCookie('token');
  res.redirect('/login');
}
