import { crearReserva } from '../models/Reserva.js'; import { getPaqueteByCodigo } from '../models/Paquete.js';
export async function checkout(req,res){ const { codigo, fecha, adultos, ninos } = req.body;
  const a=Math.max(1,parseInt(adultos||'1',10)); const k=Math.max(0,parseInt(ninos||'0',10));
  const p = await getPaqueteByCodigo(codigo); if(!p) return res.status(400).send('Paquete inválido');
  const out = await crearReserva({ codigo, usuarioId:req.user?.id ?? null, fechaViaje:fecha, adultos:a, ninos:k, total:0 });
  if(!out.ok) return res.status(400).send('No se pudo crear la reserva: ' + out.error);
  res.render('comprobante', { total: out.total, adultos:a, ninos:k, fecha, titulo: out.titulo, codigoReserva: out.codigoReserva }); }
