import { listPaquetes, getPaqueteByCodigo } from '../models/Paquete.js';
export async function home(req,res){ const paquetes = await listPaquetes(); res.render('index',{ paquetes }); }
export async function detalle(req,res){ const paquete = await getPaqueteByCodigo(req.params.codigo);
  if(!paquete) return res.status(404).send('Paquete no encontrado');
  const precioAdulto = Number(paquete.precio_adulto), precioNino = Number(paquete.precio_nino);
  const today = new Date().toISOString().slice(0,10);
  res.render('detalle', { paquete:{ codigo:paquete.codigo, titulo:paquete.titulo, descripcion:paquete.descripcion, imagen:paquete.imagen||'cuenca1.png', stock:paquete.stock, precioAdulto, precioNino }, minDate: today }); }
