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
    `SELECT id, codigo, titulo, descripcion, imagen,
            precio_adulto, precio_nino
       FROM paquetes
      ORDER BY id DESC`
  );
  res.render('admin/paquetes', { title: 'Paquetes', paquetes: rows });
}

export async function savePaquete(req, res) {
  try {
    const { id, codigo, titulo, descripcion, imagen, precio_adulto, precio_nino } = req.body;

    // 🔒 Validación: nunca permitir números negativos
    const precioAdulto = Math.max(0, Number(precio_adulto || 0));
    const precioNino   = Math.max(0, Number(precio_nino   || 0));

    if (id) {
      // EDITAR
      await pool.query(
        `UPDATE paquetes
            SET codigo=$1,
                titulo=$2,
                descripcion=$3,
                imagen=$4,
                precio_adulto=$5,
                precio_nino=$6
          WHERE id=$7`,
        [codigo, titulo, descripcion, imagen, precioAdulto, precioNino, id]
      );
    } else {
      // NUEVO — stock automático, ya NO se usa
      await pool.query(
        `INSERT INTO paquetes
           (codigo, titulo, descripcion, imagen,
            precio_adulto, precio_nino, stock)
         VALUES ($1,$2,$3,$4,$5,$6,30)`,
        [codigo, titulo, descripcion, imagen, precioAdulto, precioNino]
      );
    }

    res.redirect('/admin/paquetes');
  } catch (e) {
    console.error(e);
    res.status(500).send('No se pudo guardar el paquete: ' + e.message);
  }
}

/* ================= Eliminar Paquete ================= */
export async function deletePaquete(req, res) {
  try {
    const { id } = req.params;

    // elimina disponibilidad, carrito y reservas asociadas
    await pool.query(`DELETE FROM disponibilidad WHERE paquete_id = $1`, [id]);
    await pool.query(`DELETE FROM carrito WHERE paquete_id = $1`, [id]);

    // No eliminamos reservas ya emitidas (por integridad), solo el paquete
    await pool.query(`DELETE FROM paquetes WHERE id = $1`, [id]);

    res.redirect('/admin/paquetes');
  } catch (e) {
    console.error(e);
    res.status(500).send("No se pudo eliminar el paquete: " + e.message);
  }
}



/* ================= Usuarios ================= */
export async function listUsuarios(req, res) {
  const { rows } = await pool.query(
    `SELECT id, nombre, apellido, email, rol, cedula, telefono, estado
     FROM usuarios ORDER BY id DESC`
  );
  res.render('admin/usuarios', { title: 'Usuarios', usuarios: rows });
}

export async function updateUsuarioRol(req, res) {
  const { id } = req.params;
  const { rol, estado } = req.body;

  await pool.query(
    `UPDATE usuarios SET rol = $1, estado = $2 WHERE id = $3`,
    [rol, estado, id]
  );

  res.redirect('/admin/usuarios');
}
