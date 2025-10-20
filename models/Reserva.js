import { pool } from '../config/db.js';
export async function crearReserva({codigo,usuarioId,fechaViaje,adultos,ninos,total}){
  const client = await pool.connect();
  try{
    await client.query('BEGIN');
    const pkg = await client.query('SELECT id, stock, titulo, precio_adulto, precio_nino FROM paquetes WHERE codigo=$1',[codigo]);
    if(!pkg.rowCount) throw new Error('Paquete no encontrado');
    const p = pkg.rows[0]; const pax = adultos + ninos; if(p.stock < pax) throw new Error('Stock insuficiente');
    const subtotal = adultos*p.precio_adulto + ninos*p.precio_nino; const iva = Math.round(subtotal*0.12*100)/100.0; const totalCalc = Math.round((subtotal+iva)*100)/100.0;
    const code = 'RES-' + Date.now().toString(36).toUpperCase();
    await client.query(`INSERT INTO reservas (codigo_reserva, paquete_id, usuario_id, fecha_viaje, adultos, ninos, total_usd, estado, origen) VALUES ($1,$2,$3,$4,$5,$6,$7,'CONFIRMADA','WEB')`,
      [code, p.id, usuarioId, fechaViaje, adultos, ninos, totalCalc]);
    await client.query('UPDATE paquetes SET stock = stock - $1 WHERE id=$2',[pax,p.id]);
    await client.query('COMMIT'); return { ok:true, codigoReserva: code, titulo: p.titulo, total: totalCalc };
  }catch(e){ await client.query('ROLLBACK'); return { ok:false, error:e.message }; } finally{ client.release(); }
}
