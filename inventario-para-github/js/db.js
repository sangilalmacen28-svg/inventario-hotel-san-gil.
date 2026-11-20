/*
  Capa de datos: el único archivo que se comunica con Supabase.
  Toda escritura pasa por el servidor (RPC o tablas con RLS). La interfaz
  solo oculta botones; la autorización real la decide la base de datos.
*/
(function () {
  const cfg = window.APP_CONFIG || {};
  const listo = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) &&
    !/TU-PROYECTO|TU_CLAVE/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY) &&
    typeof window.supabase !== 'undefined';
  const sb = listo ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  // Respuestas de PostgREST: lanza el error si lo hay
  const val = r => { if (r.error) throw r.error; return r.data; };
  // Con RLS, una operación no permitida no da error: afecta 0 filas. Lo convertimos en error.
  const filas = r => { const d = val(r); if (!d || !d.length) throw new Error('Sin permiso o registro inexistente'); return d; };

  window.Data = {
    listo,

    sesion: async () => (await sb.auth.getSession()).data.session,
    entrar: async (email, password) => {
      const r = await sb.auth.signInWithPassword({ email, password });
      if (r.error) throw r.error;
      return r.data.session;
    },
    salir: () => sb.auth.signOut(),
    onCambio: fn => sb.auth.onAuthStateChange(ev => fn(ev)),

    perfil: async uid => val(await sb.from('profiles').select('nombre,rol').eq('id', uid).single()),

    cargarTodo: async () => {
      const q = async r => val(await r);
      const [prov, prods, stock, ents, sals, areas] = await Promise.all([
        q(sb.from('proveedores').select('*').order('nombre')),
        q(sb.from('productos').select('*').order('codigo')),
        q(sb.from('v_stock').select('*')),
        q(sb.from('entradas').select('*,entrada_items(*)').order('fecha', { ascending: false })),
        q(sb.from('salidas').select('*,salida_items(*)').order('fecha', { ascending: false })),
        q(sb.from('areas').select('nombre').order('nombre'))
      ]);
      return {
        proveedores: prov.map(s => ({ id: s.id, nombre: s.nombre, contacto: s.contacto || '', tel: s.telefono || '', email: s.correo || '', dir: s.direccion || '', cat: s.categoria, estado: s.estado, obs: s.observaciones || '' })),
        productos: prods.map(p => ({ codigo: p.codigo, desc: p.descripcion, cat: p.categoria, uni: p.unidad, ini: +p.stock_inicial, reo: +p.punto_reorden, prov: p.proveedor_id || '', obs: p.observaciones || '' })),
        entradas: ents.map(e => ({ folio: e.folio, fecha: e.fecha, prov: e.proveedor_id, fac: e.factura || '', obs: e.observaciones || '', usr: e.usuario, items: e.entrada_items.map(i => ({ codigo: i.codigo, cant: +i.cantidad, costo: +i.costo_unitario })) })),
        salidas: sals.map(s => ({ folio: s.folio, fecha: s.fecha, area: s.area, req: s.requisicion, rec: s.recibe, obs: s.observaciones || '', usr: s.usuario, items: s.salida_items.map(i => ({ codigo: i.codigo, sol: +i.solicitada, ent: +i.entregada })) })),
        areas: areas.map(a => a.nombre),
        stock: Object.fromEntries(stock.map(s => [s.codigo, { ent: +s.entradas, sal: +s.salidas, act: +s.stock_actual }]))
      };
    },

    registrarEntrada: async p => val(await sb.rpc('registrar_entrada', { p })),
    registrarSalida: async p => val(await sb.rpc('registrar_salida', { p })),

    crearProducto: async p => val(await sb.from('productos').insert(p)),
    eliminarProducto: async codigo => filas(await sb.from('productos').delete().eq('codigo', codigo).select('codigo')),

    crearProveedor: async p => val(await sb.from('proveedores').insert(p)),
    setEstadoProveedor: async (id, estado) => filas(await sb.from('proveedores').update({ estado }).eq('id', id).select('id')),

    agregarArea: async nombre => val(await sb.from('areas').insert({ nombre })),
    quitarArea: async nombre => filas(await sb.from('areas').delete().eq('nombre', nombre).select('nombre')),

    usuarios: async () => val(await sb.from('profiles').select('id,nombre,rol').order('nombre')),
    cambiarRol: async (id, rol) => filas(await sb.from('profiles').update({ rol }).eq('id', id).select('id'))
  };
})();
