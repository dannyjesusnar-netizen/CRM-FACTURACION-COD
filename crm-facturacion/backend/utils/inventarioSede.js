// Motivos por los que "Borrar inventario de sede" conserva un producto en
// el catálogo en vez de borrarlo por completo (ver routes/empresa.js). Se
// extrajo a un módulo aparte para que tanto el borrado real como la vista
// previa de solo lectura usen exactamente la misma lógica — así el reporte
// que ve Gerencia antes de confirmar coincide 100% con lo que de verdad va
// a pasar.
function crearVerificadorHistorial(db) {
  const checks = [
    { motivo: 'Tiene stock en otra sede', usaSede: true, stmt: db.prepare('SELECT 1 FROM sucursal_stock WHERE product_id = ? AND sucursal_id != ? LIMIT 1') },
    { motivo: 'Tiene movimientos de inventario en otra sede', usaSede: true, stmt: db.prepare('SELECT 1 FROM stock_movements WHERE product_id = ? AND (sucursal_id IS NULL OR sucursal_id != ?) LIMIT 1') },
    { motivo: 'Tiene ventas (boleta/factura/nota de crédito) registradas', usaSede: false, stmt: db.prepare('SELECT 1 FROM invoice_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Tiene notas de venta interna registradas', usaSede: false, stmt: db.prepare('SELECT 1 FROM nota_venta_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Tiene compras registradas', usaSede: false, stmt: db.prepare('SELECT 1 FROM purchase_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Tiene órdenes de compra/servicio registradas', usaSede: false, stmt: db.prepare('SELECT 1 FROM purchase_order_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Tiene cotizaciones registradas', usaSede: false, stmt: db.prepare('SELECT 1 FROM cotizacion_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Aparece en guías de remisión', usaSede: false, stmt: db.prepare('SELECT 1 FROM guia_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Tiene traslados entre sedes registrados', usaSede: false, stmt: db.prepare('SELECT 1 FROM traslado_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Es insumo de una receta/producción', usaSede: false, stmt: db.prepare('SELECT 1 FROM receta_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Es el producto de salida de una receta/producción', usaSede: false, stmt: db.prepare('SELECT 1 FROM recetas WHERE product_id_salida = ? LIMIT 1') },
    { motivo: 'Tiene promociones/combos configurados', usaSede: false, stmt: db.prepare('SELECT 1 FROM promocion_items WHERE product_id = ? LIMIT 1') },
    { motivo: 'Es parte de una promoción', usaSede: false, stmt: db.prepare('SELECT 1 FROM promociones WHERE product_id = ? LIMIT 1') },
  ];

  // Devuelve la lista de motivos por los que este producto NO se borraría
  // por completo al limpiar sucursalId — un arreglo vacío significa que sí
  // se borraría (sin rastro fuera de esa sede, sin historial real en
  // ningún lado).
  return function motivosDeConservacion(productId, sucursalId) {
    const motivos = [];
    for (const c of checks) {
      const encontrado = c.usaSede ? c.stmt.get(productId, sucursalId) : c.stmt.get(productId);
      if (encontrado) motivos.push(c.motivo);
    }
    return motivos;
  };
}

module.exports = { crearVerificadorHistorial };
