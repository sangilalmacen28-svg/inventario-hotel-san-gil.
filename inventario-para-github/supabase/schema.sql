-- =====================================================================
-- Hotel Misión San Gil · Sistema de inventarios
-- Esquema para Supabase (PostgreSQL). Ejecutar completo en:
--   Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- PERFILES Y ROLES ----------
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  rol        text not null default 'consulta' check (rol in ('admin','almacen','consulta')),
  created_at timestamptz not null default now()
);

-- Devuelve el rol del usuario que hace la petición (security definer evita recursión en RLS)
create or replace function rol_actual() returns text
language sql stable security definer set search_path = public as $$
  select rol from profiles where id = auth.uid()
$$;

-- Todo usuario nuevo entra como 'consulta'. Solo un administrador puede cambiar roles.
create or replace function crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, nombre, rol)
  values (new.id, split_part(new.email, '@', 1), 'consulta');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function crear_perfil();

-- ---------- CATÁLOGOS ----------
create table if not exists areas (
  nombre text primary key check (length(trim(nombre)) > 0)
);

create table if not exists proveedores (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (length(trim(nombre)) > 0),
  contacto      text,
  telefono      text,
  correo        text,
  direccion     text,
  categoria     text not null default 'General',
  estado        text not null default 'Activo' check (estado in ('Activo','Inactivo')),
  observaciones text,
  created_at    timestamptz not null default now()
);

create table if not exists productos (
  codigo        text primary key check (codigo ~ '^[A-Z0-9-]{2,20}$'),
  descripcion   text not null check (length(trim(descripcion)) > 0),
  categoria     text not null references areas(nombre),
  unidad        text not null,
  stock_inicial numeric not null default 0 check (stock_inicial >= 0),
  punto_reorden numeric not null default 0 check (punto_reorden >= 0),
  proveedor_id  uuid references proveedores(id) on delete set null,
  observaciones text,
  created_at    timestamptz not null default now()
);

-- ---------- MOVIMIENTOS (inmutables: no se editan ni se borran desde la app) ----------
create sequence if not exists folio_entrada_seq;
create sequence if not exists folio_salida_seq;

create table if not exists entradas (
  folio         text primary key default 'E-' || lpad(nextval('folio_entrada_seq')::text, 5, '0'),
  fecha         date not null default current_date,
  proveedor_id  uuid not null references proveedores(id),
  factura       text,
  observaciones text,
  usuario       text not null,
  usuario_id    uuid not null default auth.uid() references profiles(id),
  created_at    timestamptz not null default now()
);

create table if not exists entrada_items (
  id              bigint generated always as identity primary key,
  folio           text not null references entradas(folio) on delete cascade,
  codigo          text not null references productos(codigo),
  cantidad        numeric not null check (cantidad > 0),
  costo_unitario  numeric not null default 0 check (costo_unitario >= 0)
);

create table if not exists salidas (
  folio         text primary key default 'S-' || lpad(nextval('folio_salida_seq')::text, 5, '0'),
  fecha         date not null default current_date,
  area          text not null references areas(nombre),
  requisicion   text not null check (length(trim(requisicion)) > 0),
  recibe        text not null check (length(trim(recibe)) > 0),
  observaciones text,
  usuario       text not null,
  usuario_id    uuid not null default auth.uid() references profiles(id),
  created_at    timestamptz not null default now()
);

create table if not exists salida_items (
  id          bigint generated always as identity primary key,
  folio       text not null references salidas(folio) on delete cascade,
  codigo      text not null references productos(codigo),
  solicitada  numeric not null check (solicitada >= 0),
  entregada   numeric not null check (entregada > 0)
);

-- ---------- EXISTENCIAS CALCULADAS (stock = inicial + entradas - salidas) ----------
create or replace view v_stock with (security_invoker = true) as
select
  p.codigo,
  p.stock_inicial,
  coalesce((select sum(i.cantidad) from entrada_items i where i.codigo = p.codigo), 0) as entradas,
  coalesce((select sum(i.entregada) from salida_items i where i.codigo = p.codigo), 0) as salidas,
  p.stock_inicial
    + coalesce((select sum(i.cantidad) from entrada_items i where i.codigo = p.codigo), 0)
    - coalesce((select sum(i.entregada) from salida_items i where i.codigo = p.codigo), 0) as stock_actual
from productos p;

-- ---------- VALIDACIÓN DE EXISTENCIAS EN EL SERVIDOR ----------
-- Ninguna salida puede dejar el stock en negativo, aunque alguien use la API directamente.
create or replace function validar_stock_salida() returns trigger
language plpgsql set search_path = public as $$
declare disponible numeric;
begin
  -- Bloquea la fila del producto: dos salidas simultáneas no pueden rebasar el stock
  perform 1 from productos where codigo = new.codigo for update;

  select p.stock_inicial
       + coalesce((select sum(i.cantidad) from entrada_items i where i.codigo = p.codigo), 0)
       - coalesce((select sum(i.entregada) from salida_items i where i.codigo = p.codigo), 0)
    into disponible
    from productos p
   where p.codigo = new.codigo;

  -- disponible NULL significa que el usuario no puede ver el producto: se rechaza
  if disponible is null or disponible < new.entregada then
    raise exception 'Existencia insuficiente de %. Disponibles: %', new.codigo, coalesce(disponible, 0);
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_stock on salida_items;
create trigger trg_validar_stock
  before insert on salida_items
  for each row execute function validar_stock_salida();

-- ---------- FUNCIONES DE REGISTRO (cada operación es una transacción completa) ----------
create or replace function registrar_entrada(p jsonb) returns text
language plpgsql set search_path = public as $$
declare f text; it jsonb;
begin
  if rol_actual() not in ('admin','almacen') then
    raise exception 'Tu perfil no puede registrar entradas';
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then
    raise exception 'La entrada no tiene productos';
  end if;

  insert into entradas (fecha, proveedor_id, factura, observaciones, usuario)
  values (
    coalesce(nullif(p->>'fecha', '')::date, current_date),
    (p->>'proveedor_id')::uuid,
    nullif(trim(p->>'factura'), ''),
    nullif(trim(p->>'observaciones'), ''),
    (select nombre from profiles where id = auth.uid())
  )
  returning folio into f;

  for it in select value from jsonb_array_elements(p->'items') loop
    insert into entrada_items (folio, codigo, cantidad, costo_unitario)
    values (f, it->>'codigo', (it->>'cantidad')::numeric, coalesce((it->>'costo')::numeric, 0));
  end loop;
  return f;
end $$;

create or replace function registrar_salida(p jsonb) returns text
language plpgsql set search_path = public as $$
declare f text; it jsonb;
begin
  if rol_actual() not in ('admin','almacen') then
    raise exception 'Tu perfil no puede registrar salidas';
  end if;
  if jsonb_array_length(coalesce(p->'items', '[]'::jsonb)) = 0 then
    raise exception 'La salida no tiene artículos';
  end if;

  insert into salidas (fecha, area, requisicion, recibe, observaciones, usuario)
  values (
    coalesce(nullif(p->>'fecha', '')::date, current_date),
    p->>'area',
    trim(p->>'requisicion'),
    trim(p->>'recibe'),
    nullif(trim(p->>'observaciones'), ''),
    (select nombre from profiles where id = auth.uid())
  )
  returning folio into f;

  for it in select value from jsonb_array_elements(p->'items') loop
    insert into salida_items (folio, codigo, solicitada, entregada)
    values (f, it->>'codigo', coalesce((it->>'solicitada')::numeric, 0), (it->>'entregada')::numeric);
  end loop;
  return f;
end $$;

-- ---------- ROW LEVEL SECURITY ----------
alter table profiles      enable row level security;
alter table areas         enable row level security;
alter table proveedores   enable row level security;
alter table productos     enable row level security;
alter table entradas      enable row level security;
alter table entrada_items enable row level security;
alter table salidas       enable row level security;
alter table salida_items  enable row level security;

-- Perfiles: cada quien ve el suyo; el administrador ve todos y cambia roles
create policy "perfiles: ver propio o admin" on profiles for select to authenticated
  using (id = auth.uid() or rol_actual() = 'admin');
create policy "perfiles: admin cambia roles" on profiles for update to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- Áreas: todos leen; solo admin modifica
create policy "areas: leer" on areas for select to authenticated using (true);
create policy "areas: admin" on areas for all to authenticated
  using (rol_actual() = 'admin') with check (rol_actual() = 'admin');

-- Proveedores y productos: todos leen; admin y almacén crean/editan; solo admin elimina
create policy "proveedores: leer" on proveedores for select to authenticated using (true);
create policy "proveedores: crear" on proveedores for insert to authenticated
  with check (rol_actual() in ('admin','almacen'));
create policy "proveedores: editar" on proveedores for update to authenticated
  using (rol_actual() in ('admin','almacen')) with check (rol_actual() in ('admin','almacen'));
create policy "proveedores: eliminar" on proveedores for delete to authenticated
  using (rol_actual() = 'admin');

create policy "productos: leer" on productos for select to authenticated using (true);
create policy "productos: crear" on productos for insert to authenticated
  with check (rol_actual() in ('admin','almacen'));
create policy "productos: editar" on productos for update to authenticated
  using (rol_actual() in ('admin','almacen')) with check (rol_actual() in ('admin','almacen'));
create policy "productos: eliminar" on productos for delete to authenticated
  using (rol_actual() = 'admin');

-- Movimientos: se leen y se insertan; NO hay políticas de update ni delete (trazabilidad)
create policy "entradas: leer" on entradas for select to authenticated using (true);
create policy "entradas: crear" on entradas for insert to authenticated
  with check (rol_actual() in ('admin','almacen'));
create policy "entrada_items: leer" on entrada_items for select to authenticated using (true);
create policy "entrada_items: crear" on entrada_items for insert to authenticated
  with check (rol_actual() in ('admin','almacen'));

create policy "salidas: leer" on salidas for select to authenticated using (true);
create policy "salidas: crear" on salidas for insert to authenticated
  with check (rol_actual() in ('admin','almacen'));
create policy "salida_items: leer" on salida_items for select to authenticated using (true);
create policy "salida_items: crear" on salida_items for insert to authenticated
  with check (rol_actual() in ('admin','almacen'));

-- ---------- PERMISOS MÍNIMOS ----------
-- Usuarios anónimos (sin sesión) no tienen acceso a nada
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from public, anon;
revoke execute on function crear_perfil() from authenticated;
grant execute on function rol_actual() to authenticated;
grant execute on function registrar_entrada(jsonb) to authenticated;
grant execute on function registrar_salida(jsonb) to authenticated;
grant usage on all sequences in schema public to authenticated;
