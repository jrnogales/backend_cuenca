// middleware/admin.js
export function isAdmin(req, res, next) {
  if (!req.user) {
    return res.redirect('/login?msg=Debes iniciar sesión como administrador');
  }
  if (req.user.rol !== 'admin') {
    return res.status(403).send('Acceso denegado: solo administradores.');
  }
  next();
}
