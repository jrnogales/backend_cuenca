// server.js
import express from 'express';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

import paquetesRoutes from './routes/paquetes.js';
import authRoutes from './routes/auth.js';
import checkoutRoutes from './routes/checkout.js';
import { attachUser } from './middleware/auth.js';
import { attachSoap } from './soap/server.js';

import ejs from 'ejs';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Archivos estáticos
app.use('/img', express.static(path.join(__dirname, 'public/img')));
app.use('/css', express.static(path.join(__dirname, 'public/css')));

// Motor de vistas (EJS) + layout simple
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs', (file, data, cb) => {
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

// 1) Adjunta usuario a req (middleware propio, si lo usas)
app.use(attachUser);

// 2) Expone siempre `user` y `title` a todas las vistas (evita "is not defined")
app.use((req, res, next) => {
  // Preferimos el user que pueda haber puesto attachUser
  let user = req.user || null;

  // Si no lo hay, intentamos decodificar cookie `token`
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
  // `title` puede venir desde controladores; aquí dejamos un valor neutro
  if (typeof res.locals.title === 'undefined') res.locals.title = undefined;
  next();
});

// Rutas
app.use('/', paquetesRoutes);
app.use('/', authRoutes);
app.use('/checkout', checkoutRoutes);

// SOAP (para el BUS)
attachSoap(app);

// Arranque
const port = process.env.PORT || 3000;
app.listen(port, () =>
  console.log(`http://localhost:${port}  · WSDL: /soap/paquetes.wsdl`)
);
