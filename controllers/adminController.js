// controllers/adminController.js
import { pool } from '../config/db.js';

/* ================= Dashboard ================= */
export async function dashboard(req, res) {
  try {
    const q = `
      SELECT
        (SELECT COUNT(*) FROM reservas) AS reservas,
        (SELECT COUNT(*) FROM facturas WHERE estado='EMITIDA') AS facturas,
        (SELECT COALESCE(SUM(total),0) FROM facturas WHERE estado='EMITIDA') AS ventas
    `;
    const { rows } = await pool.query(q);
    const stats = rows[0] || { reservas: 0, facturas: 0, ventas: 0 };

    res.render('admin/dashboard', {
      title: 'Panel de Administración',
      stats
    });
  } catch (e) {
    res.status(500).send('Error cargando dashboard: ' + e.message);
  }
}

/* ================= Reservas ================= */
export async function listReservas(req, res) {
  const q = `
    SELECT r.*, p.titulo, u.email
    FROM reservas r
    LEFT JOIN paquetes p ON p.id = r.paquete_id
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    ORDER BY r.id DESC
  `;
  const { rows } = await pool.query(q);
  res.render('admin/reservas', { title: 'Reservas', reservas: rows });
}

/* ================= Facturas ================= */
export async function listFacturas(req, res) {
  const q = `
    SELECT f.id, f.codigo_factura, r.codigo_reserva, f.fecha_emision,
           f.subtotal, f.iva, f.total, f.metodo_pago, f.estado
    FROM facturas f
    LEFT JOIN reservas r ON r.id = f.reserva_id
    ORDER BY f.id DESC
  `;
  const { rows } = await pool.query(q);
  res.render('admin/facturas', { title: 'Facturas', facturas: rows });
}

export async function showFactura(req, res) {
  const { id } = req.params;
  const qH = `
    SELECT f.*, r.codigo_reserva, r.fecha_viaje, r.adultos, r.ninos,
           u.nombre, u.apellido, u.email, u.cedula,
           p.titulo AS paquete_titulo
    FROM facturas f
    LEFT JOIN reservas  r ON r.id = f.reserva_id
    LEFT JOIN usuarios  u ON u.id = r.usuario_id
    LEFT JOIN paquetes  p ON p.id = r.paquete_id
    WHERE f.id = $1
    LIMIT 1
  `;
  const qD = `SELECT descripcion, cantidad, precio_unitario, total_linea
              FROM detalle_factura WHERE factura_id = $1 ORDER BY id`;
  const { rows: head } = await pool.query(qH, [id]);
  if (!head.length) return res.status(404).send('Factura no encontrada');
  const { rows: det } = await pool.query(qD, [id]);

  res.render('admin/factura-show', {
    title: `Factura ${head[0].codigo_factura}`,
    f: head[0], det
  });
}

/* ================= Paquetes ================= */
export async function listPaquetes(req, res) {
  const { rows } = await pool.query(
    `SELECT id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, stock
     FROM paquetes ORDER BY id DESC`
  );
  res.render('admin/paquetes', { title: 'Paquetes', paquetes: rows });
}

export async function savePaquete(req, res) {
  const { id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, stock } = req.body;
  if (id) {
    await pool.query(
      `UPDATE paquetes SET codigo=$1, titulo=$2, descripcion=$3, imagen=$4,
              precio_adulto=$5, precio_nino=$6, stock=$7
       WHERE id=$8`,
      [codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, stock, id]
    );
  } else {
    await pool.query(
      `INSERT INTO paquetes (codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [codigo, titulo, descripcion, imagen, precio_adulto, precio_nino, stock]
    );
  }
  res.redirect('/admin/paquetes');
}

/* ============== Disponibilidad (por día) ============== */
export async function listDisponibilidad(req, res) {
  const paquetes = (await pool.query(
    `SELECT id, codigo, titulo FROM paquetes ORDER BY titulo`)).rows;

  const disp = (await pool.query(
    `SELECT d.id, d.paquete_id, p.titulo, d.fecha, d.cupos_totales, d.cupos_reservados
     FROM disponibilidad d
     JOIN paquetes p ON p.id = d.paquete_id
     ORDER BY d.fecha DESC, p.titulo ASC
     LIMIT 300`
  )).rows;

  res.render('admin/disponibilidad', {
    title: 'Disponibilidad', paquetes, disp
  });
}

export async function upsertDisponibilidad(req, res) {
  const { paquete_id, fecha, cupos_totales } = req.body;
  await pool.query(
    `INSERT INTO disponibilidad (paquete_id, fecha, cupos_totales, cupos_reservados)
     VALUES ($1, $2::date, $3::int, 0)
     ON CONFLICT (paquete_id, fecha)
     DO UPDATE SET cupos_totales = EXCLUDED.cupos_totales`,
    [paquete_id, fecha, cupos_totales]
  );
  res.redirect('/admin/disponibilidad');
}

/* ================= Usuarios ================= */
export async function listUsuarios(req, res) {
  const { rows } = await pool.query(
    `SELECT id, nombre, apellido, email, rol, cedula, telefono
     FROM usuarios ORDER BY id DESC`
  );
  res.render('admin/usuarios', { title: 'Usuarios', usuarios: rows });
}

export async function updateUsuarioRol(req, res) {
  const { id } = req.params;
  const { rol } = req.body;
  await pool.query(`UPDATE usuarios SET rol=$1 WHERE id=$2`, [rol, id]);
  res.redirect('/admin/usuarios');
}
