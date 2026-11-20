/*
  Configuración pública del proyecto.
  - La clave "anon" es pública por diseño: la seguridad real la aplican las
    políticas RLS de supabase/schema.sql.
  - NUNCA pongas aquí la clave "service_role" ni contraseñas.
  Datos: Supabase > Project Settings > API.
*/
window.APP_CONFIG = {
  SUPABASE_URL: ' https://sangilalmacen28-svg.github.io/inventario-hotel-san-gil./',
  SUPABASE_ANON_KEY: 'TU_CLAVE_ANON_PUBLICA'
};
