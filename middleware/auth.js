// middleware/auth.js
import jwt from 'jsonwebtoken';

/** Adjunta user si hay cookie token; no bloquea el paso */
export function attachUser(req, res, next) {
  const token = req.cookies?.token;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

/** Protege rutas: si no hay sesión, redirige a /login con msg+next */
export function requireAuth(req, res, next) {
  if (req.user) return next();
  const msg = encodeURIComponent('Debes iniciar sesión para continuar');
  const nextUrl = encodeURIComponent(req.originalUrl || '/');
  return res.redirect(`/login?msg=${msg}&next=${nextUrl}`);
}
