// middleware/admin.js
export function requireAdmin(req, res, next) {
  const user = req.user || res.locals.user || null;
  if (!user) {
    const next = encodeURIComponent('/admin');
    return res.redirect(`/login?msg=${encodeURIComponent('Debes iniciar sesión')}&next=${next}`);
  }
  if (String(user.rol || '').toLowerCase() !== 'admin') {
    return res.status(403).send('Acceso restringido para administradores.');
  }
  next();
}
export default requireAdmin;   // ⬅️ importante
