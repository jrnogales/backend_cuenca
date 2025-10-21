import jwt from 'jsonwebtoken';
export function requireAuth(req,res,next){ try{ const t=req.cookies?.token; if(!t) return res.redirect('/login'); const d=jwt.verify(t,process.env.JWT_SECRET); req.user=d; next(); }catch(e){ return res.redirect('/login'); } }
export function attachUser(req,res,next){ try{ const t=req.cookies?.token; if(t){ const d=jwt.verify(t,process.env.JWT_SECRET); req.user=d; res.locals.user=d; } }catch(e){} next(); }

// ... tu attachUser arriba

// Requiere usuario autenticado; si no, redirige a /login con msg y next
export function requireAuth(req, res, next) {
  if (req.user) return next();

  const nextUrl =
    req.method === 'GET'
      ? req.originalUrl
      : (req.get('referer') || '/');

  const msg = encodeURIComponent('Debes iniciar sesión para continuar.');
  return res.redirect(`/login?msg=${msg}&next=${encodeURIComponent(nextUrl)}`);
}
