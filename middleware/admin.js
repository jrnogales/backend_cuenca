// middleware/admin.js
export function requireAdmin(req, res, next) {
  const user = req.user || res.locals.user || null;

  if (!user) {
    // sin login → al login con retorno a /admin
    return res.redirect('/login?next=/admin&msg=' + encodeURIComponent('Debes iniciar sesión'));
  }

  // rol debe ser 'admin'
  if (String(user.rol || '').toLowerCase() !== 'admin') {
    return res.status(403).send('Acceso restringido para administradores.');
  }

  next();
}

// opcional: también como export default para compatibilidad
export default requireAdmin;
