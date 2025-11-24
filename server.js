// server.js
import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import ejs from 'ejs';
import debugRoutes from './routes/debug.js';

// Rutas
import paquetesRoutes from './routes/paquetes.js';
import authRoutes from './routes/auth.js';
import checkoutRoutes from './routes/checkout.js';
import reservasRoutes from './routes/reservas.js';
import cartRoutes from './routes/cart.js';
import apiRoutes from './routes/api.js';
import adminRoutes from './routes/admin.js'; // <-- panel admin

// Middlewares/servicios
import { attachUser } from './middleware/auth.js';
import { attachSoap } from './soap/server.js';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- Parsers ---------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

/* ---------- Archivos estáticos ---------- */
app.use('/img', express.static(path.join(__dirname, 'public/img')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));
// app.use('/js', express.static(path.join(__dirname, 'public/js')));

/* ---------- Motor de vistas (EJS) con layout ---------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', (file, data, cb) => {
  // mini layout helper: <% layout('partials/layout') %>
  data.layout = function (p) { data._layoutFile = p + '.ejs'; };
  ejs.renderFile(file, data, {}, (err, str) => {
    if (err) return cb(err);
    if (data._layoutFile) {
      ejs.renderFile(
        path.join(__dirname, 'views', data._layoutFile),
        { ...data, body: str },
        {},
        cb
      );
    } else cb(null, str);
  });
});

/* ---------- Contexto de usuario en req y vistas ---------- */
app.use(attachUser);

// Expone siempre `user` y `title` en las vistas
app.use((req, res, next) => {
  let user = req.user || null;

  // Intento extra por si no pasó attachUser
  if (!user) {
    const token = req.cookies?.token;
    if (token) {
      try {
        user = jwt.verify(token, process.env.JWT_SECRET);
      } catch {
        user = null;
      }
    }
  }

  res.locals.user = user;
  if (typeof res.locals.title === 'undefined') res.locals.title = undefined;
  next();
});

/* ---------- Rutas de API (JSON) ---------- */
app.use('/api', apiRoutes);

// 404 JSON para /api
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'Ruta de API no encontrada' });
});

// Manejador de errores JSON para /api (middleware de 4 args)
app.use('/api', (err, req, res, next) => {
  console.error('❌ Error en /api:', err);
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || 'Error interno' });
});

// Rutas de aplicación (vistas)
app.use('/', paquetesRoutes);
app.use('/', authRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/', reservasRoutes);
app.use('/', cartRoutes);
app.use('/', adminRoutes); // ✅ así, con '/'
app.use(debugRoutes);


/* ---------- SOAP (para el BUS) ---------- */
attachSoap(app);

/* ---------- Arranque ---------- */
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`http://localhost:${port}  · WSDL: /soap/paquetes.wsdl`);
});
