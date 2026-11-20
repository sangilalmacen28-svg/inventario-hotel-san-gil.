-- Datos de demostración (ejecutar después de schema.sql). Se pueden borrar desde la app.

insert into areas (nombre) values
  ('Cocina'),('Restaurante'),('Bar'),('Ama de llaves'),('Mantenimiento'),
  ('Recepción'),('Administración'),('Recursos humanos'),('Eventos y banquetes'),('Otras áreas')
on conflict do nothing;

insert into proveedores (id, nombre, contacto, telefono, correo, direccion, categoria, estado, observaciones) values
  ('00000000-0000-4000-8000-000000000001','Distribuidora de Alimentos del Bajío','Laura Méndez','442 000 0001','ventas@ejemplo.mx','San Juan del Río, Qro.','Alimentos','Activo',null),
  ('00000000-0000-4000-8000-000000000002','Productos de Limpieza Express','Raúl Ortiz','442 000 0002','contacto@ejemplo.mx','Querétaro, Qro.','Limpieza','Activo',null),
  ('00000000-0000-4000-8000-000000000003','Blancos y Lencería del Centro','Ana Solís','442 000 0003','lenceria@ejemplo.mx','Querétaro, Qro.','Blancos','Activo',null),
  ('00000000-0000-4000-8000-000000000004','Bebidas y Licores Mayoreo','Jorge Ruiz','442 000 0004','bebidas@ejemplo.mx','Celaya, Gto.','Bebidas','Inactivo','Pendiente de renovar contrato')
on conflict do nothing;

insert into productos (codigo, descripcion, categoria, unidad, stock_inicial, punto_reorden, proveedor_id) values
  ('ALM-001','Arroz blanco','Cocina','Kilo',40,15,'00000000-0000-4000-8000-000000000001'),
  ('ALM-002','Aceite vegetal','Cocina','Litro',24,10,'00000000-0000-4000-8000-000000000001'),
  ('ALM-003','Café molido','Restaurante','Paquete',12,6,'00000000-0000-4000-8000-000000000001'),
  ('LIM-001','Detergente multiusos','Ama de llaves','Litro',30,12,'00000000-0000-4000-8000-000000000002'),
  ('LIM-002','Desinfectante','Ama de llaves','Litro',18,8,'00000000-0000-4000-8000-000000000002'),
  ('LIM-003','Cloro','Ama de llaves','Litro',4,10,'00000000-0000-4000-8000-000000000002'),
  ('LIM-004','Bolsas para basura','Mantenimiento','Paquete',20,5,'00000000-0000-4000-8000-000000000002'),
  ('BLA-001','Toalla de baño','Ama de llaves','Pieza',60,20,'00000000-0000-4000-8000-000000000003'),
  ('BLA-002','Sábana matrimonial','Ama de llaves','Pieza',35,15,'00000000-0000-4000-8000-000000000003'),
  ('BEB-001','Refresco 355 ml','Bar','Caja',14,6,'00000000-0000-4000-8000-000000000004'),
  ('BEB-002','Agua mineral 1 L','Restaurante','Caja',8,6,null)
on conflict do nothing;
