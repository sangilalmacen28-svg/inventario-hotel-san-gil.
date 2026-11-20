/* Interfaz del sistema: inicio de sesión, módulos y reportes.
   Toda escritura pasa por js/db.js y el servidor valida y autoriza. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v) || 0;
const iso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ym = d => iso(d).slice(0, 7);
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const ROLES = ['admin', 'almacen', 'consulta'];
const ETIQ = { admin: 'Administrador', almacen: 'Encargado de almacén', consulta: 'Usuario de consulta' };
const INACTIVIDAD_MS = 15 * 60 * 1000;

let DB = null, PERFIL = null, dE = [], dS = [], charts = {}, ultimaAct = Date.now();

/* ---------- Permisos (solo para la interfaz; la base de datos es la que decide) ---------- */
const rol = () => PERFIL?.rol || '';
const puedeOp = () => rol() === 'admin' || rol() === 'almacen';
const esAdmin = () => rol() === 'admin';
const canEdit = () => { if (!puedeOp()) { msg('Tu perfil es de solo consulta', 'err'); return false; } return true; };

/* ---------- Mensajes ---------- */
function msg(t, k = 'ok') {
  const e = $('#toast');
  e.textContent = t;
  e.style.background = k === 'ok' ? 'var(--ok)' : 'var(--bad)';
  e.hidden = false;
  clearTimeout(msg.t);
  msg.t = setTimeout(() => { e.hidden = true; }, 3500);
}
// Mensaje amigable: nunca mostramos detalles internos de la base de datos
function errTxt(e) {
  const m = e?.message || '';
  if (e?.code === '23503') return 'No se puede completar: el registro tiene movimientos registrados.';
  if (/insuficiente|no puede|no tiene|no tienes|La entrada|La salida/i.test(m)) return m;
  if (e?.code === '42501' || /row-level|permission|Sin permiso/i.test(m)) return 'No tienes permiso para esta acción.';
  return 'Ocurrió un error. Intenta de nuevo.';
}
async function accion(fn, ok) {
  try {
    const r = await fn();
    msg(typeof ok === 'function' ? ok(r) : ok);
    await recargar();
    return true;
  } catch (e) {
    msg(errTxt(e), 'err');
    return false;
  }
}
async function recargar() { DB = await Data.cargarTodo(); renderAll(); }

/* ---------- Búsquedas en memoria (la fuente de verdad es el servidor) ---------- */
const prod = c => DB.productos.find(p => p.codigo === c);
const descr = c => prod(c)?.desc || '';
const provNom = id => DB.proveedores.find(s => s.id === id)?.nombre || 'Sin proveedor';
const stk = c => DB.stock[c] || { ent: 0, sal: 0, act: 0 };
const stock = c => stk(c).act;
const entT = c => stk(c).ent;
const salT = c => stk(c).sal;
function estado(c) {
  const s = stock(c), r = num(prod(c)?.reo);
  if (s <= 0) return ['rojo', 'Agotado'];
  if (s <= r * 0.5) return ['rojo', 'Crítico'];
  if (s <= r) return ['amar', 'Reponer'];
  return ['verde', 'Suficiente'];
}
function movs() {
  const r = [];
  DB.entradas.forEach(e => e.items.forEach(i => r.push({ f: e.fecha, tipo: 'Entrada', cod: i.codigo, cant: i.cant, usr: e.usr, doc: e.folio })));
  DB.salidas.forEach(s => s.items.forEach(i => r.push({ f: s.fecha, tipo: 'Salida', cod: i.codigo, cant: i.ent, usr: s.usr, doc: s.folio })));
  return r.sort((a, b) => b.f.localeCompare(a.f));
}
function lastC(c) {
  let r = null;
  DB.entradas.forEach(e => e.items.forEach(i => { if (i.codigo === c && (!r || e.fecha >= r.f)) r = { f: e.fecha, costo: i.costo }; }));
  return r;
}

/* ---------- Ayudas de tabla y selectores ---------- */
// Las celdas que recibe ya vienen escapadas por quien llama
const T = (H, R) => `<table><tr>${H.map(h => `<th>${h}</th>`).join('')}</tr>${R.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${H.length}">Sin registros</td></tr>`}</table>`;
const ops = (arr, first) => (first != null ? `<option value="">${first}</option>` : '') + arr.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
function fill(sel, html) {
  const el = $(sel), v = el.value;
  el.innerHTML = html;
  if ([...el.options].some(o => o.value === v)) el.value = v;
}
function selects() {
  const PV = DB.proveedores.map(s => [s.id, s.nombre]), AR = DB.areas.map(a => [a, a]);
  fill('#eProv', ops(PV, '— Selecciona proveedor —'));
  fill('#sArea', ops(AR, '— Selecciona área —'));
  fill('#pCat', ops(AR, '— Categoría —'));
  fill('#pProv', ops(PV, 'Sin proveedor'));
  fill('#fCat', ops(AR, 'Todas las categorías'));
  fill('#fProv', ops(PV, 'Todos los proveedores'));
  fill('#rArea', ops(AR, 'Todas las áreas'));
  fill('#rProv', ops(PV, 'Todos los proveedores'));
  fill('#fSCat', ops([...new Set(DB.proveedores.map(s => s.cat))].map(c => [c, c]), 'Todas las categorías'));
  $('#dlProd').innerHTML = DB.productos.map(p => `<option value="${esc(p.codigo)}">${esc(p.desc)}</option>`).join('');
}

/* ---------- Dashboard ---------- */
function chart(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($('#' + id), cfg); }
function renderDash() {
  const M = movs(), mes = ym(new Date()), al = DB.productos.filter(p => estado(p.codigo)[0] !== 'verde');
  const sum = (t, m) => M.filter(x => x.tipo === t && (!m || x.f.startsWith(m))).reduce((a, x) => a + x.cant, 0);
  const uni = DB.productos.reduce((a, p) => a + Math.max(0, stock(p.codigo)), 0);
  $('#kpis').innerHTML = [
    [DB.productos.length, 'Productos registrados'], [uni, 'Unidades disponibles'],
    [sum('Entrada', mes), 'Entradas del mes (u)'], [sum('Salida', mes), 'Salidas del mes (u)'],
    [al.length, 'Stock bajo'], [DB.productos.filter(p => stock(p.codigo) <= 0).length, 'Agotados'],
    [DB.proveedores.length, 'Proveedores']
  ].map(([v, l]) => `<div class="card kpi"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
  const ms = [...Array(6)].map((_, k) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - (5 - k)); return ym(d); });
  chart('cMes', { type: 'bar', data: { labels: ms.map(m => MES[+m.slice(5) - 1]), datasets: [{ label: 'Entradas', data: ms.map(m => sum('Entrada', m)), backgroundColor: '#2E9D5B' }, { label: 'Salidas', data: ms.map(m => sum('Salida', m)), backgroundColor: '#9C268F' }] }, options: { maintainAspectRatio: false } });
  const cats = [...new Set(DB.productos.map(p => p.cat))];
  chart('cCat', { type: 'doughnut', data: { labels: cats, datasets: [{ data: cats.map(c => DB.productos.filter(p => p.cat === c).reduce((a, p) => a + Math.max(0, stock(p.codigo)), 0)), backgroundColor: ['#9C268F', '#991C8C', '#D98CCB', '#6D1B66', '#B784AD', '#C9B3C4', '#5E5263', '#E8912D', '#2E9D5B', '#D6333B'] }] }, options: { maintainAspectRatio: false } });
  $('#alertas').innerHTML = al.map(p => { const [k, t] = estado(p.codigo); return `<div class="fila"><span class="badge ${k}">${t}</span> <b>${esc(p.codigo)}</b> ${esc(p.desc)} · stock ${stock(p.codigo)} (reorden ${num(p.reo)})</div>`; }).join('') || '<p class="note">Sin alertas: el inventario está suficiente.</p>';
  const mv = {}; M.forEach(m => mv[m.cod] = (mv[m.cod] || 0) + m.cant);
  $('#top').innerHTML = T(['Código', 'Descripción', 'Movimiento total'], Object.entries(mv).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, n]) => [esc(c), esc(descr(c)), n]));
  $('#recientes').innerHTML = T(['Fecha', 'Tipo', 'Código', 'Descripción', 'Cantidad', 'Usuario'], M.slice(0, 8).map(m => [esc(m.f), `<span class="badge ${m.tipo === 'Entrada' ? 'verde' : 'amar'}">${m.tipo}</span>`, esc(m.cod), esc(descr(m.cod)), m.cant, esc(m.usr)]));
  $('#notif').textContent = al.length;
}

/* ---------- Entradas ---------- */
function initE() { dE = [{ codigo: '', cant: 1, costo: '' }]; $('#eFolio').value = 'Automático'; $('#eFecha').value = iso(); $('#eProv').value = ''; $('#eFac').value = ''; $('#eObs').value = ''; lin('E'); }
function lin(k) {
  const E = k === 'E', A = E ? dE : dS;
  $(E ? '#lE' : '#lS').innerHTML = A.map((l, i) => `<div class="ln">
    <input list="dlProd" placeholder="Código o buscar" value="${esc(l.codigo)}" data-i="${i}" data-f="codigo">
    <span class="note">${esc(descr(l.codigo))}${!E && l.codigo ? ` · <b>Disp: ${stock(l.codigo)}</b>` : ''}</span>
    ${E ? `<input type="number" min="1" placeholder="Cantidad" value="${esc(l.cant)}" data-i="${i}" data-f="cant">
    <input type="number" min="0" step="0.01" placeholder="Costo unit. (opc.)" value="${esc(l.costo)}" data-i="${i}" data-f="costo">`
      : `<input type="number" min="1" placeholder="Solicitada" value="${esc(l.sol)}" data-i="${i}" data-f="sol">
    <input type="number" min="0" placeholder="Entregada" value="${esc(l.ent)}" data-i="${i}" data-f="ent">`}
    <button class="btn sec sm" data-d="${i}">✕</button></div>`).join('');
  if (E) $('#totE').textContent = dE.reduce((a, l) => a + num(l.cant), 0);
}
function renderHE() {
  $('#hE').innerHTML = T(['Folio', 'Fecha', 'Proveedor', 'Factura', 'Detalle', 'Unidades', 'Usuario'],
    DB.entradas.map(e => [esc(e.folio), esc(e.fecha), esc(provNom(e.prov)), esc(e.fac), e.items.map(i => `${esc(i.codigo)} ×${i.cant}`).join('<br>'), e.items.reduce((a, i) => a + i.cant, 0), esc(e.usr)]));
}

/* ---------- Salidas ---------- */
function initS() { dS = [{ codigo: '', sol: 1, ent: 1 }]; $('#sFolio').value = 'Automático'; $('#sFecha').value = iso(); $('#sArea').value = ''; $('#sReq').value = ''; $('#sRec').value = ''; $('#sObs').value = ''; lin('S'); }
function renderHS() {
  $('#hS').innerHTML = T(['Folio', 'Fecha', 'Área', 'Requisición', 'Recibe', 'Detalle', 'Usuario', ''],
    DB.salidas.map(s => [esc(s.folio), esc(s.fecha), esc(s.area), esc(s.req), esc(s.rec), s.items.map(i => `${esc(i.codigo)} ×${i.ent}`).join('<br>'), esc(s.usr), `<button class="btn sec sm" data-p="${esc(s.folio)}">🖨️ Comprobante</button>`]));
}
function imprimir(folio) {
  const s = DB.salidas.find(x => x.folio === folio);
  if (!s) return;
  $('#print').innerHTML = `<h2>Hotel Misión San Gil · San Gil, Querétaro</h2><h3>Comprobante de salida ${esc(s.folio)}</h3>
    <p>Fecha: ${esc(s.fecha)} · Área: ${esc(s.area)} · Requisición: ${esc(s.req)}</p>
    <p>Recibe: ${esc(s.rec)} · Entrega: ${esc(s.usr)}</p>` +
    T(['Código', 'Descripción', 'Unidad', 'Solicitada', 'Entregada'], s.items.map(i => [esc(i.codigo), esc(descr(i.codigo)), esc(prod(i.codigo)?.uni), i.sol, i.ent])) +
    '<p><br>Firma de quien recibe: ______________________</p>';
  window.print();
}

/* ---------- Inventarios ---------- */
function renderInv() {
  const q = $('#fBuscar').value.toLowerCase(), c = $('#fCat').value, v = $('#fProv').value, o = $('#fOrd').value;
  const L = DB.productos.filter(p => (!q || (p.codigo + ' ' + p.desc).toLowerCase().includes(q)) && (!c || p.cat === c) && (!v || p.prov === v))
    .sort((a, b) => o === 'stock' ? stock(b.codigo) - stock(a.codigo) : o === 'desc' ? a.desc.localeCompare(b.desc) : a.codigo.localeCompare(b.codigo));
  $('#tInv').innerHTML = L.map(p => {
    const [k, t] = estado(p.codigo);
    return `<tr><td>${esc(p.codigo)}</td><td>${esc(p.desc)}</td><td>${esc(p.cat)}</td><td>${esc(p.uni)}</td><td>${num(p.ini)}</td><td>${entT(p.codigo)}</td><td>${salT(p.codigo)}</td><td><b>${stock(p.codigo)}</b> <span class="badge ${k}">${t}</span></td><td>${num(p.reo)}</td><td>${esc(provNom(p.prov))}</td><td><button class="btn sec sm" data-h="${esc(p.codigo)}">Historial</button> <button class="btn sm del adm" data-del="${esc(p.codigo)}">Eliminar</button></td></tr>`;
  }).join('') || '<tr><td colspan="11">Sin resultados</td></tr>';
}
function verH(c) {
  const p = prod(c); if (!p) return;
  const h = $('#hist');
  h.hidden = false;
  h.innerHTML = `<h3 style="margin-top:0">Historial de ${esc(c)} · ${esc(p.desc)}</h3><div class="tw">` +
    T(['Fecha', 'Tipo', 'Documento', 'Cantidad', 'Usuario'], movs().filter(m => m.cod === c).map(m => [esc(m.f), m.tipo, esc(m.doc), (m.tipo === 'Entrada' ? '+' : '−') + m.cant, esc(m.usr)])) +
    `</div><p class="note">Stock actual: <b>${stock(c)}</b> · Punto de reorden: ${num(p.reo)}</p>`;
  h.scrollIntoView({ behavior: 'smooth' });
}

/* ---------- Proveedores ---------- */
function renderProv() {
  const f = $('#fSCat').value;
  const abiertos = new Set([...document.querySelectorAll('#lProv details[open]')].map(d => d.dataset.id));
  $('#lProv').innerHTML = DB.proveedores.filter(s => !f || s.cat === f).map(s => {
    const ps = DB.productos.filter(p => p.prov === s.id), compras = DB.entradas.filter(e => e.prov === s.id).length;
    return `<details class="dl" data-id="${esc(s.id)}"${abiertos.has(s.id) ? ' open' : ''}>
      <summary>${esc(s.nombre)} <span class="badge ${s.estado === 'Activo' ? 'verde' : 'amar'}">${esc(s.estado)}</span> <span class="note">· ${esc(s.cat)} · ${ps.length} artículos · ${compras} entradas</span></summary>
      <p class="note">${esc(s.contacto)} · ${esc(s.tel)} · ${esc(s.email)} · ${esc(s.dir)}${s.obs ? ' · ' + esc(s.obs) : ''}</p>
      <div class="tw">${T(['Código', 'Descripción', 'Categoría', 'Unidad', 'Stock actual', 'Último precio', 'Última compra'],
        ps.map(p => { const u = lastC(p.codigo); return [esc(p.codigo), esc(p.desc), esc(p.cat), esc(p.uni), stock(p.codigo), u ? '$' + u.costo.toFixed(2) : '—', u ? esc(u.f) : '—']; }))}</div>
      <p class="op"><button class="btn sec sm" data-t="${esc(s.id)}">${s.estado === 'Activo' ? 'Desactivar proveedor' : 'Activar proveedor'}</button></p>
    </details>`;
  }).join('') || '<p class="note">Sin proveedores en esta categoría.</p>';
  $('#sinProv').innerHTML = DB.productos.filter(p => !DB.proveedores.some(s => s.id === p.prov)).map(p => `${esc(p.codigo)} · ${esc(p.desc)}`).join('<br>') || 'Todos los productos tienen proveedor.';
}

/* ---------- Reportes Excel (.xlsx reales) ---------- */
const enRango = f => (!$('#rDe').value || f >= $('#rDe').value) && (!$('#rHa').value || f <= $('#rHa').value);
const ENT = () => DB.entradas.filter(e => enRango(e.fecha) && (!$('#rProv').value || e.prov === $('#rProv').value)).flatMap(e => e.items.map(i => [e.folio, e.fecha, provNom(e.prov), e.fac, i.codigo, descr(i.codigo), i.cant, i.costo, e.usr]));
const SAL = () => DB.salidas.filter(s => enRango(s.fecha) && (!$('#rArea').value || s.area === $('#rArea').value)).flatMap(s => s.items.map(i => [s.folio, s.fecha, s.area, s.req, s.rec, i.codigo, descr(i.codigo), i.sol, i.ent, s.usr]));
const COMP = () => DB.entradas.filter(e => enRango(e.fecha) && (!$('#rProv').value || e.prov === $('#rProv').value)).flatMap(e => e.items.map(i => [e.fecha, provNom(e.prov), i.codigo, descr(i.codigo), i.cant, i.costo, +(i.cant * i.costo).toFixed(2)]));
function X(titulo, H, R, sum = []) {
  if (typeof XLSX === 'undefined') return msg('No se cargó el módulo de Excel. Revisa tu conexión.', 'err');
  const aoa = [['Hotel Misión San Gil · San Gil, Querétaro'], ['Reporte: ' + titulo], ['Generado: ' + new Date().toLocaleString('es-MX')], [], H, ...R];
  if (sum.length && R.length) aoa.push(H.map((_, i) => i === 0 ? 'TOTAL' : sum.includes(i) ? R.reduce((a, r) => a + num(r[i]), 0) : ''));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = H.map((h, i) => ({ wch: Math.max(String(h).length, ...R.map(r => String(r[i] ?? '').length), 8) + 2 }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(H.length - 1, 0) } }];
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 4, c: 0 }, e: { r: 4 + R.length, c: H.length - 1 } }) };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 31));
  XLSX.writeFile(wb, titulo.replace(/\s+/g, '_') + '_' + iso() + '.xlsx');
  msg('Archivo Excel generado: ' + titulo);
}
const REP = [
  ['Inventario general', () => X('Inventario general', ['Código', 'Descripción', 'Categoría', 'Unidad', 'Stock inicial', 'Entradas', 'Salidas', 'Stock actual', 'Punto de reorden', 'Proveedor'], DB.productos.map(p => [p.codigo, p.desc, p.cat, p.uni, num(p.ini), entT(p.codigo), salT(p.codigo), stock(p.codigo), num(p.reo), provNom(p.prov)]))],
  ['Existencias actuales', () => X('Existencias actuales', ['Código', 'Descripción', 'Stock actual', 'Unidad', 'Estado'], DB.productos.map(p => [p.codigo, p.desc, stock(p.codigo), p.uni, estado(p.codigo)[1]]))],
  ['Productos con stock bajo', () => X('Productos con stock bajo', ['Código', 'Descripción', 'Stock actual', 'Punto de reorden', 'Proveedor'], DB.productos.filter(p => estado(p.codigo)[0] !== 'verde').map(p => [p.codigo, p.desc, stock(p.codigo), num(p.reo), provNom(p.prov)]))],
  ['Productos agotados', () => X('Productos agotados', ['Código', 'Descripción', 'Proveedor'], DB.productos.filter(p => stock(p.codigo) <= 0).map(p => [p.codigo, p.desc, provNom(p.prov)]))],
  ['Registro de entradas', () => X('Registro de entradas', ['Folio', 'Fecha', 'Proveedor', 'Factura', 'Código', 'Descripción', 'Cantidad', 'Costo unit.', 'Usuario'], ENT(), [6])],
  ['Registro de salidas', () => X('Registro de salidas', ['Folio', 'Fecha', 'Área', 'Requisición', 'Recibe', 'Código', 'Descripción', 'Solicitada', 'Entregada', 'Usuario'], SAL(), [7, 8])],
  ['Movimientos generales', () => X('Movimientos generales', ['Fecha', 'Tipo', 'Documento', 'Código', 'Descripción', 'Cantidad', 'Usuario'], movs().filter(m => enRango(m.f)).map(m => [m.f, m.tipo, m.doc, m.cod, descr(m.cod), m.cant, m.usr]))],
  ['Movimientos por producto', () => X('Movimientos por producto', ['Código', 'Fecha', 'Tipo', 'Documento', 'Cantidad', 'Usuario'], movs().filter(m => enRango(m.f)).sort((a, b) => a.cod.localeCompare(b.cod) || a.f.localeCompare(b.f)).map(m => [m.cod, m.f, m.tipo, m.doc, m.cant, m.usr]))],
  ['Historial de compras', () => X('Historial de compras', ['Fecha', 'Proveedor', 'Código', 'Descripción', 'Cantidad', 'Costo unit.', 'Total'], COMP(), [4, 6])]
];

/* ---------- Configuración ---------- */
function renderCfg() {
  $('#lAreas').innerHTML = DB.areas.map((a, i) => `<div class="fila"><span>${esc(a)}</span><button class="btn sec sm adm" data-ar="${i}">Quitar</button></div>`).join('');
}
async function renderUsuarios() {
  const box = $('#usuarios');
  if (!esAdmin()) { box.innerHTML = '<p class="note">Solo el administrador gestiona usuarios.</p>'; return; }
  try {
    const U = await Data.usuarios();
    box.innerHTML = T(['Nombre', 'Rol actual', 'Cambiar rol'], U.map(u => [esc(u.nombre), esc(ETIQ[u.rol] || u.rol),
      `<select data-u="${esc(u.id)}">${ROLES.map(r => `<option value="${r}"${r === u.rol ? ' selected' : ''}>${ETIQ[r]}</option>`).join('')}</select>`]));
  } catch (e) { box.innerHTML = '<p class="note">No se pudo cargar la lista de usuarios.</p>'; }
}

/* ---------- Navegación, render general y tema ---------- */
function renderAll() {
  if (!DB) return;
  selects();
  renderDash(); renderInv(); renderProv(); renderHE(); renderHS(); renderCfg(); renderUsuarios();
}
function go(v) {
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  renderAll();
}

/* ---------- Inicio de sesión y sesión ---------- */
function mostrarLogin(texto = '') {
  PERFIL = null; DB = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#lErr').textContent = texto;
}
async function iniciarSesion(uid) {
  try { PERFIL = await Data.perfil(uid); }
  catch (e) { await Data.salir(); return mostrarLogin('Tu cuenta no tiene un perfil activo. Pide al administrador que la habilite.'); }
  try { DB = await Data.cargarTodo(); }
  catch (e) { return mostrarLogin('No se pudieron cargar los datos. Intenta de nuevo.'); }
  document.body.dataset.rol = PERFIL.rol;
  $('#uname').textContent = `👤 ${PERFIL.nombre} · ${ETIQ[PERFIL.rol] || PERFIL.rol}`;
  $('#login').hidden = true;
  $('#app').hidden = false;
  ultimaAct = Date.now();
  initE(); initS();
  renderAll();
  go('dash');
}
$('#lForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('#lErr').textContent = '';
  const b = $('#lBtn'); b.disabled = true;
  let s = null;
  try { s = await Data.entrar($('#lEmail').value.trim(), $('#lPass').value); }
  catch (err) { $('#lErr').textContent = 'Correo o contraseña incorrectos.'; }
  finally { $('#lPass').value = ''; b.disabled = false; }
  if (s) await iniciarSesion(s.user.id);
});
$('#salir').onclick = async () => { await Data.salir(); mostrarLogin('Sesión cerrada.'); };
['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { ultimaAct = Date.now(); }, { passive: true }));
setInterval(async () => {
  if (PERFIL && Date.now() - ultimaAct > INACTIVIDAD_MS) { await Data.salir(); mostrarLogin('Sesión cerrada por inactividad.'); }
}, 30000);

async function arrancar() {
  if (!Data.listo) {
    $('#login').hidden = false;
    $('#lForm').hidden = true;
    $('#lErr').textContent = 'Falta configurar js/config.js (URL y clave pública de Supabase) o cargar las librerías.';
    return;
  }
  Data.onCambio(ev => { if (ev === 'SIGNED_OUT') mostrarLogin(); });
  const s = await Data.sesion();
  if (s) await iniciarSesion(s.user.id); else mostrarLogin();
}

/* ---------- Eventos de la interfaz ---------- */
$('#nav').onclick = e => { if (e.target.dataset.v) go(e.target.dataset.v); };
$('#tema').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  const oscuro = document.body.classList.contains('dark');
  $('#tema').textContent = oscuro ? '☀️ Modo claro' : '🌙 Modo oscuro';
  if (window.Chart) Chart.defaults.color = oscuro ? '#f0ecf3' : '#34313A';
  if (DB) renderDash();
});
['#lE', '#lS'].forEach(sel => {
  const k = sel === '#lE' ? 'E' : 'S', b = $(sel);
  b.addEventListener('input', e => { const f = e.target.dataset.f; if (!f) return; (k === 'E' ? dE : dS)[+e.target.dataset.i][f] = e.target.value; if (k === 'E') $('#totE').textContent = dE.reduce((a, l) => a + num(l.cant), 0); });
  b.addEventListener('change', e => { if (e.target.dataset.f === 'codigo') lin(k); });
  b.addEventListener('click', e => { const d = e.target.dataset.d; if (d == null) return; (k === 'E' ? dE : dS).splice(+d, 1); if (!(k === 'E' ? dE : dS).length) (k === 'E' ? dE : dS).push(k === 'E' ? { codigo: '', cant: 1, costo: '' } : { codigo: '', sol: 1, ent: 1 }); lin(k); });
});
$('#addE').onclick = () => { dE.push({ codigo: '', cant: 1, costo: '' }); lin('E'); };
$('#addS').onclick = () => { dS.push({ codigo: '', sol: 1, ent: 1 }); lin('S'); };

$('#saveE').onclick = async () => {
  if (!canEdit()) return;
  const proveedor_id = $('#eProv').value, fecha = $('#eFecha').value;
  const items = dE.filter(l => l.codigo.trim()).map(l => ({ codigo: l.codigo.trim().toUpperCase(), cantidad: num(l.cant), costo: num(l.costo) }));
  if (!proveedor_id) return msg('Selecciona un proveedor', 'err');
  if (!fecha) return msg('Indica la fecha de recepción', 'err');
  if (!items.length) return msg('Agrega al menos un producto', 'err');
  if (items.some(i => !prod(i.codigo) || i.cantidad <= 0)) return msg('Revisa los códigos y que las cantidades sean mayores a cero', 'err');
  const ok = await accion(() => Data.registrarEntrada({ proveedor_id, fecha, factura: $('#eFac').value, observaciones: $('#eObs').value, items }),
    folio => `Entrada ${folio} registrada. Existencias actualizadas.`);
  if (ok) initE();
};
$('#saveS').onclick = async () => {
  if (!canEdit()) return;
  const area = $('#sArea').value, fecha = $('#sFecha').value, requisicion = $('#sReq').value.trim(), recibe = $('#sRec').value.trim();
  const items = dS.filter(l => l.codigo.trim()).map(l => ({ codigo: l.codigo.trim().toUpperCase(), solicitada: num(l.sol), entregada: num(l.ent) }));
  if (!area || !fecha || !requisicion || !recibe) return msg('Completa área, fecha, requisición y persona que recibe', 'err');
  if (!items.length) return msg('Agrega al menos un artículo', 'err');
  if (items.some(i => !prod(i.codigo) || i.entregada <= 0)) return msg('Revisa los códigos y que la cantidad entregada sea mayor a cero', 'err');
  const need = {}; items.forEach(i => need[i.codigo] = (need[i.codigo] || 0) + i.entregada);
  const falta = Object.keys(need).find(c => need[c] > stock(c));
  if (falta) return msg(`Existencia insuficiente de ${falta}. Disponibles: ${stock(falta)}`, 'err');
  const ok = await accion(() => Data.registrarSalida({ area, fecha, requisicion, recibe, observaciones: $('#sObs').value, items }),
    folio => `Salida ${folio} registrada. Inventario descontado.`);
  if (ok) initS();
};
$('#hS').onclick = e => { const f = e.target.dataset.p; if (f) imprimir(f); };

['#fBuscar', '#fCat', '#fProv', '#fOrd'].forEach(s => $(s).addEventListener('input', renderInv));
$('#tInv').onclick = e => { const { h, del } = e.target.dataset; if (h) verH(h); if (del) eliminarProducto(del); };
async function eliminarProducto(c) {
  if (!canEdit()) return;
  if (entT(c) || salT(c)) return msg('No se puede eliminar: el producto tiene movimientos registrados (trazabilidad).', 'err');
  if (!confirm(`¿Eliminar el producto ${c}? Esta acción no se puede deshacer.`)) return;
  await accion(() => Data.eliminarProducto(c), 'Producto eliminado');
}
$('#saveP').onclick = async () => {
  if (!canEdit()) return;
  const codigo = $('#pCod').value.trim().toUpperCase(), descripcion = $('#pDesc').value.trim(), categoria = $('#pCat').value, unidad = $('#pUni').value.trim();
  if (!/^[A-Z0-9-]{2,20}$/.test(codigo)) return msg('El código debe tener de 2 a 20 letras, números o guiones', 'err');
  if (!descripcion || !categoria || !unidad) return msg('Descripción, categoría y unidad son obligatorias', 'err');
  if (prod(codigo)) return msg('Ya existe un producto con ese código', 'err');
  const ok = await accion(() => Data.crearProducto({ codigo, descripcion, categoria, unidad, stock_inicial: num($('#pIni').value), punto_reorden: num($('#pReo').value), proveedor_id: $('#pProv').value || null, observaciones: $('#pObs').value.trim() || null }), 'Producto registrado');
  if (ok) { ['#pCod', '#pDesc', '#pUni', '#pObs'].forEach(s => $(s).value = ''); $('#pIni').value = 0; $('#pReo').value = 0; }
};
$('#fSCat').addEventListener('input', renderProv);
$('#lProv').onclick = async e => {
  const id = e.target.dataset.t;
  if (!id || !canEdit()) return;
  const s = DB.proveedores.find(x => x.id === id);
  await accion(() => Data.setEstadoProveedor(id, s.estado === 'Activo' ? 'Inactivo' : 'Activo'), 'Proveedor actualizado');
};
$('#saveV').onclick = async () => {
  if (!canEdit()) return;
  const g = id => $('#' + id).value.trim();
  if (!g('vNom')) return msg('El nombre comercial es obligatorio', 'err');
  const ok = await accion(() => Data.crearProveedor({ nombre: g('vNom'), contacto: g('vCon') || null, telefono: g('vTel') || null, correo: g('vMail') || null, direccion: g('vDir') || null, categoria: g('vCat') || 'General', estado: $('#vEst').value, observaciones: g('vObs') || null }), 'Proveedor registrado');
  if (ok) ['vNom', 'vCon', 'vTel', 'vMail', 'vDir', 'vCat', 'vObs'].forEach(id => $('#' + id).value = '');
};
$('#btnsRep').innerHTML = REP.map(([n], i) => `<div class="card"><b>${esc(n)}</b><p><button class="btn sm" data-r="${i}">⬇️ Descargar .xlsx</button></p></div>`).join('');
$('#btnsRep').onclick = e => { const i = e.target.dataset.r; if (i != null) REP[i][1](); };
$('#addArea').onclick = async () => {
  const v = $('#nArea').value.trim();
  if (!v) return;
  if (!esAdmin()) return msg('Solo el administrador gestiona las áreas', 'err');
  if (DB.areas.includes(v)) return msg('Esa área ya existe', 'err');
  if (await accion(() => Data.agregarArea(v), 'Área agregada')) $('#nArea').value = '';
};
$('#lAreas').onclick = async e => {
  const i = e.target.dataset.ar;
  if (i == null) return;
  if (!esAdmin()) return msg('Solo el administrador gestiona las áreas', 'err');
  const a = DB.areas[i];
  await accion(() => Data.quitarArea(a), 'Área eliminada');
};
$('#usuarios').addEventListener('change', async e => {
  const id = e.target.dataset.u;
  if (!id) return;
  await accion(() => Data.cambiarRol(id, e.target.value), 'Rol actualizado');
});
$('#hoy').textContent = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
arrancar();
