/*
  Configuración pública del proyecto.
  - La clave "anon" es pública por diseño: la seguridad real la aplican las
    políticas RLS de supabase/schema.sql.
  - NUNCA pongas aquí la clave "service_role" ni contraseñas.
  Datos: Supabase > Project Settings > API.
*/
window.APP_CONFIG = {
  SUPABASE_URL: 'https://lhdznnwsklasklbaoxqc.supabase.co/rest/v1/',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxoZHpubndza2xhc2tsYmFveHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxNDEyMTgsImV4cCI6MjExMDcxNzIxOH0.fpa5nF-9zUrq6hLRuoksopQLNGIeiHEKCvWiXCeTYaM'
};
