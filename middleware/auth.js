// middleware/auth.js
import jwt from 'jsonwebtoken';

export function attachUser(req, res, next) {
  const token = req.cookies?.token;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      req.user = null;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();

  const wantsJSON =
    req.xhr ||
    (req.headers.accept || '').includes('application/json') ||
    req.path.startsWith('/cart/');

  const redirectTo = '/login?msg=Debes iniciar sesión&next=' +
    encodeURIComponent(req.originalUrl || '/');

  if (wantsJSON) {
    return res
      .status(401)
      .json({ ok: false, needLogin: true, redirect: redirectTo });
  }

  return res.redirect(redirectTo);
}
