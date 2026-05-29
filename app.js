/* =============================================
   LA CABAÑA — GESTIÓN COMERCIAL
   app.js — v4 (todos los fixes)
   ============================================= */

const SUPABASE_URL = 'https://cptuecthxonltnzwryum.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwdHVlY3RoeG9ubHRuendyeXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzM4OTQsImV4cCI6MjA5NTU0OTg5NH0.Fv1H1i5T2XAhG7I-k1_kXdH3ky_VALkd8ozQ6NFCfOQ';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let estadoApp = {
  usuario: null,
  perfil: null,
  clienteActual: null,
  pedidoActual: { clienteId: null, items: {}, obs: '' },
  paginaActual: null,
  paginaAnterior: null,
  inactivoTimer: null,
  intentosLogin: 0,
  bloqueadoHasta: null,
  formaPagoActual: 'transferencia',
  tipoDocActual: 'factura',
  ivaActual: 'sin_iva',
  beneficioActual: 'ninguno',
  pedidoParaCobro: null,
  pedidoParaDoc: null,
};

const INACTIVO_MS = 20 * 60 * 1000;
const MAX_INTENTOS = 5;

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) { await cargarPerfil(session.user); mostrarApp(); }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') { await cargarPerfil(session.user); mostrarApp(); }
    else if (event === 'SIGNED_OUT') { mostrarLogin(); }
  });
  iniciarTimerInactividad();
  const fc = document.getElementById('cobro-fecha');
  if (fc) fc.value = new Date().toISOString().split('T')[0];
});

// =============================================
// AUTENTICACIÓN
// =============================================
async function iniciarSesion() {
  if (estadoApp.bloqueadoHasta && new Date() < estadoApp.bloqueadoHasta) {
    document.getElementById('bloqueo-tiempo').textContent = Math.ceil((estadoApp.bloqueadoHasta - new Date()) / 60000);
    document.getElementById('login-blocked').style.display = 'block';
    return;
  }
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;
  if (!email || !pass) { mostrarLoginError('Completá email y contraseña'); return; }
  document.getElementById('login-btn-text').style.display = 'none';
  document.getElementById('login-btn-loading').style.display = 'inline-flex';
  document.getElementById('login-error').style.display = 'none';
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  document.getElementById('login-btn-text').style.display = 'inline';
  document.getElementById('login-btn-loading').style.display = 'none';
  if (error) {
    estadoApp.intentosLogin++;
    if (estadoApp.intentosLogin >= MAX_INTENTOS) {
      estadoApp.bloqueadoHasta = new Date(Date.now() + 30 * 60 * 1000);
      estadoApp.intentosLogin = 0;
      document.getElementById('login-blocked').style.display = 'block';
    } else {
      mostrarLoginError('Email o contraseña incorrectos');
      const av = document.getElementById('intentos-aviso');
      av.style.display = 'block';
      av.textContent = `Intentos restantes: ${MAX_INTENTOS - estadoApp.intentosLogin}`;
    }
  }
}

function mostrarLoginError(msg) { const el = document.getElementById('login-error'); el.textContent = msg; el.style.display = 'block'; }
async function cerrarSesion() { await sb.auth.signOut(); estadoApp.usuario=null; estadoApp.perfil=null; mostrarLogin(); }
function togglePassword() { const i = document.getElementById('login-password'); i.type = i.type === 'password' ? 'text' : 'password'; }

function iniciarTimerInactividad() {
  const reset = () => {
    clearTimeout(estadoApp.inactivoTimer);
    if (estadoApp.usuario) estadoApp.inactivoTimer = setTimeout(async () => { await cerrarSesion(); mostrarToast('Sesión cerrada por inactividad', 'info'); }, INACTIVO_MS);
  };
  ['touchstart','click','keypress','scroll'].forEach(e => document.addEventListener(e, reset));
  reset();
}

async function cargarPerfil(usuario) {
  estadoApp.usuario = usuario;
  const { data } = await sb.from('perfiles').select('*').eq('id', usuario.id).single();
  estadoApp.perfil = data;
  aplicarRol(data?.rol || 'cliente');
  const av = document.getElementById('topbar-avatar');
  if (av && data) av.textContent = data.nombre?.substring(0, 2).toUpperCase() || 'US';
}

function aplicarRol(rol) {
  document.querySelectorAll('.admin-only').forEach(el => el.style.display = rol === 'admin' ? '' : 'none');
}

function mostrarApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  if (estadoApp.perfil?.rol === 'cliente') {
    navegarA('portal-cliente');
    document.getElementById('bottom-nav').style.display = 'none';
  } else {
    navegarA('dashboard');
  }
  iniciarTimerInactividad();
}

function mostrarLogin() {
  document.getElementById('screen-login').style.display = 'block';
  document.getElementById('app').style.display = 'none';
}

// =============================================
// NAVEGACIÓN (simplificada)
// =============================================
const paginasConBotonAtras = ['nuevo-pedido','resumen-pedido','detalle-cliente','form-cliente','nuevo-cobro','nueva-factura','entrega-dia','reclamos','productos','reportes','rendicion','comisiones','hoja-ruta','config','actualizar-precios','facturas'];

const TITULOS = {
  'dashboard':'La Cabaña','pedidos':'Pedidos','nuevo-pedido':'Nuevo pedido','resumen-pedido':'Tu pedido',
  'clientes':'Clientes','detalle-cliente':'Cliente','form-cliente':'Cliente',
  'cobros':'Cobros','nuevo-cobro':'Registrar cobro','facturas':'Facturas y remitos','nueva-factura':'Nuevo documento',
  'entrega-dia':'Entrega del día','reclamos':'Reclamos','productos':'Productos',
  'reportes':'Reportes','rendicion':'Rendición','comisiones':'Mis comisiones','hoja-ruta':'Hoja de ruta',
  'mas':'Menú','config':'Configuración','actualizar-precios':'Lista de precios','portal-cliente':'Mi cuenta',
};

const NAV_MAP = { 
  'dashboard':'dashboard','pedidos':'pedidos','nuevo-pedido':'pedidos','resumen-pedido':'pedidos',
  'clientes':'clientes','detalle-cliente':'clientes','form-cliente':'clientes',
  'cobros':'cobros','nuevo-cobro':'cobros',
  'mas':'mas','facturas':'mas','nueva-factura':'mas','reclamos':'mas','productos':'mas',
  'reportes':'mas','rendicion':'mas','comisiones':'mas','config':'mas','actualizar-precios':'mas','hoja-ruta':'mas','entrega-dia':'mas'
};

function navegarA(pagina) {
  if (pagina === 'resumen-pedido') cargarResumenPedido();
  
  // Ocultar todas las páginas
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pagina}`);
  if (!target) { console.error('Página no encontrada:', pagina); return; }
  target.classList.add('active');

  // Guardar navegación
  if (estadoApp.paginaActual && estadoApp.paginaActual !== pagina) {
    estadoApp.paginaAnterior = estadoApp.paginaActual;
  }
  estadoApp.paginaActual = pagina;

  // Topbar
  document.getElementById('topbar-title').textContent = TITULOS[pagina] || pagina;
  const esInicio = pagina === 'dashboard' || pagina === 'portal-cliente';
  const saludo = document.getElementById('topbar-greeting');
  if (esInicio && estadoApp.perfil) {
    const h = new Date().getHours();
    saludo.textContent = `${h<12?'Buen día':h<19?'Buenas tardes':'Buenas noches'}, ${estadoApp.perfil.nombre?.split(' ')[0]||''}`;
    saludo.style.display = 'block';
  } else { saludo.style.display = 'none'; }

  // Botón atrás
  document.getElementById('btn-back').style.display = paginasConBotonAtras.includes(pagina) ? 'flex' : 'none';

  // Nav inferior
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navKey = NAV_MAP[pagina];
  if (navKey) document.getElementById(`nav-${navKey}`)?.classList.add('active');

  // Scroll top
  document.getElementById('main-content').scrollTop = 0;

  // Cargar datos
  cargarPagina(pagina);
}

function volverAtras() {
  const anterior = estadoApp.paginaAnterior || 'dashboard';
  const pagDesde = estadoApp.paginaActual;
  // Si vuelvo desde detalle/form cliente vuelvo a clientes
  if (pagDesde === 'detalle-cliente' || pagDesde === 'form-cliente') {
    navegarA('clientes'); return;
  }
  if (pagDesde === 'nuevo-cobro' || pagDesde === 'nueva-factura') {
    if (estadoApp.clienteActual) { navegarA('detalle-cliente'); return; }
    navegarA(pagDesde === 'nuevo-cobro' ? 'cobros' : 'facturas'); return;
  }
  if (pagDesde === 'resumen-pedido') { navegarA('nuevo-pedido'); return; }
  if (pagDesde === 'nuevo-pedido') { navegarA('pedidos'); return; }
  navegarA(anterior);
}

async function cargarPagina(pagina) {
  switch(pagina) {
    case 'dashboard': await cargarDashboard(); break;
    case 'pedidos': await cargarPedidos(); break;
    case 'clientes': await cargarClientes(); break;
    case 'cobros': await cargarCobros(); break;
    case 'facturas': await cargarFacturas(); break;
    case 'nuevo-pedido': await cargarCatalogo(); break;
    case 'nuevo-cobro': await cargarFormCobro(); break;
    case 'nueva-factura': await cargarFormFactura(); break;
    case 'entrega-dia': await cargarEntregasDia(); break;
    case 'reclamos': await cargarReclamos(); break;
    case 'productos': await cargarProductos(); break;
    case 'rendicion': await cargarRendicion(); break;
    case 'comisiones': await cargarComisiones('mes'); break;
    case 'hoja-ruta': await cargarHojaRuta(); break;
    case 'config': await cargarConfig(); break;
    case 'actualizar-precios': await cargarFormPrecios(); break;
    case 'portal-cliente': await cargarPortalCliente(); break;
    case 'reportes': await cargarSelectClientes(); break;
    case 'detalle-cliente': if (estadoApp.clienteActual) await cargarDetalleCliente(estadoApp.clienteActual); break;
  }
}

// =============================================
// DASHBOARD
// =============================================
async function cargarDashboard() {
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  const inicioAnio = new Date(hoy.getFullYear(), 0, 1).toISOString().split('T')[0];
  const fechaHoy = hoy.toISOString().split('T')[0];

  const { data: pedidosMes } = await sb.from('pedidos').select('id,total,estado,fecha_pedido,numero,cliente_id,clientes(razon_social)').gte('fecha_pedido', inicioMes).neq('estado', 'cancelado');
  document.getElementById('kpi-ventas').textContent = formatMoney(pedidosMes?.reduce((s,p) => s+(p.total||0), 0)||0);
  const pedidosHoy = pedidosMes?.filter(p => p.fecha_pedido === fechaHoy)||[];
  document.getElementById('kpi-pedidos').textContent = pedidosHoy.length;
  document.getElementById('kpi-pedidos-sub').textContent = `${pedidosHoy.filter(p=>p.estado==='pendiente').length} pendientes`;

  const { data: pedSinCobrar } = await sb.from('pedidos').select('id,total,numero,cliente_id,clientes(razon_social)').eq('estado','entregado');
  document.getElementById('kpi-cobrar').textContent = formatMoney(pedSinCobrar?.reduce((s,p)=>s+(p.total||0),0)||0);
  document.getElementById('kpi-cobrar-sub').textContent = `${pedSinCobrar?.length||0} pedidos`;

  const { data: cobrosData } = await sb.from('cobros').select('monto,rendido');
  document.getElementById('kpi-rendir').textContent = formatMoney(cobrosData?.filter(c=>!c.rendido).reduce((s,c)=>s+(c.monto||0),0)||0);

  if (estadoApp.perfil?.rol === 'admin') {
    const { data: cm } = await sb.from('comisiones').select('monto_comision').gte('created_at', inicioMes);
    const { data: ca } = await sb.from('comisiones').select('monto_comision').gte('created_at', inicioAnio);
    document.getElementById('kpi-comisiones-mes').textContent = formatMoney(cm?.reduce((s,c)=>s+c.monto_comision,0)||0);
    document.getElementById('kpi-comisiones-anio').textContent = formatMoney(ca?.reduce((s,c)=>s+c.monto_comision,0)||0);
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }

  await cargarAlertas(pedSinCobrar||[]);
  renderUltimosPedidos((pedidosMes||[]).slice(-3).reverse());
}

async function cargarAlertas(pedSinCobrar) {
  const container = document.getElementById('alertas-container');
  const alertas = [];
  pedSinCobrar?.slice(0,5).forEach(p => alertas.push({ tipo:'danger', icon:'ti-alert-circle', titulo:`${p.clientes?.razon_social||'Cliente'} — pendiente de cobro`, sub:`${formatMoney(p.total)}` }));
  container.innerHTML = alertas.length ? alertas.map(a=>`<div class="alert-card ${a.tipo}"><i class="ti ${a.icon}"></i><div><p class="alert-title">${a.titulo}</p><p class="alert-sub">${a.sub}</p></div></div>`).join('') : '<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">Sin alertas por ahora ✓</p>';
}

function renderUltimosPedidos(pedidos) {
  document.getElementById('ultimos-pedidos-container').innerHTML = pedidos.length ? pedidos.map(p=>`
    <div class="pedido-card" onclick="abrirPedido('${p.id}')">
      <div class="pedido-card-header"><div><p class="pedido-card-nombre">${p.clientes?.razon_social||'Cliente'}</p><p class="pedido-card-num">#${String(p.numero||0).padStart(4,'0')} · ${formatFecha(p.fecha_pedido)}</p></div><span class="badge ${p.estado}">${estadoLabel(p.estado)}</span></div>
      <div class="pedido-card-footer"><p class="pedido-card-total">${formatMoney(p.total)}</p></div>
    </div>`).join('') : '<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">No hay pedidos este mes</p>';
}

// =============================================
// PEDIDOS
// =============================================
async function cargarPedidos(filtro='todos') {
  const container = document.getElementById('pedidos-container');
  container.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
  
  let query = sb.from('pedidos').select('id,numero,total,estado,fecha_pedido,cliente_id,clientes(razon_social)').order('created_at',{ascending:false});
  if (filtro !== 'todos') query = query.eq('estado',filtro);
  if (estadoApp.perfil?.rol === 'cliente') {
    const { data: cli } = await sb.from('clientes').select('id').eq('user_id',estadoApp.usuario.id).single();
    if (cli) query = query.eq('cliente_id',cli.id);
  }
  const { data: pedidos, error } = await query.limit(100);
  if (error) { container.innerHTML = '<p style="color:#e24b4a;font-size:12px;text-align:center;padding:20px;">Error: '+error.message+'</p>'; return; }
  
  container.innerHTML = (pedidos||[]).length ? (pedidos||[]).map(p=>`
    <div class="pedido-card" onclick="abrirPedido('${p.id}')">
      <div class="pedido-card-header"><div><p class="pedido-card-nombre">${p.clientes?.razon_social||'Cliente'}</p><p class="pedido-card-num">#${String(p.numero||0).padStart(4,'0')} · ${formatFecha(p.fecha_pedido)}</p></div><span class="badge ${p.estado}">${estadoLabel(p.estado)}</span></div>
      <div class="pedido-card-footer"><p class="pedido-card-total">${formatMoney(p.total)}</p>
        <div style="display:flex;gap:6px;">
          ${p.estado==='pendiente'?`<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();confirmarEstadoPedido('${p.id}','confirmado')">Confirmar</button>`:''}
          ${p.estado==='entregado'?`<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();estadoApp.pedidoParaCobro='${p.id}';navegarA('nuevo-cobro')">Cobrar</button>`:''}
        </div>
      </div>
    </div>`).join('') : '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay pedidos</p>';
}

function filtrarPedidos(filtro, ev) {
  document.querySelectorAll('#pedidos-filtros .filter-tab').forEach(t=>t.classList.remove('active'));
  (ev||event).target.classList.add('active');
  cargarPedidos(filtro);
}

async function confirmarEstadoPedido(id, estado) {
  await sb.from('pedidos').update({estado,updated_at:new Date().toISOString()}).eq('id',id);
  mostrarToast('Estado actualizado ✓','success');
  await cargarPedidos();
}

async function abrirPedido(id) {
  const { data: p } = await sb.from('pedidos').select('*,clientes(razon_social)').eq('id',id).single();
  if (!p) return;
  const { data: items } = await sb.from('pedido_items').select('*,productos(nombre)').eq('pedido_id',id);
  abrirModal(`Pedido #${String(p.numero||0).padStart(4,'0')}`,`
    <p style="font-size:13px;font-weight:500;margin-bottom:4px;">${p.clientes?.razon_social||''}</p>
    <p style="font-size:11px;color:#aaa;margin-bottom:10px;">${formatFecha(p.fecha_pedido)} · <span class="badge ${p.estado}">${estadoLabel(p.estado)}</span></p>
    <div style="background:#f5f3ef;border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      ${items?.map(i=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:0.5px solid #e8e5de;"><span style="font-size:12px;">${i.productos?.nombre} × ${i.cantidad}</span><span style="font-size:12px;font-weight:500;">${formatMoney(i.subtotal)}</span></div>`).join('')||''}
      <div style="display:flex;justify-content:space-between;padding-top:8px;"><span style="font-size:14px;font-weight:700;">Total</span><span style="font-size:14px;font-weight:700;">${formatMoney(p.total)}</span></div>
    </div>${p.observaciones?`<p style="font-size:12px;color:#aaa;">${p.observaciones}</p>`:''}`,
  [{ label:'Cargar factura', action:()=>{ cerrarModal(); estadoApp.pedidoParaDoc=id; navegarA('nueva-factura'); }, style:'btn-outline' },
   { label:'Registrar cobro', action:()=>{ cerrarModal(); estadoApp.pedidoParaCobro=id; navegarA('nuevo-cobro'); }, style:'btn-primary' }]);
}

// =============================================
// CATÁLOGO / NUEVO PEDIDO
// =============================================
let catalogoProductos = [];
let pedidoCantidades = {};

async function cargarCatalogo() {
  pedidoCantidades = {};
  estadoApp.pedidoActual = { clienteId:null, items:{}, obs:'' };
  document.getElementById('catalogo-container').style.display = 'none';
  document.getElementById('cliente-info').style.display = 'none';
  const { data: clientes } = await sb.from('clientes').select('id,razon_social,tipo_beneficio,beneficio_pct,tipo_iva').eq('activo',true).order('razon_social');
  const sel = document.getElementById('pedido-cliente');
  sel.innerHTML = '<option value="">Seleccioná un cliente...</option>' + (clientes||[]).map(c=>`<option value="${c.id}" data-beneficio="${c.tipo_beneficio||'ninguno'}" data-pct="${c.beneficio_pct||0}" data-iva="${c.tipo_iva||'sin_iva'}">${c.razon_social}</option>`).join('');
  const { data: prods } = await sb.from('productos').select('*,categorias(nombre)').eq('activo',true).order('nombre');
  catalogoProductos = prods||[];
  // Si vengo desde "nuevo pedido del cliente" preseleccionar
  if (estadoApp.preseleccionarCliente) {
    sel.value = estadoApp.preseleccionarCliente;
    estadoApp.preseleccionarCliente = null;
    onClienteSeleccionado();
  }
}

function onClienteSeleccionado() {
  const sel = document.getElementById('pedido-cliente');
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) { document.getElementById('catalogo-container').style.display='none'; document.getElementById('cliente-info').style.display='none'; return; }
  const beneficio = opt.dataset.beneficio||'ninguno';
  const pct = parseFloat(opt.dataset.pct)||0;
  const iva = opt.dataset.iva||'sin_iva';
  const ivaLabels = {mixto:'IVA mixto 10,5%',completo:'IVA 21%',sin_iva:'Sin IVA'};
  const badge = document.getElementById('cliente-beneficio-badge');
  badge.textContent = (beneficio==='descuento_pct'?`Desc. ${pct}%`:beneficio==='bonificacion_kg'?`Bonif. ${pct}% kg`:'Sin beneficio') + ` · ${ivaLabels[iva]||''}`;
  badge.className = 'info-box blue';
  document.getElementById('cliente-info').style.display = 'block';
  document.getElementById('catalogo-container').style.display = 'block';
  estadoApp.pedidoActual = { clienteId:sel.value, clienteBeneficio:beneficio, clientePct:pct, clienteIva:iva, items:{}, obs:'' };
  renderCatalogo(catalogoProductos);
}

function filtrarCatalogo(cat, ev) {
  document.querySelectorAll('#catalogo-container .filter-tab').forEach(t=>t.classList.remove('active'));
  (ev||event).target.classList.add('active');
  renderCatalogo(cat==='todos'?catalogoProductos:catalogoProductos.filter(p=>p.categorias?.nombre===cat));
}

function renderCatalogo(prods) {
  const beneficio = estadoApp.pedidoActual.clienteBeneficio||'ninguno';
  const pct = estadoApp.pedidoActual.clientePct||0;
  let html='', catActual='';
  prods.forEach(p => {
    if (p.categorias?.nombre !== catActual) { catActual=p.categorias?.nombre; html+=`<p class="section-title">${catActual||''}</p>`; }
    const tieneDesc = beneficio==='descuento_pct' && pct>0;
    const precioConDesc = tieneDesc ? p.precio_lista*(1-pct/100) : p.precio_lista;
    const qty = pedidoCantidades[p.id]||0;
    html += `<div class="producto-row">
      <div class="producto-row-header">
        <div class="producto-row-info">
          <p class="producto-row-nombre">${p.nombre}</p>
          <p class="producto-row-desc">${p.presentacion||''}</p>
          <p class="producto-row-precio">${p.tiene_precio?formatMoney(precioConDesc):'Precio pendiente'}${tieneDesc&&p.tiene_precio?`<span class="producto-row-precio-tachado">${formatMoney(p.precio_lista)}</span>`:''}</p>
        </div>
        <div class="qty-control">
          <button class="qty-btn${!p.tiene_precio?' disabled':''}" onclick="cambiarCantidad('${p.id}',-1)" ${!p.tiene_precio?'disabled':''}>−</button>
          <span class="qty-value" id="qty-${p.id}">${qty}</span>
          <button class="qty-btn${!p.tiene_precio?' disabled':''}" onclick="cambiarCantidad('${p.id}',1)" ${!p.tiene_precio?'disabled':''}>+</button>
        </div>
      </div>
      ${!p.tiene_precio?`<div class="producto-sin-precio"><p>Precio pendiente — próxima lista</p></div>`:''}
      <div class="producto-detalle${qty>0?' visible':''}" id="det-${p.id}">
        <span class="producto-detalle-texto" id="det-txt-${p.id}"></span>
        <span class="producto-detalle-subtotal" id="det-sub-${p.id}"></span>
      </div>
    </div>`;
  });
  document.getElementById('productos-catalogo').innerHTML = html;
  actualizarBarraTotal();
}

function cambiarCantidad(prodId, delta) {
  pedidoCantidades[prodId] = Math.max(0,(pedidoCantidades[prodId]||0)+delta);
  const qty = pedidoCantidades[prodId];
  const el = document.getElementById(`qty-${prodId}`);
  if (el) el.textContent = qty;
  const prod = catalogoProductos.find(p=>p.id===prodId);
  if (!prod) return;
  const pct = estadoApp.pedidoActual.clientePct||0;
  const beneficio = estadoApp.pedidoActual.clienteBeneficio||'ninguno';
  const precioBase = beneficio==='descuento_pct' ? prod.precio_lista*(1-pct/100) : prod.precio_lista;
  const det = document.getElementById(`det-${prodId}`);
  const txt = document.getElementById(`det-txt-${prodId}`);
  const sub = document.getElementById(`det-sub-${prodId}`);
  if (det && qty>0) {
    det.classList.add('visible');
    const unidad = prod.unidad_venta==='caja'?(qty===1?'1 caja':`${qty} cajas`):`${qty} unidades`;
    const bonif = beneficio==='bonificacion_kg'?` (+${(qty*pct/100).toFixed(1)} bonif.)`:'';
    if (txt) txt.textContent = unidad+bonif;
    if (sub) sub.textContent = formatMoney(qty*precioBase);
  } else if (det) { det.classList.remove('visible'); }
  actualizarBarraTotal();
}

function actualizarBarraTotal() {
  const beneficio = estadoApp.pedidoActual.clienteBeneficio||'ninguno';
  const pct = estadoApp.pedidoActual.clientePct||0;
  let total=0, items=0;
  Object.keys(pedidoCantidades).forEach(id => {
    if (pedidoCantidades[id]>0) {
      const prod = catalogoProductos.find(p=>p.id===id);
      if (prod?.tiene_precio) { const precio=beneficio==='descuento_pct'?prod.precio_lista*(1-pct/100):prod.precio_lista; total+=pedidoCantidades[id]*precio; items+=pedidoCantidades[id]; }
    }
  });
  const barra = document.getElementById('pedido-total-bar');
  if (!barra) return;
  if (items>0) {
    barra.style.display='flex';
    document.getElementById('total-bar-items').textContent=`${items} ${items===1?'producto':'productos'} seleccionados`;
    document.getElementById('total-bar-amount').textContent=formatMoney(total);
  } else { barra.style.display='none'; }
}

function cargarResumenPedido() {
  const beneficio = estadoApp.pedidoActual.clienteBeneficio||'ninguno';
  const pct = estadoApp.pedidoActual.clientePct||0;
  const iva = estadoApp.pedidoActual.clienteIva||'sin_iva';
  let subtotalLista=0, descuentoMonto=0, subtotalNeto=0, ivaMonto=0;
  const itemsRender=[];
  Object.keys(pedidoCantidades).forEach(id => {
    if (pedidoCantidades[id]>0) {
      const prod = catalogoProductos.find(p=>p.id===id);
      if (!prod?.tiene_precio) return;
      const cantidad=pedidoCantidades[id];
      const cantBonif=beneficio==='bonificacion_kg'?cantidad*pct/100:0;
      subtotalLista+=cantidad*prod.precio_lista;
      itemsRender.push({prod,cantidad,cantBonif,sub:cantidad*prod.precio_lista});
    }
  });
  if (beneficio==='descuento_pct') { descuentoMonto=subtotalLista*pct/100; subtotalNeto=subtotalLista-descuentoMonto; } else { subtotalNeto=subtotalLista; }
  if (iva==='completo') ivaMonto=subtotalNeto*0.21;
  else if (iva==='mixto') ivaMonto=(subtotalNeto/2)*0.21;
  const total=subtotalNeto+ivaMonto;
  document.getElementById('resumen-items-container').innerHTML=`<div class="card"><p class="section-title-sm">Productos</p>${itemsRender.map(i=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><div><p style="font-size:13px;font-weight:500;">${i.prod.nombre}</p><p style="font-size:10px;color:#aaa;">${i.cantidad} ${i.prod.unidad_venta==='caja'?'caja(s)':'unid.'}${i.cantBonif>0?` + ${i.cantBonif.toFixed(1)} bonif.`:''}</p></div><p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(i.sub)}</p></div>`).join('')}</div>`;
  document.getElementById('resumen-calculos').innerHTML=`<p class="section-title-sm">Cálculo</p><div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:12px;color:#aaa;">Subtotal lista</span><span style="font-size:12px;">${formatMoney(subtotalLista)}</span></div>${descuentoMonto>0?`<div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:12px;color:#3B6D11;">Desc. ${pct}%</span><span style="font-size:12px;color:#3B6D11;">− ${formatMoney(descuentoMonto)}</span></div>`:''}${beneficio==='bonificacion_kg'?`<div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:12px;color:#3B6D11;">Bonif. ${pct}% kg</span><span style="font-size:12px;color:#3B6D11;">incluida</span></div>`:''}${ivaMonto>0?`<div style="background:#e6f1fb;border-radius:8px;padding:8px 10px;margin-bottom:8px;"><p style="font-size:11px;color:#185FA5;font-weight:500;">IVA ${iva==='mixto'?'mixto (10,5% ef.)':'21% completo'}</p><div style="display:flex;justify-content:space-between;margin-top:4px;"><span style="font-size:11px;color:#185FA5;">IVA</span><span style="font-size:11px;color:#185FA5;">${formatMoney(ivaMonto)}</span></div></div>`:''}${iva==='sin_iva'?`<div style="background:#eaf3de;border-radius:8px;padding:6px 10px;margin-bottom:8px;"><p style="font-size:11px;color:#3B6D11;">Sin IVA — cliente exento</p></div>`:''}<div style="display:flex;justify-content:space-between;border-top:0.5px solid #f0ede6;padding-top:8px;"><span style="font-size:16px;font-weight:700;font-family:'Playfair Display',serif;">Total</span><span style="font-size:16px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(total)}</span></div>`;
  Object.assign(estadoApp.pedidoActual,{subtotalLista,descuentoMonto,subtotalNeto,ivaMonto,total});
}

async function confirmarPedido() {
  if (!estadoApp.pedidoActual.clienteId) { mostrarToast('Seleccioná un cliente','error'); return; }
  const itemsArr = Object.keys(pedidoCantidades).filter(id=>pedidoCantidades[id]>0).map(id=>{
    const prod=catalogoProductos.find(p=>p.id===id);
    const pct=estadoApp.pedidoActual.clientePct||0;
    const beneficio=estadoApp.pedidoActual.clienteBeneficio||'ninguno';
    const precioUnit=beneficio==='descuento_pct'?prod.precio_lista*(1-pct/100):prod.precio_lista;
    return {producto_id:id,cantidad:pedidoCantidades[id],cantidad_bonificada:beneficio==='bonificacion_kg'?pedidoCantidades[id]*pct/100:0,precio_lista:prod.precio_lista,precio_unitario:precioUnit,subtotal:pedidoCantidades[id]*precioUnit};
  });
  if (!itemsArr.length) { mostrarToast('Agregá al menos un producto','error'); return; }
  const { data: pedido, error } = await sb.from('pedidos').insert({cliente_id:estadoApp.pedidoActual.clienteId,estado:'pendiente',subtotal_lista:estadoApp.pedidoActual.subtotalLista||0,descuento_monto:estadoApp.pedidoActual.descuentoMonto||0,subtotal_neto:estadoApp.pedidoActual.subtotalNeto||0,iva_monto:estadoApp.pedidoActual.ivaMonto||0,total:estadoApp.pedidoActual.total||0,observaciones:document.getElementById('pedido-obs')?.value||'',created_by:estadoApp.usuario.id}).select().single();
  if (error) { mostrarToast('Error: '+error.message,'error'); console.error(error); return; }
  await sb.from('pedido_items').insert(itemsArr.map(i=>({...i,pedido_id:pedido.id})));
  await logActividad('crear_pedido','pedidos',pedido.id);
  mostrarToast('Pedido confirmado ✓','success');
  pedidoCantidades={};
  estadoApp.pedidoActual={clienteId:null,items:{},obs:''};
  navegarA('pedidos');
}

function enviarPresupuestoWhatsapp() {
  const sel=document.getElementById('pedido-cliente');
  const nombre=sel.options[sel.selectedIndex]?.text||'';
  const txt=`*Presupuesto La Cabaña*\nCliente: ${nombre}\n${Object.keys(pedidoCantidades).filter(id=>pedidoCantidades[id]>0).map(id=>{const p=catalogoProductos.find(p=>p.id===id);return `${p.nombre} x${pedidoCantidades[id]}`;}).join('\n')}\n*Total: ${formatMoney(estadoApp.pedidoActual.total||0)}*`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`);
}

async function guardarFavorito() {
  const nombre=prompt('Nombre para este pedido favorito:');
  if (!nombre) return;
  await sb.from('pedidos_favoritos').insert({cliente_id:estadoApp.pedidoActual.clienteId,nombre,items:pedidoCantidades});
  mostrarToast('Guardado como favorito ✓','success');
}

// =============================================
// CLIENTES
// =============================================
async function cargarClientes(busqueda='') {
  const container = document.getElementById('clientes-container');
  container.innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>';
  let query=sb.from('clientes').select('id,razon_social,cuit,tipo_beneficio,beneficio_pct,tipo_iva,objetivo_kg_mensual,activo').eq('activo',true).order('razon_social');
  if (busqueda) query=query.ilike('razon_social',`%${busqueda}%`);
  const { data: clientes, error } = await query;
  if (error) { container.innerHTML='<p style="color:#e24b4a;font-size:12px;text-align:center;padding:20px;">Error: '+error.message+'</p>'; return; }
  await renderClientes(clientes||[]);
}

function buscarClientes(val) { cargarClientes(val); }

async function renderClientes(clientes) {
  const container=document.getElementById('clientes-container');
  if (!clientes.length) { container.innerHTML='<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay clientes</p>'; return; }
  const hoy=new Date();
  const inicioMes=new Date(hoy.getFullYear(),hoy.getMonth(),1).toISOString().split('T')[0];
  const colores=['#eeedfe','#eaf3de','#faeeda','#e6f1fb','#e1f5ee'];
  const html=await Promise.all(clientes.map(async c=>{
    let kgMes=0;
    const { data: peds } = await sb.from('pedidos').select('id').eq('cliente_id',c.id).gte('fecha_pedido',inicioMes).neq('estado','cancelado');
    if (peds?.length) { const { data: items } = await sb.from('pedido_items').select('cantidad').in('pedido_id',peds.map(p=>p.id)); kgMes=items?.reduce((s,i)=>s+(i.cantidad||0),0)||0; }
    const initials=c.razon_social.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const color=colores[c.razon_social.length%colores.length];
    let barraHtml='';
    if (c.objetivo_kg_mensual) {
      const pct=Math.min(100,(kgMes/c.objetivo_kg_mensual)*100);
      const clase=pct>=80?'ok':pct>=50?'warning':'danger';
      barraHtml=`<div class="objetivo-bar"><div class="objetivo-bar-header"><span class="objetivo-bar-label">Obj: ${c.objetivo_kg_mensual.toLocaleString()} kg/mes</span><span class="objetivo-bar-valor ${clase}">${Math.round(kgMes)} kg${pct>=80?' ✓':pct<50?' — en riesgo':' — cuidado'}</span></div><div class="progress-bar"><div class="progress-fill ${clase}" style="width:${pct}%;"></div></div></div>`;
    } else { barraHtml=`<div class="objetivo-bar"><span style="font-size:10px;color:#aaa;">Sin objetivo · ${Math.round(kgMes).toLocaleString()} kg este mes</span></div>`; }
    return `<div class="cliente-card" onclick="abrirCliente('${c.id}')" style="cursor:pointer;"><div class="cliente-card-header"><div class="cliente-avatar" style="background:${color};">${initials}</div><div class="cliente-card-info"><p class="cliente-card-nombre">${c.razon_social}</p><p class="cliente-card-sub">${beneficioLabel(c)}</p></div><i class="ti ti-chevron-right" style="font-size:16px;color:#ccc;"></i></div>${barraHtml}</div>`;
  }));
  container.innerHTML=html.join('');
}

function beneficioLabel(c) { return c.tipo_beneficio==='descuento_pct'?`Desc. ${c.beneficio_pct}%`:c.tipo_beneficio==='bonificacion_kg'?`Bonif. ${c.beneficio_pct}% kg`:'Sin beneficio'; }

async function abrirCliente(id) {
  const { data: c, error } = await sb.from('clientes').select('*').eq('id',id).single();
  if (error || !c) { mostrarToast('Error al cargar cliente','error'); return; }
  estadoApp.clienteActual = c;
  document.getElementById('topbar-title').textContent = c.razon_social;
  navegarA('detalle-cliente');
}

async function cargarDetalleCliente(c) {
  document.getElementById('topbar-title').textContent = c.razon_social;
  
  // Resetear a tab Resumen
  document.querySelectorAll('#page-detalle-cliente .tab-content').forEach(t=>t.style.display='none');
  document.querySelectorAll('#page-detalle-cliente .tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('tab-resumen-cliente').style.display='block';
  document.querySelectorAll('#page-detalle-cliente .tab')[0]?.classList.add('active');
  
  const hoy=new Date();
  const inicioMes=new Date(hoy.getFullYear(),hoy.getMonth(),1).toISOString().split('T')[0];
  const { data: pedidos } = await sb.from('pedidos').select('id,total,estado,fecha_pedido,numero').eq('cliente_id',c.id).neq('estado','cancelado').order('fecha_pedido',{ascending:false});
  const { data: cobros } = await sb.from('cobros').select('id,monto,forma_pago,fecha_cobro,notas').eq('cliente_id',c.id).order('fecha_cobro',{ascending:false});
  let kgMes=0;
  const pedMes=pedidos?.filter(p=>p.fecha_pedido>=inicioMes).map(p=>p.id)||[];
  if (pedMes.length) { const { data: items } = await sb.from('pedido_items').select('cantidad').in('pedido_id',pedMes); kgMes=items?.reduce((s,i)=>s+(i.cantidad||0),0)||0; }
  const totalComprado=pedidos?.reduce((s,p)=>s+p.total,0)||0;
  const totalCobrado=cobros?.reduce((s,co)=>s+co.monto,0)||0;
  const saldo=totalComprado-totalCobrado;
  
  // KPIs
  document.getElementById('cli-total-comprado').textContent=formatMoney(totalComprado);
  document.getElementById('cli-saldo').textContent=formatMoney(saldo);
  document.getElementById('cli-saldo').className=`kpi-value ${saldo>0?'danger':'green'}`;
  document.getElementById('cli-kg-mes').textContent=Math.round(kgMes).toLocaleString();
  document.getElementById('cli-descuento').textContent=c.tipo_beneficio==='descuento_pct'?`${c.beneficio_pct}%`:c.tipo_beneficio==='bonificacion_kg'?`${c.beneficio_pct}% kg`:'—';
  document.getElementById('cli-total-pagado').textContent=formatMoney(totalCobrado);
  document.getElementById('cli-pendiente').textContent=formatMoney(saldo>0?saldo:0);
  
  // Objetivo
  if (c.objetivo_kg_mensual) {
    const pct=Math.min(100,(kgMes/c.objetivo_kg_mensual)*100);
    const clase=pct>=80?'ok':pct>=50?'warning':'danger';
    const msgs={ok:'Cumple objetivo — descuento asegurado',warning:'Cuidado — quedan días del mes',danger:'En riesgo — puede que pierda el descuento'};
    const colores={ok:'#3B6D11',warning:'#BA7517',danger:'#e24b4a'};
    document.getElementById('cli-objetivo-section').innerHTML=`<div class="objetivo-section"><div class="objetivo-header"><span class="objetivo-label">${c.objetivo_kg_mensual.toLocaleString()} kg / mes</span><span class="objetivo-valor ${clase}">${Math.round(kgMes).toLocaleString()} kg</span></div><div class="progress-bar" style="height:8px;"><div class="progress-fill ${clase}" style="width:${pct}%;"></div></div><p class="objetivo-msg" style="color:${colores[clase]};">${msgs[clase]}</p></div>`;
  } else { document.getElementById('cli-objetivo-section').innerHTML=''; }
  
  // Último pedido
  const ultimo=pedidos?.[0];
  document.getElementById('cli-ultimo-pedido').innerHTML=ultimo?`<div class="card" style="margin-bottom:12px;cursor:pointer;" onclick="abrirPedido('${ultimo.id}')"><div style="display:flex;justify-content:space-between;align-items:center;"><div><p style="font-size:13px;font-weight:500;">Último pedido #${String(ultimo.numero||0).padStart(4,'0')}</p><p style="font-size:11px;color:#aaa;">${formatFecha(ultimo.fecha_pedido)} · ${formatMoney(ultimo.total)}</p></div><span class="badge ${ultimo.estado}">${estadoLabel(ultimo.estado)}</span></div></div>`:'';
  
  // Tab Pedidos
  document.getElementById('historial-pedidos-cliente').innerHTML = (pedidos||[]).length ? (pedidos||[]).map(p=>`
    <div class="pedido-card" onclick="abrirPedido('${p.id}')" style="cursor:pointer;">
      <div class="pedido-card-header"><div><p class="pedido-card-nombre">Pedido #${String(p.numero||0).padStart(4,'0')}</p><p class="pedido-card-num">${formatFecha(p.fecha_pedido)}</p></div><span class="badge ${p.estado}">${estadoLabel(p.estado)}</span></div>
      <div class="pedido-card-footer"><p class="pedido-card-total">${formatMoney(p.total)}</p></div>
    </div>`).join('') : '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">Sin pedidos</p>';
  
  // Tab Pagos
  document.getElementById('historial-pagos-cliente').innerHTML = (cobros||[]).length ? (cobros||[]).map(co=>`
    <div class="card" style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><p style="font-size:13px;font-weight:500;">${formasPagoLabel(co.forma_pago)}</p><p style="font-size:11px;color:#aaa;">${formatFecha(co.fecha_cobro)}${co.notas?' · '+co.notas:''}</p></div>
        <p style="font-size:14px;font-weight:700;color:#3B6D11;font-family:'Playfair Display',serif;">${formatMoney(co.monto)}</p>
      </div>
    </div>`).join('') : '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">Sin pagos registrados</p>';
  
  // Tab Facturas
  const { data: docs } = await sb.from('documentos').select('*,pedidos(numero)').eq('cliente_id',c.id).order('created_at',{ascending:false});
  document.getElementById('historial-facturas-cliente').innerHTML = (docs||[]).length ? (docs||[]).map(d=>`
    <div class="card" style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <p style="font-size:13px;font-weight:500;">${d.tipo==='factura'?'Factura':'Remito'} ${d.numero_doc||''}</p>
          <p style="font-size:11px;color:#aaa;">${formatFecha(d.fecha_emision)}${d.pedidos?` · Pedido #${String(d.pedidos.numero||0).padStart(4,'0')}`:''}</p>
          ${d.notas?`<p style="font-size:11px;color:#888;margin-top:4px;">${d.notas}</p>`:''}
        </div>
        <div style="text-align:right;">
          <p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(d.monto)}</p>
          <span class="badge ${d.verificado?'cobrado':'pendiente'}">${d.verificado?'Verificado':'Pendiente'}</span>
        </div>
      </div>
    </div>`).join('') : '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">Sin facturas ni remitos</p>';
  
  // Tab Datos
  document.getElementById('datos-cliente-form').innerHTML=`<div class="card" style="padding:8px 14px;margin-bottom:8px;">
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">Razón social</span><span style="font-size:13px;font-weight:500;">${c.razon_social}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">CUIT</span><span style="font-size:13px;">${c.cuit||'—'}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">Teléfono</span><span style="font-size:13px;">${c.telefono||'—'}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">WhatsApp</span><span style="font-size:13px;color:#534AB7;">${c.whatsapp||'—'}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">Email</span><span style="font-size:13px;">${c.email||'—'}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">Dirección</span><span style="font-size:13px;">${c.direccion_entrega||'—'}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">IVA</span><span style="font-size:13px;">${c.tipo_iva==='mixto'?'Mixto (10,5%)':c.tipo_iva==='completo'?'21%':'Sin IVA'}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;"><span style="font-size:12px;color:#aaa;width:100px;">Objetivo</span><span style="font-size:13px;">${c.objetivo_kg_mensual?c.objetivo_kg_mensual.toLocaleString()+' kg/mes':'—'}</span></div>
    <div style="display:flex;align-items:center;padding:8px 0;"><span style="font-size:12px;color:#aaa;width:100px;">Portal</span><span class="badge ${c.tiene_portal?'cobrado':'pendiente'}">${c.tiene_portal?'Activo':'Inactivo'}</span></div>
  </div>${c.notas_internas?`<div class="card"><p class="section-title-sm">Notas internas</p><p style="font-size:12px;color:#555;line-height:1.5;">${c.notas_internas}</p></div>`:''}
  <button class="btn btn-outline btn-full" onclick="editarCliente('${c.id}')"><i class="ti ti-edit"></i> Editar datos del cliente</button>`;
}

function nuevoPedidoCliente() {
  if (!estadoApp.clienteActual) return;
  estadoApp.preseleccionarCliente = estadoApp.clienteActual.id;
  navegarA('nuevo-pedido');
}

function nuevoCobroDesdeCliente() {
  if (!estadoApp.clienteActual) return;
  navegarA('nuevo-cobro');
}

function nuevaFacturaDesdeCliente() {
  if (!estadoApp.clienteActual) return;
  navegarA('nueva-factura');
}

function contactarWhatsapp() { const wa=estadoApp.clienteActual?.whatsapp||estadoApp.clienteActual?.telefono; if (wa) window.open(`https://wa.me/${wa.replace(/\D/g,'')}`); }

async function editarCliente(id) {
  const { data: c, error } = await sb.from('clientes').select('*').eq('id',id).single();
  if (error || !c) { mostrarToast('Error al cargar cliente','error'); return; }
  estadoApp.clienteActual = c;
  navegarA('form-cliente');
  setTimeout(()=>{
    document.getElementById('cli-razon').value=c.razon_social||'';
    document.getElementById('cli-cuit').value=c.cuit||'';
    document.getElementById('cli-tel').value=c.telefono||'';
    document.getElementById('cli-wa').value=c.whatsapp||'';
    document.getElementById('cli-email').value=c.email||'';
    document.getElementById('cli-dir-entrega').value=c.direccion_entrega||'';
    document.getElementById('cli-dir-fact').value=c.direccion_facturacion||'';
    document.getElementById('cli-objetivo-kg').value=c.objetivo_kg_mensual||'';
    document.getElementById('cli-email-portal').value=c.email_portal||'';
    document.getElementById('cli-tiene-portal').checked=c.tiene_portal||false;
    document.getElementById('cli-notas').value=c.notas_internas||'';
    selBeneficio(c.tipo_beneficio||'ninguno');
    selIva(c.tipo_iva||'sin_iva');
    if (c.tipo_beneficio==='descuento_pct') document.getElementById('cli-beneficio-pct').value=c.beneficio_pct||0;
    if (c.tipo_beneficio==='bonificacion_kg') document.getElementById('cli-bonif-pct').value=c.beneficio_pct||0;
  },150);
}

function limpiarFormCliente() {
  ['cli-razon','cli-cuit','cli-tel','cli-wa','cli-email','cli-dir-entrega','cli-dir-fact','cli-objetivo-kg','cli-email-portal','cli-notas','cli-beneficio-pct','cli-bonif-pct'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const portal = document.getElementById('cli-tiene-portal');
  if (portal) portal.checked = false;
  estadoApp.clienteActual = null;
  setTimeout(()=>{ selBeneficio('ninguno'); selIva('sin_iva'); },50);
}

async function guardarCliente() {
  const razon=document.getElementById('cli-razon').value.trim();
  if (!razon) { mostrarToast('Ingresá la razón social','error'); return; }
  const beneficio = estadoApp.beneficioActual || 'ninguno';
  const iva = estadoApp.ivaActual || 'sin_iva';
  const data={
    razon_social:razon,
    cuit:document.getElementById('cli-cuit').value,
    telefono:document.getElementById('cli-tel').value,
    whatsapp:document.getElementById('cli-wa').value,
    email:document.getElementById('cli-email').value,
    direccion_entrega:document.getElementById('cli-dir-entrega').value,
    direccion_facturacion:document.getElementById('cli-dir-fact').value,
    tipo_beneficio:beneficio,
    beneficio_pct:beneficio==='descuento_pct'?parseFloat(document.getElementById('cli-beneficio-pct').value)||0:beneficio==='bonificacion_kg'?parseFloat(document.getElementById('cli-bonif-pct').value)||0:0,
    tipo_iva:iva,
    objetivo_kg_mensual:parseFloat(document.getElementById('cli-objetivo-kg').value)||null,
    email_portal:document.getElementById('cli-email-portal').value,
    tiene_portal:document.getElementById('cli-tiene-portal').checked,
    notas_internas:document.getElementById('cli-notas').value,
  };
  const id=estadoApp.clienteActual?.id;
  const result = id ? await sb.from('clientes').update(data).eq('id',id) : await sb.from('clientes').insert(data);
  if (result.error) { mostrarToast('Error: '+result.error.message,'error'); console.error(result.error); return; }
  await logActividad(id?'editar_cliente':'crear_cliente','clientes');
  mostrarToast(id?'Cliente actualizado ✓':'Cliente creado ✓','success');
  estadoApp.clienteActual=null;
  navegarA('clientes');
}

function selBeneficio(tipo) {
  estadoApp.beneficioActual=tipo;
  ['descuento_pct','bonificacion_kg','ninguno'].forEach(t=>{
    document.getElementById(`rd-${t}`)?.classList.toggle('selected',t===tipo);
    const campo=document.getElementById(`campo-${t}`);
    if (campo) campo.style.display=t===tipo?'block':'none';
    const opt=document.querySelector(`[onclick="selBeneficio('${t}')"]`);
    if (opt) opt.classList.toggle('selected',t===tipo);
  });
}

function selIva(tipo) {
  estadoApp.ivaActual=tipo;
  ['mixto','completo','sin_iva'].forEach(t=>document.getElementById(`iva-${t}`)?.classList.toggle('active',t===tipo));
  const msgs={mixto:'50% con IVA 21% · 50% sin IVA = 10,5% efectivo',completo:'IVA 21% completo sobre el total',sin_iva:'Cliente exento — no se agrega IVA'};
  const colors={mixto:'blue',completo:'amber',sin_iva:'green'};
  const box=document.getElementById('iva-descripcion');
  if (box) { box.textContent=msgs[tipo]; box.className=`info-box ${colors[tipo]}`; box.style.marginTop='8px'; }
}

// =============================================
// COBROS
// =============================================
async function cargarCobros() {
  const { data: cobros } = await sb.from('cobros').select('id,monto,forma_pago,fecha_cobro,rendido,cliente_id,clientes(razon_social),pedidos(numero)').order('fecha_cobro',{ascending:false}).limit(50);
  const { data: pedSinCobrar } = await sb.from('pedidos').select('id,total,numero,cliente_id,clientes(razon_social,whatsapp)').eq('estado','entregado');
  const hoy=new Date();
  document.getElementById('cobros-kpi-pendiente').textContent=formatMoney(pedSinCobrar?.reduce((s,p)=>s+p.total,0)||0);
  document.getElementById('cobros-kpi-cobrado').textContent=formatMoney(cobros?.filter(c=>{const f=new Date(c.fecha_cobro);return f.getMonth()===hoy.getMonth()&&f.getFullYear()===hoy.getFullYear();}).reduce((s,c)=>s+c.monto,0)||0);
  document.getElementById('cobros-kpi-rendir').textContent=formatMoney(cobros?.filter(c=>!c.rendido).reduce((s,c)=>s+c.monto,0)||0);
  if (estadoApp.perfil?.rol==='admin') { const { data: cp } = await sb.from('comisiones').select('monto_comision').eq('retirado',false); document.getElementById('cobros-kpi-comision').textContent=formatMoney(cp?.reduce((s,c)=>s+c.monto_comision,0)||0); }
  document.getElementById('cobros-urgentes').innerHTML=(pedSinCobrar||[]).map(p=>`<div class="card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;"><div><p style="font-size:13px;font-weight:500;">${p.clientes?.razon_social||''}</p><p style="font-size:11px;color:#aaa;">Pedido #${String(p.numero||0).padStart(4,'0')}</p></div><p style="font-size:15px;font-weight:700;color:#e24b4a;font-family:'Playfair Display',serif;">${formatMoney(p.total)}</p></div><div style="display:flex;gap:6px;"><button class="btn btn-sm btn-outline" onclick="enviarRecordatorioWa('${p.cliente_id}')"><i class="ti ti-brand-whatsapp"></i> Recordatorio</button><button class="btn btn-sm btn-primary" onclick="estadoApp.pedidoParaCobro='${p.id}';navegarA('nuevo-cobro')">Registrar cobro</button></div></div>`).join('')||'<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">Sin cobros urgentes ✓</p>';
  document.getElementById('cobros-recientes').innerHTML=(cobros||[]).slice(0,10).map(c=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div><p style="font-size:13px;font-weight:500;">${c.clientes?.razon_social||''}</p><p style="font-size:11px;color:#aaa;">${formasPagoLabel(c.forma_pago)} · ${formatFecha(c.fecha_cobro)}</p></div><p style="font-size:13px;font-weight:500;color:#3B6D11;">+${formatMoney(c.monto)}</p></div>`).join('');
}

async function cargarFormCobro() {
  // Limpiar formulario
  document.getElementById('cobro-monto').value='';
  document.getElementById('cobro-notas').value='';
  document.getElementById('cobro-fecha').value=new Date().toISOString().split('T')[0];
  selFormaPago('transferencia');
  
  const infoBox = document.getElementById('cobro-pedido-info');
  
  // Si venimos desde un pedido específico
  if (estadoApp.pedidoParaCobro) {
    const { data: p } = await sb.from('pedidos').select('*,clientes(razon_social)').eq('id',estadoApp.pedidoParaCobro).single();
    if (p) {
      infoBox.innerHTML = `<p style="font-size:13px;font-weight:500;">${p.clientes?.razon_social}</p><p style="font-size:11px;color:#aaa;">Pedido #${String(p.numero||0).padStart(4,'0')} · ${formatMoney(p.total)}</p>`;
      document.getElementById('cobro-monto').value = p.total;
    }
  } else if (estadoApp.clienteActual) {
    // Desde el cliente: mostrar pedidos sin cobrar de ese cliente
    const { data: peds } = await sb.from('pedidos').select('id,numero,total,fecha_pedido,estado').eq('cliente_id',estadoApp.clienteActual.id).in('estado',['entregado','en_camion','confirmado']).order('fecha_pedido',{ascending:false});
    infoBox.innerHTML = `<p style="font-size:13px;font-weight:500;margin-bottom:8px;">${estadoApp.clienteActual.razon_social}</p>
      <p style="font-size:11px;color:#aaa;margin-bottom:6px;">Pedido (opcional):</p>
      <select id="cobro-pedido-sel" class="form-select" onchange="onPedidoCobroSeleccionado()">
        <option value="">Sin asociar a pedido</option>
        ${(peds||[]).map(p=>`<option value="${p.id}" data-total="${p.total}">#${String(p.numero||0).padStart(4,'0')} · ${formatFecha(p.fecha_pedido)} · ${formatMoney(p.total)}</option>`).join('')}
      </select>`;
  } else {
    infoBox.innerHTML = `<p style="font-size:11px;color:#aaa;">Seleccioná un cliente o pedido primero</p>`;
  }
}

function onPedidoCobroSeleccionado() {
  const sel = document.getElementById('cobro-pedido-sel');
  const opt = sel.options[sel.selectedIndex];
  if (sel.value) {
    estadoApp.pedidoParaCobro = sel.value;
    document.getElementById('cobro-monto').value = opt.dataset.total || '';
  } else {
    estadoApp.pedidoParaCobro = null;
  }
}

async function guardarCobro() {
  const monto=parseFloat(document.getElementById('cobro-monto').value);
  const fecha=document.getElementById('cobro-fecha').value;
  if (!monto||!fecha) { mostrarToast('Completá monto y fecha','error'); return; }
  
  let clienteId = estadoApp.clienteActual?.id;
  if (!clienteId && estadoApp.pedidoParaCobro) {
    const { data: p } = await sb.from('pedidos').select('cliente_id').eq('id',estadoApp.pedidoParaCobro).single();
    clienteId = p?.cliente_id;
  }
  
  const { data: cobro, error } = await sb.from('cobros').insert({
    pedido_id:estadoApp.pedidoParaCobro||null,
    cliente_id:clienteId||null,
    monto,
    forma_pago:estadoApp.formaPagoActual,
    fecha_cobro:fecha,
    notas:document.getElementById('cobro-notas').value,
    rendido:false
  }).select().single();
  if (error) { mostrarToast('Error: '+error.message,'error'); return; }
  
  if (cobro && estadoApp.perfil?.rol==='admin') {
    const { data: config } = await sb.from('configuracion').select('comision_pct').single();
    const pct=config?.comision_pct||5;
    await sb.from('comisiones').insert({cobro_id:cobro.id,pedido_id:estadoApp.pedidoParaCobro||null,cliente_id:clienteId||null,monto_cobrado:monto,pct_comision:pct,monto_comision:monto*pct/100,retirado:false});
  }
  if (estadoApp.pedidoParaCobro) await sb.from('pedidos').update({estado:'cobrado',updated_at:new Date().toISOString()}).eq('id',estadoApp.pedidoParaCobro);
  await logActividad('registrar_cobro','cobros',cobro?.id);
  mostrarToast('Cobro registrado ✓','success');
  const volverACliente = !!estadoApp.clienteActual;
  estadoApp.pedidoParaCobro=null;
  if (volverACliente) navegarA('detalle-cliente'); else navegarA('cobros');
}

function selFormaPago(tipo) {
  estadoApp.formaPagoActual=tipo;
  ['transferencia','efectivo','cheque'].forEach(t=>document.getElementById(`fp-${t}`)?.classList.toggle('active',t===tipo));
  const labels={transferencia:'Foto del comprobante de transferencia',efectivo:'Foto de la orden de pago',cheque:'Foto del cheque'};
  const lbl=document.getElementById('cobro-foto-label');
  if (lbl) lbl.textContent=labels[tipo];
}

function formasPagoLabel(f) { return {transferencia:'Transferencia',efectivo:'Efectivo',cheque:'Cheque'}[f]||f; }
async function enviarRecordatorioWa(clienteId) { const { data: c } = await sb.from('clientes').select('whatsapp,telefono').eq('id',clienteId).single(); const num=(c?.whatsapp||c?.telefono||'').replace(/\D/g,''); if (num) window.open(`https://wa.me/${num}?text=${encodeURIComponent('Hola, le recordamos que tiene un pago pendiente. Muchas gracias. La Cabaña.')}`); }

// =============================================
// FACTURAS Y DOCUMENTOS
// =============================================
async function cargarFacturas(filtro='todos') {
  let query=sb.from('documentos').select('id,tipo,numero_doc,fecha_emision,monto,verificado,clientes(razon_social),pedidos(numero)').order('created_at',{ascending:false});
  if (filtro==='factura'||filtro==='remito') query=query.eq('tipo',filtro);
  if (filtro==='pendiente') query=query.eq('verificado',false);
  const { data: docs } = await query.limit(50);
  document.getElementById('facturas-container').innerHTML=(docs||[]).map(d=>`<div class="card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;"><div><p style="font-size:13px;font-weight:500;">${d.tipo==='factura'?'Factura':'Remito'} ${d.numero_doc||''}</p><p style="font-size:11px;color:#aaa;">${d.clientes?.razon_social||''} · ${formatFecha(d.fecha_emision)}</p>${d.pedidos?`<p style="font-size:11px;color:#aaa;">Pedido #${String(d.pedidos.numero||0).padStart(4,'0')}</p>`:''}</div><div style="text-align:right;"><p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(d.monto)}</p><span class="badge ${d.verificado?'cobrado':'pendiente'}">${d.verificado?'Verificado':'Pendiente'}</span></div></div></div>`).join('')||'<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay documentos</p>';
}

function filtrarDocs(filtro, ev) { document.querySelectorAll('#page-facturas .filter-tab').forEach(t=>t.classList.remove('active')); (ev||event).target.classList.add('active'); cargarFacturas(filtro); }

async function cargarFormFactura() {
  document.getElementById('doc-numero').value='';
  document.getElementById('doc-monto').value='';
  document.getElementById('doc-notas').value='';
  document.getElementById('doc-fecha-emision').value=new Date().toISOString().split('T')[0];
  selTipoDoc('factura');
  
  // Cargar pedidos del cliente actual o todos
  let query=sb.from('pedidos').select('id,numero,total,fecha_pedido,clientes(razon_social,tipo_iva)').neq('estado','cancelado').order('created_at',{ascending:false}).limit(100);
  if (estadoApp.clienteActual) query=query.eq('cliente_id',estadoApp.clienteActual.id);
  const { data: peds } = await query;
  const sel=document.getElementById('doc-pedido');
  sel.innerHTML='<option value="">Seleccioná un pedido...</option>'+(peds||[]).map(p=>`<option value="${p.id}" data-iva="${p.clientes?.tipo_iva||'sin_iva'}" data-total="${p.total}">#${String(p.numero||0).padStart(4,'0')} — ${p.clientes?.razon_social||''} — ${formatMoney(p.total)}</option>`).join('');
  
  if (estadoApp.pedidoParaDoc) { sel.value=estadoApp.pedidoParaDoc; onPedidoDocSeleccionado(); estadoApp.pedidoParaDoc=null; }
}

async function guardarDocumento() {
  const monto=parseFloat(document.getElementById('doc-monto').value);
  if (!monto) { mostrarToast('Ingresá el monto','error'); return; }
  const pedidoId=document.getElementById('doc-pedido').value;
  let clienteId=estadoApp.clienteActual?.id;
  if (pedidoId && !clienteId) { const { data: p } = await sb.from('pedidos').select('cliente_id').eq('id',pedidoId).single(); clienteId=p?.cliente_id; }
  const { error } = await sb.from('documentos').insert({pedido_id:pedidoId||null,cliente_id:clienteId,tipo:estadoApp.tipoDocActual,numero_doc:document.getElementById('doc-numero').value,fecha_emision:document.getElementById('doc-fecha-emision').value,fecha_vencimiento:document.getElementById('doc-fecha-vto').value||null,monto,notas:document.getElementById('doc-notas').value,verificado:false});
  if (error) { mostrarToast('Error: '+error.message,'error'); return; }
  mostrarToast('Documento guardado ✓','success');
  const volverACliente = !!estadoApp.clienteActual;
  if (volverACliente) navegarA('detalle-cliente'); else navegarA('facturas');
}

function selTipoDoc(tipo) { estadoApp.tipoDocActual=tipo; ['factura','remito'].forEach(t=>document.getElementById(`doc-${t}`)?.classList.toggle('active',t===tipo)); }

async function onPedidoDocSeleccionado() {
  const pedidoId=document.getElementById('doc-pedido').value;
  if (!pedidoId) return;
  const { data: p } = await sb.from('pedidos').select('total,subtotal_neto,clientes(tipo_iva)').eq('id',pedidoId).single();
  if (!p) return;
  const box=document.getElementById('doc-verificacion');
  box.style.display='block';
  const iva=p.clientes?.tipo_iva;
  if (iva==='mixto') { box.className='info-box blue'; box.innerHTML=`IVA mixto.<br>Factura esperada: ${formatMoney(p.total/2)}<br>Remito esperado: ${formatMoney((p.subtotal_neto||0)/2)}`; }
  else if (iva==='completo') { box.className='info-box blue'; box.textContent=`Factura esperada: ${formatMoney(p.total)}`; }
  else { box.className='info-box green'; box.textContent=`Remito esperado: ${formatMoney(p.total)}`; }
}

// =============================================
// ENTREGAS / RECLAMOS / PRODUCTOS / ETC
// =============================================
async function cargarEntregasDia() {
  const hoy=new Date().toISOString().split('T')[0];
  const { data: entregas } = await sb.from('entregas').select('id,estado_empresa,estado_cliente,nota_cliente,pedidos(numero,total,clientes(razon_social,whatsapp,direccion_entrega))').eq('fecha_entrega',hoy);
  const container=document.getElementById('entregas-hoy-container');
  container.innerHTML=(entregas||[]).length?(entregas||[]).map(e=>`<div class="card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;"><div><p style="font-size:13px;font-weight:500;">${e.pedidos?.clientes?.razon_social||''}</p><p style="font-size:11px;color:#aaa;">#${String(e.pedidos?.numero||0).padStart(4,'0')} · ${e.pedidos?.clientes?.direccion_entrega||''}</p></div><span class="badge ${e.estado_cliente==='recibido_conforme'?'cobrado':e.estado_cliente==='recibido_con_faltantes'?'sin_cobrar':'en_camion'}">${estadoEntregaLabel(e.estado_cliente)}</span></div>${e.estado_empresa==='pendiente'||e.estado_empresa==='en_camion'?`<div style="display:flex;gap:6px;"><button class="btn btn-sm" style="flex:1;background:#eaf3de;color:#3B6D11;border:none;" onclick="registrarEntregaEmpresa('${e.id}','envio_completo')">Envío completo</button><button class="btn btn-sm" style="flex:1;background:#faeeda;color:#854F0B;border:none;" onclick="registrarEntregaEmpresaDif('${e.id}')">Con diferencias</button></div>`:`<div style="background:${e.estado_cliente==='recibido_con_faltantes'?'#fcebeb':'#eaf3de'};border-radius:8px;padding:8px 10px;"><p style="font-size:11px;color:${e.estado_cliente==='recibido_con_faltantes'?'#A32D2D':'#3B6D11'};font-weight:500;">${estadoEntregaLabel(e.estado_cliente)}</p>${e.nota_cliente?`<p style="font-size:11px;color:#888;margin-top:2px;">${e.nota_cliente}</p>`:''}</div>`}</div>`).join(''):'<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay entregas para hoy</p>';
}

async function avisarCamionCargado() {
  const hoy=new Date().toISOString().split('T')[0];
  const { data: peds } = await sb.from('pedidos').select('id').eq('fecha_entrega',hoy).eq('estado','confirmado');
  for (const p of peds||[]) { await sb.from('entregas').upsert({pedido_id:p.id,fecha_entrega:hoy,hora_carga:new Date().toISOString(),estado_empresa:'en_camion'},{onConflict:'pedido_id'}); await sb.from('pedidos').update({estado:'en_camion',updated_at:new Date().toISOString()}).eq('id',p.id); }
  mostrarToast(`Camión cargado · ${peds?.length||0} clientes avisados ✓`,'success');
  await cargarEntregasDia();
}

async function registrarEntregaEmpresa(entregaId,estado) {
  await sb.from('entregas').update({estado_empresa:estado}).eq('id',entregaId);
  if (estado==='envio_completo') { const { data: e } = await sb.from('entregas').select('pedido_id').eq('id',entregaId).single(); if (e) await sb.from('pedidos').update({estado:'entregado',updated_at:new Date().toISOString()}).eq('id',e.pedido_id); }
  mostrarToast('Entrega registrada ✓','success'); await cargarEntregasDia();
}

async function registrarEntregaEmpresaDif(entregaId) {
  const nota=prompt('Descripción de las diferencias:'); if (nota===null) return;
  await sb.from('entregas').update({estado_empresa:'envio_con_diferencias',nota_empresa:nota}).eq('id',entregaId);
  const { data: e } = await sb.from('entregas').select('pedido_id').eq('id',entregaId).single();
  if (e) { await sb.from('reclamos').insert({pedido_id:e.pedido_id,tipo:'faltante_empresa',descripcion:nota,estado:'abierto'}); await sb.from('pedidos').update({estado:'entregado',updated_at:new Date().toISOString()}).eq('id',e.pedido_id); }
  mostrarToast('Diferencias registradas ✓','success'); await cargarEntregasDia();
}

function estadoEntregaLabel(e) { return {pendiente:'Pendiente',recibido_conforme:'Recibido conforme ✓',recibido_con_faltantes:'Con faltantes'}[e]||'Pendiente'; }

async function cargarReclamos(filtro='abierto') {
  const { data: reclamos } = await sb.from('reclamos').select('id,tipo,descripcion,estado,created_at,pedidos(numero),clientes(razon_social)').eq('estado',filtro).order('created_at',{ascending:false});
  document.getElementById('reclamos-container').innerHTML=(reclamos||[]).map(r=>`<div class="card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><div><p style="font-size:13px;font-weight:500;">${r.clientes?.razon_social||'Sin cliente'}</p><p style="font-size:11px;color:#aaa;">Pedido #${String(r.pedidos?.numero||0).padStart(4,'0')} · ${r.tipo==='faltante_empresa'?'Faltante empresa':'Faltante cliente'}</p></div><span class="badge ${r.estado==='abierto'?'sin_cobrar':r.estado==='cerrado'?'cobrado':'pendiente'}">${r.estado}</span></div><p style="font-size:12px;color:#555;margin-bottom:10px;">${r.descripcion||''}</p>${r.estado==='abierto'?`<div style="display:flex;gap:6px;flex-wrap:wrap;"><button class="btn btn-sm btn-outline" onclick="resolverReclamo('${r.id}','entrega_pendiente')">Programar entrega</button><button class="btn btn-sm btn-outline" onclick="resolverReclamo('${r.id}','nota_credito')">Nota de crédito</button><button class="btn btn-sm btn-primary" onclick="resolverReclamo('${r.id}','cerrado')">Cerrar</button></div>`:''}</div>`).join('')||'<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay reclamos</p>';
  const badge=document.getElementById('badge-reclamos'); const count=reclamos?.length||0; if (badge) { badge.textContent=count; badge.style.display=count>0?'block':'none'; }
}

async function resolverReclamo(id,estado) { const res=estado==='cerrado'?prompt('Descripción de la resolución:'):null; await sb.from('reclamos').update({estado,resolucion:res,fecha_resolucion:estado==='cerrado'?new Date().toISOString().split('T')[0]:null}).eq('id',id); mostrarToast('Reclamo actualizado ✓','success'); await cargarReclamos(); }
function filtrarReclamos(filtro, ev) { document.querySelectorAll('#page-reclamos .filter-tab').forEach(t=>t.classList.remove('active')); (ev||event).target.classList.add('active'); cargarReclamos(filtro); }

async function cargarProductos(filtro='todos') {
  const { data: prods } = await sb.from('productos').select('*,categorias(nombre),costos_producto(costo,distribuidores(nombre))').order('nombre');
  const filtrados=filtro==='todos'?prods:prods?.filter(p=>p.categorias?.nombre===filtro);
  document.getElementById('productos-container').innerHTML=(filtrados||[]).map(p=>{
    const costos=p.costos_producto||[]; const margen=costos[0]?.costo?Math.round(((p.precio_lista-costos[0].costo)/p.precio_lista)*100):null;
    return `<div class="card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;"><div><p style="font-size:13px;font-weight:500;">${p.nombre}</p><p style="font-size:11px;color:#aaa;">${p.categorias?.nombre||''} · ${p.presentacion||''}</p></div><div style="text-align:right;"><p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${p.tiene_precio?formatMoney(p.precio_lista):'Sin precio'}</p><p style="font-size:10px;color:#aaa;">la ${p.unidad_venta}</p></div></div><div style="border-top:0.5px solid #f0ede6;padding-top:8px;display:flex;gap:12px;flex-wrap:wrap;">${costos.map(c=>`<span style="font-size:10px;color:#aaa;">${c.distribuidores?.nombre||''}: ${formatMoney(c.costo)}</span>`).join('')}${margen!==null?`<span style="font-size:10px;color:#3B6D11;margin-left:auto;">Margen: ${margen}%</span>`:''}</div></div>`;
  }).join('');
}

function filtrarProductos(filtro, ev) { document.querySelectorAll('#page-productos .filter-tab').forEach(t=>t.classList.remove('active')); (ev||event).target.classList.add('active'); cargarProductos(filtro); }

async function cargarRendicion() {
  const { data: cobros } = await sb.from('cobros').select('id,monto,forma_pago,fecha_cobro,clientes(razon_social),pedidos(numero)').eq('rendido',false).order('fecha_cobro');
  document.getElementById('rend-total').textContent=formatMoney(cobros?.reduce((s,c)=>s+c.monto,0)||0);
  if (estadoApp.perfil?.rol==='admin') { const { data: cp } = await sb.from('comisiones').select('monto_comision').eq('retirado',false); document.getElementById('rend-comision').textContent=formatMoney(cp?.reduce((s,c)=>s+c.monto_comision,0)||0); }
  document.getElementById('rendicion-container').innerHTML=(cobros||[]).map(c=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div><p style="font-size:13px;font-weight:500;">${c.clientes?.razon_social||''}</p><p style="font-size:11px;color:#aaa;">${formasPagoLabel(c.forma_pago)} · ${formatFecha(c.fecha_cobro)}</p></div><p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(c.monto)}</p></div>`).join('')||'<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">Sin cobros pendientes de rendir</p>';
  const btn=document.getElementById('btn-rendir'); if (btn) btn.style.display=cobros?.length?'block':'none';
}

async function procesarRendicion() {
  if (!confirm('¿Confirmás la rendición de todos los cobros pendientes?')) return;
  const fecha=new Date().toISOString().split('T')[0];
  const { data: cobros } = await sb.from('cobros').select('id').eq('rendido',false);
  const ids=cobros?.map(c=>c.id)||[];
  if (ids.length) await sb.from('cobros').update({rendido:true,fecha_rendicion:fecha}).in('id',ids);
  if (estadoApp.perfil?.rol==='admin') { const { data: coms } = await sb.from('comisiones').select('id').eq('retirado',false); const comIds=coms?.map(c=>c.id)||[]; if (comIds.length) await sb.from('comisiones').update({retirado:true,fecha_retiro:fecha}).in('id',comIds); }
  await logActividad('rendicion','cobros');
  mostrarToast('Rendición confirmada ✓','success');
  await cargarRendicion();
}

// =============================================
// COMISIONES (con detalle por pedido)
// =============================================
async function cargarComisiones(periodo='mes') {
  const hoy=new Date();
  const desde=periodo==='mes'?new Date(hoy.getFullYear(),hoy.getMonth(),1).toISOString():periodo==='anio'?new Date(hoy.getFullYear(),0,1).toISOString():'2000-01-01';
  const { data: coms } = await sb.from('comisiones').select('*,clientes(razon_social),pedidos(numero,total,fecha_pedido)').gte('created_at',desde).order('created_at',{ascending:false});
  document.getElementById('com-total').textContent=formatMoney(coms?.reduce((s,c)=>s+c.monto_comision,0)||0);
  document.getElementById('com-por-retirar').textContent=formatMoney(coms?.filter(c=>!c.retirado).reduce((s,c)=>s+c.monto_comision,0)||0);
  document.getElementById('com-retirado').textContent=formatMoney(coms?.filter(c=>c.retirado).reduce((s,c)=>s+c.monto_comision,0)||0);
  
  // Por cliente
  const porCliente={};
  coms?.forEach(c=>{ const n=c.clientes?.razon_social||'Sin cliente'; if(!porCliente[n])porCliente[n]={monto:0,count:0}; porCliente[n].monto+=c.monto_comision; porCliente[n].count++; });
  document.getElementById('comisiones-por-cliente').innerHTML=Object.entries(porCliente).sort((a,b)=>b[1].monto-a[1].monto).map(([n,d])=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div><p style="font-size:13px;font-weight:500;">${n}</p><p style="font-size:10px;color:#aaa;">${d.count} ${d.count===1?'cobro':'cobros'}</p></div><p style="font-size:14px;font-weight:700;color:#534AB7;font-family:'Playfair Display',serif;">${formatMoney(d.monto)}</p></div>`).join('')||'<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">Sin comisiones en este período</p>';
  
  // Detalle por pedido
  document.getElementById('comisiones-detalle').innerHTML=(coms||[]).map(c=>`<div class="card" style="margin-bottom:6px;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
      <div>
        <p style="font-size:13px;font-weight:500;">${c.clientes?.razon_social||'Sin cliente'}</p>
        <p style="font-size:11px;color:#aaa;">Pedido #${String(c.pedidos?.numero||0).padStart(4,'0')} · ${formatFecha(c.created_at)}</p>
      </div>
      <span class="badge ${c.retirado?'cobrado':'pendiente'}">${c.retirado?'Retirado ✓':'Pendiente'}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;border-top:0.5px solid #f0ede6;padding-top:6px;">
      <div>
        <p style="font-size:10px;color:#aaa;">Cobrado: ${formatMoney(c.monto_cobrado)} · ${c.pct_comision}%</p>
      </div>
      <p style="font-size:14px;font-weight:700;color:#534AB7;font-family:'Playfair Display',serif;">${formatMoney(c.monto_comision)}</p>
    </div>
  </div>`).join('')||'';
}

function filtrarComisiones(periodo, ev) { document.querySelectorAll('#page-comisiones .filter-tab').forEach(t=>t.classList.remove('active')); (ev||event).target.classList.add('active'); cargarComisiones(periodo); }

// =============================================
// REPORTES, RUTA, CONFIG, PORTAL
// =============================================
async function generarReporte() {
  const desde=document.getElementById('rep-desde').value; const hasta=document.getElementById('rep-hasta').value;
  if (!desde||!hasta) { mostrarToast('Seleccioná el rango de fechas','error'); return; }
  const clienteId=document.getElementById('rep-cliente').value; const estado=document.getElementById('rep-estado').value;
  let query=sb.from('pedidos').select('*,clientes(razon_social),pedido_items(cantidad,subtotal,productos(nombre)),documentos(*),cobros(monto,forma_pago,fecha_cobro)').gte('fecha_pedido',desde).lte('fecha_pedido',hasta);
  if (clienteId) query=query.eq('cliente_id',clienteId); if (estado) query=query.eq('estado',estado);
  const { data: pedidos } = await query.order('fecha_pedido',{ascending:false});
  const totalVentas=pedidos?.reduce((s,p)=>s+p.total,0)||0; const totalCobrado=pedidos?.reduce((s,p)=>s+(p.cobros?.reduce((sc,c)=>sc+c.monto,0)||0),0)||0;
  document.getElementById('reporte-resultado').style.display='block';
  document.getElementById('reporte-resumen').innerHTML=`<div class="card" style="margin-bottom:10px;"><p class="section-title-sm">Resumen ${desde} al ${hasta}</p><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:12px;color:#aaa;">Total facturado</span><span style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(totalVentas)}</span></div><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:12px;color:#aaa;">Total cobrado</span><span style="font-size:14px;font-weight:700;color:#3B6D11;font-family:'Playfair Display',serif;">${formatMoney(totalCobrado)}</span></div><div style="display:flex;justify-content:space-between;"><span style="font-size:12px;color:#aaa;">Pedidos</span><span style="font-size:14px;font-weight:700;">${pedidos?.length||0}</span></div></div>`;
  document.getElementById('reporte-detalle').innerHTML=(pedidos||[]).map(p=>{const cobrado=p.cobros?.reduce((s,c)=>s+c.monto,0)||0;return `<div class="card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><div><p style="font-size:13px;font-weight:500;">${p.clientes?.razon_social||''}</p><p style="font-size:11px;color:#aaa;">Pedido #${String(p.numero||0).padStart(4,'0')} · ${formatFecha(p.fecha_pedido)}</p></div><span class="badge ${p.estado}">${estadoLabel(p.estado)}</span></div><div style="background:#f5f3ef;border-radius:8px;padding:8px 10px;margin-bottom:8px;">${(p.documentos||[]).map(d=>`<p style="font-size:11px;color:#555;">${d.tipo==='factura'?'📄':'📋'} ${d.numero_doc||''} — ${formatMoney(d.monto)}</p>`).join('')}${(p.cobros||[]).map(c=>`<p style="font-size:11px;color:#3B6D11;">💰 ${formasPagoLabel(c.forma_pago)} · ${formatFecha(c.fecha_cobro)} · ${formatMoney(c.monto)}</p>`).join('')}</div><div style="display:flex;justify-content:space-between;"><span style="font-size:12px;color:#aaa;">Total</span><span style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(p.total)}</span></div>${cobrado<p.total?`<p style="font-size:11px;color:#e24b4a;margin-top:4px;">Pendiente: ${formatMoney(p.total-cobrado)}</p>`:''}</div>`;}).join('');
}

function descargarReportePDF() { window.print(); }

async function cargarSelectClientes() {
  const { data: clientes } = await sb.from('clientes').select('id,razon_social').eq('activo',true).order('razon_social');
  const sel=document.getElementById('rep-cliente');
  if (sel) sel.innerHTML='<option value="">Todos los clientes</option>'+(clientes||[]).map(c=>`<option value="${c.id}">${c.razon_social}</option>`).join('');
}

async function cargarHojaRuta() {
  const hoy=new Date().toISOString().split('T')[0];
  const { data: entregas } = await sb.from('entregas').select('*,pedidos(numero,total,clientes(razon_social,direccion_entrega,whatsapp))').eq('fecha_entrega',hoy).order('created_at');
  document.getElementById('hoja-ruta-container').innerHTML=(entregas||[]).map((e,i)=>`<div class="card" style="margin-bottom:8px;"><div style="display:flex;align-items:center;gap:10px;"><div style="width:32px;height:32px;border-radius:50%;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;">${i+1}</div><div style="flex:1;"><p style="font-size:13px;font-weight:500;">${e.pedidos?.clientes?.razon_social||''}</p><p style="font-size:11px;color:#aaa;">${e.pedidos?.clientes?.direccion_entrega||'Sin dirección'}</p><p style="font-size:11px;color:#aaa;">#${String(e.pedidos?.numero||0).padStart(4,'0')} · ${formatMoney(e.pedidos?.total||0)}</p></div>${e.pedidos?.clientes?.whatsapp?`<a href="https://wa.me/${(e.pedidos.clientes.whatsapp).replace(/\D/g,'')}" style="font-size:22px;color:#25D366;"><i class="ti ti-brand-whatsapp"></i></a>`:''}</div></div>`).join('')||'<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay entregas para hoy</p>';
}

async function cargarConfig() {
  const { data: config } = await sb.from('configuracion').select('*').single();
  const el=document.getElementById('config-comision'); if (config&&el) el.value=config.comision_pct;
  const { data: dists } = await sb.from('distribuidores').select('*').eq('activo',true);
  const lista=document.getElementById('distribuidores-lista');
  if (lista) lista.innerHTML=(dists||[]).map(d=>`<div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;gap:8px;"><input type="text" value="${d.nombre}" class="form-input" style="flex:1;" onchange="actualizarDistribuidor('${d.id}',this.value)"></div>`).join('');
}

async function guardarConfig() { const pct=parseFloat(document.getElementById('config-comision').value); await sb.from('configuracion').update({comision_pct:pct,updated_at:new Date().toISOString()}).eq('id',1); mostrarToast('Configuración guardada ✓','success'); }
async function actualizarDistribuidor(id,nombre) { await sb.from('distribuidores').update({nombre}).eq('id',id); }
async function agregarDistribuidor() { const nombre=prompt('Nombre del distribuidor:'); if (!nombre) return; await sb.from('distribuidores').insert({nombre}); await cargarConfig(); }

async function cargarFormPrecios() {
  const { data: prods } = await sb.from('productos').select('id,nombre,precio_lista,tiene_precio,categorias(nombre)').eq('activo',true).order('nombre');
  document.getElementById('precios-form-container').innerHTML=(prods||[]).map(p=>`<div class="card" style="margin-bottom:6px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div><p style="font-size:13px;font-weight:500;">${p.nombre}</p><p style="font-size:11px;color:#aaa;">${p.categorias?.nombre||''} · Actual: ${p.tiene_precio?formatMoney(p.precio_lista):'Sin precio'}</p></div><input type="number" class="form-input" style="width:120px;" placeholder="Nuevo" id="precio-${p.id}"></div></div>`).join('');
}

async function guardarListaPrecios() {
  const { data: prods } = await sb.from('productos').select('id,precio_lista').eq('activo',true);
  const fecha=new Date().toISOString().split('T')[0]; const updates=[];
  for (const p of prods||[]) { const input=document.getElementById(`precio-${p.id}`); if (input?.value) { const np=parseFloat(input.value); if (p.precio_lista) await sb.from('historial_precios').insert({producto_id:p.id,precio_lista:p.precio_lista,fecha_desde:fecha}); updates.push(sb.from('productos').update({precio_lista:np,tiene_precio:true}).eq('id',p.id)); } }
  await Promise.all(updates);
  await logActividad('actualizar_precios','productos');
  mostrarToast('Lista de precios actualizada ✓','success');
  navegarA('config');
}

async function cargarPortalCliente() {
  if (!estadoApp.usuario) return;
  const { data: cli } = await sb.from('clientes').select('*').eq('user_id',estadoApp.usuario.id).single();
  if (!cli) { document.getElementById('portal-pedidos').innerHTML='<p style="font-size:13px;color:#aaa;">No hay datos de cliente asociados.</p>'; return; }
  const hoy=new Date(); const inicioMes=new Date(hoy.getFullYear(),hoy.getMonth(),1).toISOString().split('T')[0];
  if (cli.objetivo_kg_mensual) {
    let kgMes=0;
    const { data: peds } = await sb.from('pedidos').select('id').eq('cliente_id',cli.id).gte('fecha_pedido',inicioMes).neq('estado','cancelado');
    if (peds?.length) { const { data: items } = await sb.from('pedido_items').select('cantidad').in('pedido_id',peds.map(p=>p.id)); kgMes=items?.reduce((s,i)=>s+(i.cantidad||0),0)||0; }
    const pct=Math.min(100,(kgMes/cli.objetivo_kg_mensual)*100); const clase=pct>=80?'ok':pct>=50?'warning':'danger';
    const msgs={ok:`¡Vas a mantener tu descuento del ${cli.beneficio_pct}% este mes!`,warning:'Cuidado — te faltan kg para el objetivo',danger:'En riesgo — puede que pierdas el descuento'};
    const fondos={ok:'#eaf3de',warning:'#faeeda',danger:'#fcebeb'}; const textos={ok:'#3B6D11',warning:'#854F0B',danger:'#A32D2D'};
    document.getElementById('portal-objetivo-section').innerHTML=`<div style="background:${fondos[clase]};border-radius:14px;padding:12px 14px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;margin-bottom:6px;"><p style="font-size:12px;font-weight:500;color:${textos[clase]};">Objetivo: ${cli.objetivo_kg_mensual.toLocaleString()} kg/mes</p><p style="font-size:12px;font-weight:500;color:${textos[clase]};">${Math.round(kgMes).toLocaleString()} kg</p></div><div class="progress-bar" style="height:7px;background:${clase==='ok'?'#c0dd97':clase==='warning'?'#f5d9a8':'#f5b8b8'};"><div class="progress-fill ${clase}" style="width:${pct}%;"></div></div><p style="font-size:10px;color:${textos[clase]};margin-top:6px;">${msgs[clase]}</p></div>`;
  }
  const { data: pedidos } = await sb.from('pedidos').select('id,numero,total,estado,fecha_pedido,pedido_items(cantidad,productos(nombre))').eq('cliente_id',cli.id).order('created_at',{ascending:false}).limit(10);
  document.getElementById('portal-pedidos').innerHTML=(pedidos||[]).map(p=>`<div class="card" style="margin-bottom:8px;"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><div><p style="font-size:13px;font-weight:500;">Pedido #${String(p.numero||0).padStart(4,'0')}</p><p style="font-size:11px;color:#aaa;">${formatFecha(p.fecha_pedido)}</p></div><span class="badge ${p.estado}">${estadoLabel(p.estado)}</span></div><div style="border-top:0.5px solid #f0ede6;padding-top:8px;display:flex;justify-content:space-between;align-items:center;"><p style="font-size:11px;color:#aaa;">${p.pedido_items?.map(i=>`${i.productos?.nombre} × ${i.cantidad}`).join(' · ')||''}</p><p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(p.total)}</p></div>${p.estado==='en_camion'?`<div style="display:flex;gap:6px;margin-top:10px;"><button class="btn btn-sm" style="flex:1;background:#eaf3de;color:#3B6D11;border:none;" onclick="confirmarRecepcion('${p.id}','recibido_conforme')">Recibido conforme</button><button class="btn btn-sm" style="flex:1;background:#faeeda;color:#854F0B;border:none;" onclick="reportarFaltante('${p.id}')">Con faltantes</button></div>`:''}</div>`).join('')||'<p style="font-size:13px;color:#aaa;">Sin pedidos</p>';
  const { data: docs } = await sb.from('documentos').select('*').eq('cliente_id',cli.id).order('created_at',{ascending:false}).limit(10);
  document.getElementById('portal-facturas').innerHTML=(docs||[]).map(d=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div><p style="font-size:13px;font-weight:500;">${d.tipo==='factura'?'Factura':'Remito'} ${d.numero_doc||''}</p><p style="font-size:11px;color:#aaa;">${formatFecha(d.fecha_emision)} · ${formatMoney(d.monto)}</p></div><span class="badge ${d.verificado?'cobrado':'pendiente'}">${d.verificado?'Pagada':'Pendiente'}</span></div>`).join('')||'<p style="font-size:13px;color:#aaa;">Sin facturas</p>';
  const { data: cobros } = await sb.from('cobros').select('*').eq('cliente_id',cli.id).order('fecha_cobro',{ascending:false}).limit(10);
  document.getElementById('portal-pagos').innerHTML=(cobros||[]).map(c=>`<div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><div><p style="font-size:13px;font-weight:500;">${formasPagoLabel(c.forma_pago)}</p><p style="font-size:11px;color:#aaa;">${formatFecha(c.fecha_cobro)}</p></div><p style="font-size:14px;font-weight:700;color:#3B6D11;font-family:'Playfair Display',serif;">${formatMoney(c.monto)}</p></div>`).join('')||'<p style="font-size:13px;color:#aaa;">Sin pagos</p>';
}

async function confirmarRecepcion(pedidoId,estado) {
  const { data: e } = await sb.from('entregas').select('id').eq('pedido_id',pedidoId).single();
  if (e) await sb.from('entregas').update({estado_cliente:estado}).eq('id',e.id);
  await sb.from('pedidos').update({estado:'entregado',updated_at:new Date().toISOString()}).eq('id',pedidoId);
  mostrarToast('Recepción confirmada ✓','success'); await cargarPortalCliente();
}

async function reportarFaltante(pedidoId) {
  const desc=prompt('Describí qué faltó:'); if (desc===null) return;
  const { data: cli } = await sb.from('clientes').select('id').eq('user_id',estadoApp.usuario.id).single();
  await sb.from('reclamos').insert({pedido_id:pedidoId,cliente_id:cli?.id,tipo:'faltante_cliente',descripcion:desc,estado:'abierto'});
  const { data: e } = await sb.from('entregas').select('id').eq('pedido_id',pedidoId).single();
  if (e) await sb.from('entregas').update({estado_cliente:'recibido_con_faltantes',nota_cliente:desc}).eq('id',e.id);
  mostrarToast('Reclamo enviado ✓','success'); await cargarPortalCliente();
}

// =============================================
// HELPERS Y UI
// =============================================
function abrirModal(titulo,contenido,acciones=[]) {
  document.getElementById('modal-titulo').textContent=titulo;
  document.getElementById('modal-contenido').innerHTML=contenido;
  document.getElementById('modal-acciones').innerHTML=acciones.map((a,i)=>`<button class="btn ${a.style||'btn-outline'}" id="modal-btn-${i}">${a.label}</button>`).join('');
  acciones.forEach((a,i)=>{ const btn=document.getElementById(`modal-btn-${i}`); if (btn) btn.addEventListener('click',a.action); });
  document.getElementById('modal-overlay').style.display='flex';
}

function cerrarModal() { document.getElementById('modal-overlay').style.display='none'; }
function mostrarToast(msg,tipo='info') { const t=document.createElement('div'); t.className=`toast ${tipo}`; t.textContent=msg; document.getElementById('toast-container').appendChild(t); setTimeout(()=>t.remove(),3000); }
function formatMoney(n) { return '$'+Math.round(n||0).toLocaleString('es-AR'); }
function formatFecha(f) { if (!f) return ''; const d=new Date(f.length>10?f:f+'T00:00:00'); return d.toLocaleDateString('es-AR',{day:'2-digit',month:'short',year:'numeric'}); }
function estadoLabel(e) { return {pendiente:'Pendiente',confirmado:'Confirmado',preparando:'Preparando',en_camion:'En camino',entregado:'Entregado',cobrado:'Cobrado',cancelado:'Cancelado'}[e]||e; }

function switchTab(tabNombre, ev) {
  document.querySelectorAll('#page-detalle-cliente .tab-content').forEach(t=>t.style.display='none');
  document.querySelectorAll('#page-detalle-cliente .tab').forEach(t=>t.classList.remove('active'));
  const content=document.getElementById(`tab-${tabNombre}`);
  if (content) content.style.display='block';
  (ev||event).target.classList.add('active');
}

function onFotoSeleccionada(input,labelId) { const lbl=document.getElementById(labelId); if (input.files[0]&&lbl) lbl.textContent=input.files[0].name; }
function subirFoto(inputId) { document.getElementById(inputId)?.click(); }
async function logActividad(accion,tabla,registroId=null) { try { await sb.from('log_actividad').insert({user_id:estadoApp.usuario?.id,accion,tabla,registro_id:registroId}); } catch(e){} }
function mostrarNotificaciones() { mostrarToast('Sin notificaciones nuevas','info'); }
function mostrarPerfil() { abrirModal('Mi perfil',`<p style="font-size:14px;font-weight:500;margin-bottom:4px;">${estadoApp.perfil?.nombre||''}</p><p style="font-size:12px;color:#aaa;margin-bottom:4px;">${estadoApp.usuario?.email||''}</p><p style="font-size:12px;color:#aaa;">Rol: ${estadoApp.perfil?.rol||''}</p>`,[{label:'Cerrar sesión',action:cerrarSesion,style:'btn-outline'}]); }
function mostrarFavoritos() { mostrarToast('Próximamente','info'); }
