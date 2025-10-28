// controllers/authController.js
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createUser, findUserByEmail } from '../models/Usuario.js';

/** GET /register */
export async function showRegister(req, res) {
  res.render('register', {
    title: 'Crear cuenta',
    error: null,
    // valores para “sticky form”
    nombre: '',
    apellido: '',
    cedula: '',
    email: '',
    telefono: ''
  });
}

/** GET /login  (acepta ?msg= y ?next=) */
export async function showLogin(req, res) {
  res.render('login', {
    title: 'Ingresar',
    query: { msg: req.query.msg || '', next: req.query.next || '/' },
    error: null,
  });
}

/** Helper: validar cédula ecuatoriana (módulo 10) */
function validarCedulaEc(cedula) {
  const s = String(cedula || '').trim();
  if (!/^\d{10}$/.test(s)) return false;
  const prov = parseInt(s.slice(0, 2), 10);
  if (prov < 1 || prov > 24) return false;
  const d = s.split('').map(n => parseInt(n, 10));
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = d[i];
    if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9; }
    suma += v;
  }
  const ver = (10 - (suma % 10)) % 10;
  return ver === d[9];
}

/** POST /register */
export async function register(req, res) {
  try {
    const { nombre, apellido, cedula, email, telefono, password } = req.body;

    const renderError = (msg) => res.render('register', {
      title: 'Crear cuenta',
      error: msg,
      nombre, apellido, cedula, email, telefono
    });

    if (!nombre || !apellido || !cedula || !email || !password) {
      return renderError('Completa nombre, apellido, cédula, email y contraseña.');
    }
    if (String(password).length < 6) {
      return renderError('La contraseña debe tener al menos 6 caracteres.');
    }
    if (!validarCedulaEc(cedula)) {
      return renderError('La cédula ingresada no es válida (10 dígitos correctos).');
    }

    const exists = await findUserByEmail(email);
    if (exists) {
      return renderError('Ya existe un usuario con ese email.');
    }

    // Tu modelo createUser ya hace el hash internamente
    await createUser({ nombre, apellido, cedula, email, telefono, password });

    return res.redirect('/login?msg=Cuenta creada. Inicia sesión.');
  } catch (e) {
    return res.render('register', {
      title: 'Crear cuenta',
      error: 'Error al registrar: ' + e.message,
      ...req.body
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
      {
        id: u.id,
        nombre: u.nombre,
        apellido: u.apellido || '',
        cedula: u.cedula || '',
        email: u.email
      },
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
