/* =============================================
   LA CABAÑA — GESTIÓN COMERCIAL
   app.js — Lógica completa
   ============================================= */

// =============================================
// CONFIGURACIÓN SUPABASE
// =============================================
const SUPABASE_URL = 'https://cptuecthxonltnzwryum.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwdHVlY3RoeG9ubHRuendyeXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzM4OTQsImV4cCI6MjA5NTU0OTg5NH0.Fv1H1i5T2XAhG7I-k1_kXdH3ky_VALkd8ozQ6NFCfOQ';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// =============================================
// ESTADO GLOBAL
// =============================================
let estadoApp = {
  usuario: null,
  perfil: null,
  clienteActual: null,
  pedidoActual: { clienteId: null, items: {}, obs: '' },
  historialNav: [],
  inactivoTimer: null,
  intentosLogin: 0,
  bloqueadoHasta: null,
  formaPagoActual: 'transferencia',
  tipoDocActual: 'factura',
  ivaActual: 'sin_iva',
  beneficioActual: 'ninguno',
};

const INACTIVO_MS = 20 * 60 * 1000; // 20 minutos
const MAX_INTENTOS = 5;

// =============================================
// INICIALIZACIÓN
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await cargarPerfil(session.user);
    mostrarApp();
  }
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN') {
      await cargarPerfil(session.user);
      mostrarApp();
    } else if (event === 'SIGNED_OUT') {
      mostrarLogin();
    }
  });
  iniciarTimerInactividad();
});

// =============================================
// AUTENTICACIÓN Y SEGURIDAD
// =============================================
async function iniciarSesion() {
  if (estadoApp.bloqueadoHasta && new Date() < estadoApp.bloqueadoHasta) {
    const mins = Math.ceil((estadoApp.bloqueadoHasta - new Date()) / 60000);
    document.getElementById('bloqueo-tiempo').textContent = mins;
    document.getElementById('login-blocked').style.display = 'block';
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-password').value;

  if (!email || !pass) { mostrarLoginError('Completá email y contraseña'); return; }

  document.getElementById('login-btn-text').style.display = 'none';
  document.getElementById('login-btn-loading').style.display = 'inline-flex';
  document.getElementById('login-error').style.display = 'none';

  const { error } = await supabase.auth.signInWithPassword({ email, password: pass });

  document.getElementById('login-btn-text').style.display = 'inline';
  document.getElementById('login-btn-loading').style.display = 'none';

  if (error) {
    estadoApp.intentosLogin++;
    const restantes = MAX_INTENTOS - estadoApp.intentosLogin;
    if (estadoApp.intentosLogin >= MAX_INTENTOS) {
      estadoApp.bloqueadoHasta = new Date(Date.now() + 30 * 60 * 1000);
      estadoApp.intentosLogin = 0;
      document.getElementById('login-blocked').style.display = 'block';
      document.getElementById('intentos-aviso').style.display = 'none';
    } else {
      mostrarLoginError('Email o contraseña incorrectos');
      const aviso = document.getElementById('intentos-aviso');
      aviso.style.display = 'block';
      aviso.textContent = `Intentos restantes: ${restantes}`;
    }
  }
}

function mostrarLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function cerrarSesion() {
  await supabase.auth.signOut();
  estadoApp = { ...estadoApp, usuario: null, perfil: null, historialNav: [] };
  mostrarLogin();
}

function togglePassword() {
  const input = document.getElementById('login-password');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// =============================================
// TIMER DE INACTIVIDAD
// =============================================
function iniciarTimerInactividad() {
  const resetTimer = () => {
    clearTimeout(estadoApp.inactivoTimer);
    if (estadoApp.usuario) {
      estadoApp.inactivoTimer = setTimeout(async () => {
        await cerrarSesion();
        mostrarToast('Sesión cerrada por inactividad', 'info');
      }, INACTIVO_MS);
    }
  };
  ['touchstart', 'click', 'keypress', 'scroll'].forEach(e => document.addEventListener(e, resetTimer));
  resetTimer();
}

// =============================================
// PERFIL Y ROLES
// =============================================
async function cargarPerfil(usuario) {
  estadoApp.usuario = usuario;
  const { data } = await supabase.from('perfiles').select('*').eq('id', usuario.id).single();
  estadoApp.perfil = data;
  aplicarRol(data?.rol || 'cliente');
  actualizarAvatar(data);
}

function aplicarRol(rol) {
  const adminEls = document.querySelectorAll('.admin-only');
  adminEls.forEach(el => {
    el.style.display = (rol === 'admin') ? '' : 'none';
  });
}

function actualizarAvatar(perfil) {
  const av = document.getElementById('topbar-avatar');
  if (av && perfil) {
    av.textContent = perfil.nombre?.substring(0, 2).toUpperCase() || 'US';
  }
}

// =============================================
// NAVEGACIÓN
// =============================================
function mostrarApp() {
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  navegarA('dashboard');
  iniciarTimerInactividad();
}

function mostrarLogin() {
  document.getElementById('screen-login').style.display = 'block';
  document.getElementById('app').style.display = 'none';
}

const paginasConBotonAtras = ['nuevo-pedido','resumen-pedido','detalle-cliente','form-cliente','nuevo-cobro','nueva-factura','entrega-dia','reclamos','productos','reportes','rendicion','comisiones','hoja-ruta','config','actualizar-precios'];
const paginasNav = { 'dashboard':'dashboard','pedidos':'pedidos','clientes':'clientes','cobros':'cobros','mas':'mas' };

function navegarA(pagina) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${pagina}`);
  if (target) target.classList.add('active');

  estadoApp.historialNav.push(pagina);

  // Topbar
  const titulos = {
    'dashboard': ['La Cabaña', true],
    'pedidos': ['Pedidos', false],
    'nuevo-pedido': ['Nuevo pedido', false],
    'resumen-pedido': ['Tu pedido', false],
    'clientes': ['Clientes', false],
    'detalle-cliente': [estadoApp.clienteActual?.razon_social || 'Cliente', false],
    'form-cliente': ['Nuevo cliente', false],
    'cobros': ['Cobros', false],
    'nuevo-cobro': ['Registrar cobro', false],
    'facturas': ['Facturas y remitos', false],
    'nueva-factura': ['Nuevo documento', false],
    'entrega-dia': ['Entrega del día', false],
    'reclamos': ['Reclamos', false],
    'productos': ['Productos', false],
    'reportes': ['Reportes', false],
    'rendicion': ['Rendición', false],
    'comisiones': ['Mis comisiones', false],
    'hoja-ruta': ['Hoja de ruta', false],
    'mas': ['Menú', false],
    'config': ['Configuración', false],
    'actualizar-precios': ['Lista de precios', false],
    'portal-cliente': ['Mi cuenta', true],
  };

  const [titulo, esInicio] = titulos[pagina] || [pagina, false];
  document.getElementById('topbar-title').textContent = titulo;

  const saludo = document.getElementById('topbar-greeting');
  if (esInicio && estadoApp.perfil) {
    const hora = new Date().getHours();
    const s = hora < 12 ? 'Buen día' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
    saludo.textContent = `${s}, ${estadoApp.perfil.nombre?.split(' ')[0]}`;
    saludo.style.display = 'block';
  } else {
    saludo.style.display = 'none';
  }

  // Botón atrás
  const btnBack = document.getElementById('btn-back');
  btnBack.style.display = paginasConBotonAtras.includes(pagina) ? 'flex' : 'none';

  // Nav activo
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navKey = Object.keys(paginasNav).find(k => pagina.includes(k) || pagina === k);
  if (navKey) document.getElementById(`nav-${navKey}`)?.classList.add('active');

  // Cargar datos de la página
  cargarPagina(pagina);
}

function volverAtras() {
  estadoApp.historialNav.pop();
  const anterior = estadoApp.historialNav[estadoApp.historialNav.length - 1] || 'dashboard';
  estadoApp.historialNav.pop();
  navegarA(anterior);
}

// =============================================
// CARGA DE DATOS POR PÁGINA
// =============================================
async function cargarPagina(pagina) {
  switch(pagina) {
    case 'dashboard': await cargarDashboard(); break;
    case 'pedidos': await cargarPedidos(); break;
    case 'clientes': await cargarClientes(); break;
    case 'cobros': await cargarCobros(); break;
    case 'facturas': await cargarFacturas(); break;
    case 'nuevo-pedido': await cargarCatalogo(); break;
    case 'entrega-dia': await cargarEntregasDia(); break;
    case 'reclamos': await cargarReclamos(); break;
    case 'productos': await cargarProductos(); break;
    case 'rendicion': await cargarRendicion(); break;
    case 'comisiones': await cargarComisiones('mes'); break;
    case 'hoja-ruta': await cargarHojaRuta(); break;
    case 'config': await cargarConfig(); break;
    case 'actualizar-precios': await cargarFormPrecios(); break;
    case 'portal-cliente': await cargarPortalCliente(); break;
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

  // Ventas del mes
  const { data: pedidosMes } = await supabase.from('pedidos')
    .select('total, estado, fecha_pedido, cliente_id, clientes(razon_social)')
    .gte('fecha_pedido', inicioMes).neq('estado', 'cancelado');

  const totalVentas = pedidosMes?.reduce((s, p) => s + (p.total || 0), 0) || 0;
  document.getElementById('kpi-ventas').textContent = formatMoney(totalVentas);

  // Pedidos hoy
  const pedidosHoy = pedidosMes?.filter(p => p.fecha_pedido === fechaHoy) || [];
  const pendientesHoy = pedidosHoy.filter(p => p.estado === 'pendiente').length;
  document.getElementById('kpi-pedidos').textContent = pedidosHoy.length;
  document.getElementById('kpi-pedidos-sub').textContent = `${pendientesHoy} pendientes`;

  // Por cobrar
  const { data: cobrosData } = await supabase.from('cobros').select('monto, rendido');
  const { data: pedidosSinCobrar } = await supabase.from('pedidos')
    .select('total, cliente_id, clientes(razon_social)').eq('estado', 'entregado');
  const porCobrar = pedidosSinCobrar?.reduce((s, p) => s + (p.total || 0), 0) || 0;
  document.getElementById('kpi-cobrar').textContent = formatMoney(porCobrar);
  document.getElementById('kpi-cobrar-sub').textContent = `${pedidosSinCobrar?.length || 0} pedidos`;

  // Para rendir
  const paraRendir = cobrosData?.filter(c => !c.rendido).reduce((s, c) => s + (c.monto || 0), 0) || 0;
  document.getElementById('kpi-rendir').textContent = formatMoney(paraRendir);

  // Comisiones (solo admin)
  if (estadoApp.perfil?.rol === 'admin') {
    const { data: comisionesMes } = await supabase.from('comisiones')
      .select('monto_comision').gte('created_at', inicioMes);
    const { data: comisionesAnio } = await supabase.from('comisiones')
      .select('monto_comision').gte('created_at', inicioAnio);
    const totalComMes = comisionesMes?.reduce((s, c) => s + (c.monto_comision || 0), 0) || 0;
    const totalComAnio = comisionesAnio?.reduce((s, c) => s + (c.monto_comision || 0), 0) || 0;
    document.getElementById('kpi-comisiones-mes').textContent = formatMoney(totalComMes);
    document.getElementById('kpi-comisiones-anio').textContent = formatMoney(totalComAnio);
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }

  // Alertas
  await cargarAlertas(pedidosSinCobrar || []);

  // Últimos pedidos
  const ultimos = pedidosMes?.slice(-3).reverse() || [];
  renderUltimosPedidos(ultimos);
}

async function cargarAlertas(pedidosSinCobrar) {
  const container = document.getElementById('alertas-container');
  const alertas = [];

  // Pedidos vencidos sin cobrar
  pedidosSinCobrar?.forEach(p => {
    alertas.push({ tipo: 'danger', icon: 'ti-alert-circle', titulo: `${p.clientes?.razon_social} — pendiente de cobro`, sub: `Ver pedido →` });
  });

  // Clientes en riesgo de objetivo
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  const { data: clientesObjetivo } = await supabase.from('clientes')
    .select('razon_social, objetivo_kg_mensual, id').not('objetivo_kg_mensual', 'is', null);

  for (const c of clientesObjetivo || []) {
    const { data: items } = await supabase.from('pedido_items')
      .select('cantidad, pedidos!inner(cliente_id, fecha_pedido)')
      .eq('pedidos.cliente_id', c.id).gte('pedidos.fecha_pedido', inicioMes);
    const kgMes = items?.reduce((s, i) => s + (i.cantidad || 0), 0) || 0;
    const pct = kgMes / c.objetivo_kg_mensual;
    if (pct < 0.7) {
      alertas.push({ tipo: 'warning', icon: 'ti-target', titulo: `${c.razon_social} en riesgo de objetivo`, sub: `${Math.round(kgMes)} kg de ${c.objetivo_kg_mensual} kg` });
    }
  }

  if (alertas.length === 0) {
    container.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">Sin alertas por ahora ✓</p>';
    return;
  }

  container.innerHTML = alertas.map(a => `
    <div class="alert-card ${a.tipo}">
      <i class="ti ${a.icon}"></i>
      <div><p class="alert-title">${a.titulo}</p><p class="alert-sub">${a.sub}</p></div>
    </div>
  `).join('');
}

function renderUltimosPedidos(pedidos) {
  const container = document.getElementById('ultimos-pedidos-container');
  if (!pedidos.length) {
    container.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">No hay pedidos este mes</p>';
    return;
  }
  container.innerHTML = pedidos.map(p => `
    <div class="pedido-card" onclick="abrirPedido('${p.id}')">
      <div class="pedido-card-header">
        <div>
          <p class="pedido-card-nombre">${p.clientes?.razon_social || 'Cliente'}</p>
          <p class="pedido-card-num">#${String(p.numero).padStart(4,'0')} · ${formatFecha(p.fecha_pedido)}</p>
        </div>
        <span class="badge ${p.estado}">${estadoLabel(p.estado)}</span>
      </div>
      <div class="pedido-card-footer">
        <p class="pedido-card-total">${formatMoney(p.total)}</p>
      </div>
    </div>
  `).join('');
}

// =============================================
// PEDIDOS
// =============================================
async function cargarPedidos(filtro = 'todos') {
  let query = supabase.from('pedidos').select('*, clientes(razon_social)').order('created_at', { ascending: false });
  if (filtro !== 'todos') query = query.eq('estado', filtro);

  // Si es cliente, filtrar solo los suyos
  if (estadoApp.perfil?.rol === 'cliente') {
    const { data: cli } = await supabase.from('clientes').select('id').eq('user_id', estadoApp.usuario.id).single();
    if (cli) query = query.eq('cliente_id', cli.id);
  }

  const { data: pedidos } = await query.limit(50);
  renderPedidos(pedidos || []);
}

function renderPedidos(pedidos) {
  const container = document.getElementById('pedidos-container');
  if (!pedidos.length) {
    container.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay pedidos</p>';
    return;
  }
  container.innerHTML = pedidos.map(p => `
    <div class="pedido-card" onclick="abrirPedido('${p.id}')">
      <div class="pedido-card-header">
        <div>
          <p class="pedido-card-nombre">${p.clientes?.razon_social || 'Cliente'}</p>
          <p class="pedido-card-num">#${String(p.numero).padStart(4,'0')} · ${formatFecha(p.fecha_pedido)}</p>
        </div>
        <span class="badge ${p.estado}">${estadoLabel(p.estado)}</span>
      </div>
      <div class="pedido-card-footer">
        <p class="pedido-card-total">${formatMoney(p.total)}</p>
        <div style="display:flex;gap:6px;">
          ${p.estado === 'pendiente' ? `<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();confirmarEstadoPedido('${p.id}','confirmado')">Confirmar</button>` : ''}
          ${p.estado === 'entregado' ? `<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();navegarA('nuevo-cobro')">Cobrar</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function filtrarPedidos(filtro) {
  document.querySelectorAll('#pedidos-filtros .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  cargarPedidos(filtro);
}

async function confirmarEstadoPedido(id, nuevoEstado) {
  await supabase.from('pedidos').update({ estado: nuevoEstado, updated_at: new Date().toISOString() }).eq('id', id);
  mostrarToast('Estado actualizado', 'success');
  await cargarPedidos();
}

async function abrirPedido(id) {
  // Abrir detalle del pedido (modal)
  const { data: p } = await supabase.from('pedidos').select('*, clientes(razon_social, tipo_iva, tipo_beneficio, beneficio_pct)').eq('id', id).single();
  const { data: items } = await supabase.from('pedido_items').select('*, productos(nombre, presentacion)').eq('pedido_id', id);

  abrirModal(`Pedido #${String(p.numero).padStart(4,'0')}`, `
    <div style="margin-bottom:10px;">
      <p style="font-size:13px;font-weight:500;">${p.clientes?.razon_social}</p>
      <p style="font-size:11px;color:#aaa;">${formatFecha(p.fecha_pedido)} · <span class="badge ${p.estado}">${estadoLabel(p.estado)}</span></p>
    </div>
    <div style="background:#f5f3ef;border-radius:10px;padding:10px 12px;margin-bottom:10px;">
      ${items?.map(i => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:0.5px solid #e8e5de;"><span style="font-size:12px;">${i.productos?.nombre} × ${i.cantidad}</span><span style="font-size:12px;font-weight:500;">${formatMoney(i.subtotal)}</span></div>`).join('') || ''}
      <div style="display:flex;justify-content:space-between;padding-top:8px;"><span style="font-size:14px;font-weight:700;">Total</span><span style="font-size:14px;font-weight:700;">${formatMoney(p.total)}</span></div>
    </div>
    ${p.observaciones ? `<p style="font-size:12px;color:#aaa;">${p.observaciones}</p>` : ''}
  `, [
    { label: 'Cargar factura', action: () => { cerrarModal(); estadoApp.pedidoParaDoc = id; navegarA('nueva-factura'); }, style: 'btn-outline' },
    { label: 'Registrar cobro', action: () => { cerrarModal(); estadoApp.pedidoParaCobro = id; navegarA('nuevo-cobro'); }, style: 'btn-primary' },
  ]);
}

// =============================================
// CATÁLOGO / NUEVO PEDIDO
// =============================================
let catalogoProductos = [];
let pedidoCantidades = {};

async function cargarCatalogo() {
  const selectCliente = document.getElementById('pedido-cliente');
  const { data: clientes } = await supabase.from('clientes').select('id, razon_social, tipo_beneficio, beneficio_pct, tipo_iva').eq('activo', true).order('razon_social');
  selectCliente.innerHTML = '<option value="">Seleccioná un cliente...</option>' + (clientes || []).map(c => `<option value="${c.id}" data-beneficio="${c.tipo_beneficio}" data-pct="${c.beneficio_pct}" data-iva="${c.tipo_iva}">${c.razon_social}</option>`).join('');

  const { data: prods } = await supabase.from('productos').select('*, categorias(nombre)').eq('activo', true).order('nombre');
  catalogoProductos = prods || [];
  pedidoCantidades = {};
  document.getElementById('catalogo-container').style.display = 'none';
  document.getElementById('cliente-info').style.display = 'none';
}

function onClienteSeleccionado() {
  const sel = document.getElementById('pedido-cliente');
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) {
    document.getElementById('catalogo-container').style.display = 'none';
    document.getElementById('cliente-info').style.display = 'none';
    return;
  }
  const beneficio = opt.dataset.beneficio;
  const pct = opt.dataset.pct;
  const iva = opt.dataset.iva;

  let badge = '';
  if (beneficio === 'descuento_pct') badge = `Descuento ${pct}% activo`;
  else if (beneficio === 'bonificacion_kg') badge = `Bonificación ${pct}% en kg activa`;
  else badge = 'Sin beneficio';

  const ivaLabel = { 'mixto': 'IVA mixto 10,5%', 'completo': 'IVA 21%', 'sin_iva': 'Sin IVA' };
  badge += ` · ${ivaLabel[iva] || ''}`;

  document.getElementById('cliente-beneficio-badge').textContent = badge;
  document.getElementById('cliente-beneficio-badge').className = `badge-info info-box blue`;
  document.getElementById('cliente-info').style.display = 'block';
  document.getElementById('catalogo-container').style.display = 'block';
  estadoApp.pedidoActual.clienteId = sel.value;
  estadoApp.pedidoActual.clienteBeneficio = beneficio;
  estadoApp.pedidoActual.clientePct = parseFloat(pct) || 0;
  estadoApp.pedidoActual.clienteIva = iva;
  renderCatalogo(catalogoProductos);
}

function filtrarCatalogo(cat) {
  document.querySelectorAll('#catalogo-container .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  const filtrados = cat === 'todos' ? catalogoProductos : catalogoProductos.filter(p => p.categorias?.nombre === cat);
  renderCatalogo(filtrados);
}

function renderCatalogo(prods) {
  const container = document.getElementById('productos-catalogo');
  const beneficio = estadoApp.pedidoActual.clienteBeneficio;
  const pct = estadoApp.pedidoActual.clientePct;

  let html = '';
  let catActual = '';
  prods.forEach(p => {
    if (p.categorias?.nombre !== catActual) {
      catActual = p.categorias?.nombre;
      html += `<p class="section-title">${catActual}</p>`;
    }
    const tieneDescuento = beneficio === 'descuento_pct' && pct > 0;
    const precioConDesc = tieneDescuento ? p.precio_lista * (1 - pct / 100) : p.precio_lista;
    const qty = pedidoCantidades[p.id] || 0;

    html += `
      <div class="producto-row" id="prod-row-${p.id}">
        <div class="producto-row-header">
          <div class="producto-row-info">
            <p class="producto-row-nombre">${p.nombre}</p>
            <p class="producto-row-desc">${p.presentacion || ''}</p>
            <p class="producto-row-precio">
              ${p.tiene_precio ? formatMoney(precioConDesc) : 'Precio pendiente'}
              ${tieneDescuento && p.tiene_precio ? `<span class="producto-row-precio-tachado">${formatMoney(p.precio_lista)}</span>` : ''}
            </p>
          </div>
          <div class="qty-control">
            <button class="qty-btn ${!p.tiene_precio ? 'disabled' : ''}" onclick="cambiarCantidad('${p.id}',-1)" ${!p.tiene_precio ? 'disabled' : ''}>−</button>
            <span class="qty-value" id="qty-${p.id}">${qty}</span>
            <button class="qty-btn ${!p.tiene_precio ? 'disabled' : ''}" onclick="cambiarCantidad('${p.id}',1)" ${!p.tiene_precio ? 'disabled' : ''}>+</button>
          </div>
        </div>
        ${!p.tiene_precio ? `<div class="producto-sin-precio"><p>Precio pendiente — próxima lista</p></div>` : ''}
        <div class="producto-detalle ${qty > 0 ? 'visible' : ''}" id="det-${p.id}">
          <span class="producto-detalle-texto" id="det-txt-${p.id}"></span>
          <span class="producto-detalle-subtotal" id="det-sub-${p.id}"></span>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
  actualizarBarraTotal();
}

function cambiarCantidad(prodId, delta) {
  pedidoCantidades[prodId] = Math.max(0, (pedidoCantidades[prodId] || 0) + delta);
  const qty = pedidoCantidades[prodId];
  document.getElementById(`qty-${prodId}`).textContent = qty;

  const prod = catalogoProductos.find(p => p.id === prodId);
  const pct = estadoApp.pedidoActual.clientePct;
  const beneficio = estadoApp.pedidoActual.clienteBeneficio;
  const precioBase = beneficio === 'descuento_pct' ? prod.precio_lista * (1 - pct / 100) : prod.precio_lista;
  const subtotal = qty * precioBase;

  const det = document.getElementById(`det-${prodId}`);
  const txt = document.getElementById(`det-txt-${prodId}`);
  const sub = document.getElementById(`det-sub-${prodId}`);

  if (qty > 0) {
    det.classList.add('visible');
    const unidad = prod.unidad_venta === 'caja' ? (qty === 1 ? '1 caja' : `${qty} cajas`) : `${qty} unidades`;
    const bonif = beneficio === 'bonificacion_kg' ? ` (+${(qty * pct / 100).toFixed(1)} bonificado)` : '';
    txt.textContent = unidad + bonif;
    sub.textContent = formatMoney(subtotal);
  } else {
    det.classList.remove('visible');
  }

  actualizarBarraTotal();
}

function actualizarBarraTotal() {
  const beneficio = estadoApp.pedidoActual.clienteBeneficio;
  const pct = estadoApp.pedidoActual.clientePct;
  let total = 0, items = 0;

  Object.keys(pedidoCantidades).forEach(id => {
    if (pedidoCantidades[id] > 0) {
      const prod = catalogoProductos.find(p => p.id === id);
      if (prod?.tiene_precio) {
        const precio = beneficio === 'descuento_pct' ? prod.precio_lista * (1 - pct / 100) : prod.precio_lista;
        total += pedidoCantidades[id] * precio;
        items += pedidoCantidades[id];
      }
    }
  });

  const barra = document.getElementById('pedido-total-bar');
  if (items > 0) {
    barra.style.display = 'flex';
    document.getElementById('total-bar-items').textContent = `${items} ${items === 1 ? 'producto' : 'productos'} seleccionados`;
    document.getElementById('total-bar-amount').textContent = formatMoney(total);
  } else {
    barra.style.display = 'none';
  }
}

// =============================================
// RESUMEN PEDIDO
// =============================================
function cargarResumenPedido() {
  const beneficio = estadoApp.pedidoActual.clienteBeneficio;
  const pct = estadoApp.pedidoActual.clientePct;
  const iva = estadoApp.pedidoActual.clienteIva;

  let subtotalLista = 0, subtotalNeto = 0, descuentoMonto = 0, ivaMonto = 0;
  const itemsRender = [];

  Object.keys(pedidoCantidades).forEach(id => {
    if (pedidoCantidades[id] > 0) {
      const prod = catalogoProductos.find(p => p.id === id);
      if (!prod?.tiene_precio) return;
      const cantidad = pedidoCantidades[id];
      const cantBonif = beneficio === 'bonificacion_kg' ? cantidad * pct / 100 : 0;
      const precioUnit = prod.precio_lista;
      const sub = cantidad * precioUnit;
      subtotalLista += sub;
      itemsRender.push({ prod, cantidad, cantBonif, precioUnit, sub });
    }
  });

  if (beneficio === 'descuento_pct') {
    descuentoMonto = subtotalLista * pct / 100;
    subtotalNeto = subtotalLista - descuentoMonto;
  } else {
    subtotalNeto = subtotalLista;
  }

  if (iva === 'completo') ivaMonto = subtotalNeto * 0.21;
  else if (iva === 'mixto') ivaMonto = (subtotalNeto / 2) * 0.21;

  const total = subtotalNeto + ivaMonto;

  // Items
  document.getElementById('resumen-items-container').innerHTML = `
    <div class="card">
      <p class="section-title-sm">Productos</p>
      ${itemsRender.map(i => `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:0.5px solid #f0ede6;">
          <div>
            <p style="font-size:13px;font-weight:500;">${i.prod.nombre}</p>
            <p style="font-size:10px;color:#aaa;">${i.cantidad} ${i.prod.unidad_venta === 'caja' ? 'caja(s)' : 'unidad(es)'}${i.cantBonif > 0 ? ` + ${i.cantBonif.toFixed(1)} bonif.` : ''}</p>
          </div>
          <p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(i.sub)}</p>
        </div>
      `).join('')}
    </div>
  `;

  // Cálculos
  document.getElementById('resumen-calculos').innerHTML = `
    <p class="section-title-sm">Cálculo</p>
    <div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:12px;color:#aaa;">Subtotal lista</span><span style="font-size:12px;">${formatMoney(subtotalLista)}</span></div>
    ${descuentoMonto > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:12px;color:#3B6D11;">Descuento ${pct}%</span><span style="font-size:12px;color:#3B6D11;">− ${formatMoney(descuentoMonto)}</span></div>` : ''}
    ${beneficio === 'bonificacion_kg' ? `<div style="display:flex;justify-content:space-between;margin-bottom:5px;"><span style="font-size:12px;color:#3B6D11;">Bonificación ${pct}% en kg</span><span style="font-size:12px;color:#3B6D11;">incluida</span></div>` : ''}
    ${ivaMonto > 0 ? `
      <div style="background:#e6f1fb;border-radius:8px;padding:8px 10px;margin-bottom:8px;">
        <p style="font-size:11px;color:#185FA5;font-weight:500;">IVA ${iva === 'mixto' ? 'mixto — 21% sobre 50% de cada producto = 10,5% efectivo' : '21% completo'}</p>
        <div style="display:flex;justify-content:space-between;margin-top:4px;"><span style="font-size:11px;color:#185FA5;">IVA</span><span style="font-size:11px;color:#185FA5;">${formatMoney(ivaMonto)}</span></div>
      </div>
    ` : ''}
    ${iva === 'sin_iva' ? `<div style="background:#eaf3de;border-radius:8px;padding:6px 10px;margin-bottom:8px;"><p style="font-size:11px;color:#3B6D11;">Sin IVA — cliente exento</p></div>` : ''}
    <div style="display:flex;justify-content:space-between;border-top:0.5px solid #f0ede6;padding-top:8px;">
      <span style="font-size:16px;font-weight:700;font-family:'Playfair Display',serif;">Total</span>
      <span style="font-size:16px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(total)}</span>
    </div>
  `;

  estadoApp.pedidoActual.subtotalLista = subtotalLista;
  estadoApp.pedidoActual.descuentoMonto = descuentoMonto;
  estadoApp.pedidoActual.subtotalNeto = subtotalNeto;
  estadoApp.pedidoActual.ivaMonto = ivaMonto;
  estadoApp.pedidoActual.total = total;
  estadoApp.pedidoActual.items = pedidoCantidades;
}

// Sobreescribir navegarA para resumen
const _navegarAOriginal = navegarA;
function navegarA(pagina) {
  if (pagina === 'resumen-pedido') cargarResumenPedido();
  _navegarAOriginal(pagina);
}

async function confirmarPedido() {
  if (!estadoApp.pedidoActual.clienteId) { mostrarToast('Seleccioná un cliente', 'error'); return; }

  const items = Object.keys(pedidoCantidades).filter(id => pedidoCantidades[id] > 0).map(id => {
    const prod = catalogoProductos.find(p => p.id === id);
    const pct = estadoApp.pedidoActual.clientePct;
    const beneficio = estadoApp.pedidoActual.clienteBeneficio;
    const precioUnit = beneficio === 'descuento_pct' ? prod.precio_lista * (1 - pct / 100) : prod.precio_lista;
    const cantBonif = beneficio === 'bonificacion_kg' ? pedidoCantidades[id] * pct / 100 : 0;
    return {
      producto_id: id,
      cantidad: pedidoCantidades[id],
      cantidad_bonificada: cantBonif,
      precio_lista: prod.precio_lista,
      precio_unitario: precioUnit,
      subtotal: pedidoCantidades[id] * precioUnit,
    };
  });

  const { data: pedido, error } = await supabase.from('pedidos').insert({
    cliente_id: estadoApp.pedidoActual.clienteId,
    estado: 'pendiente',
    subtotal_lista: estadoApp.pedidoActual.subtotalLista,
    descuento_monto: estadoApp.pedidoActual.descuentoMonto,
    subtotal_neto: estadoApp.pedidoActual.subtotalNeto,
    iva_monto: estadoApp.pedidoActual.ivaMonto,
    total: estadoApp.pedidoActual.total,
    observaciones: document.getElementById('pedido-obs').value,
    created_by: estadoApp.usuario.id,
  }).select().single();

  if (error) { mostrarToast('Error al guardar el pedido', 'error'); return; }

  await supabase.from('pedido_items').insert(items.map(i => ({ ...i, pedido_id: pedido.id })));
  await logActividad('crear_pedido', 'pedidos', pedido.id);

  mostrarToast('Pedido confirmado ✓', 'success');
  pedidoCantidades = {};
  estadoApp.pedidoActual = { clienteId: null, items: {}, obs: '' };
  navegarA('pedidos');
}

function enviarPresupuestoWhatsapp() {
  const sel = document.getElementById('pedido-cliente');
  const nombre = sel.options[sel.selectedIndex]?.text || '';
  const items = Object.keys(pedidoCantidades).filter(id => pedidoCantidades[id] > 0).map(id => {
    const prod = catalogoProductos.find(p => p.id === id);
    return `${prod.nombre} x${pedidoCantidades[id]}`;
  });
  const txt = `*Presupuesto La Cabaña*\nCliente: ${nombre}\n${items.join('\n')}\n*Total: ${formatMoney(estadoApp.pedidoActual.total || 0)}*`;
  window.open(`https://wa.me/?text=${encodeURIComponent(txt)}`);
}

async function guardarFavorito() {
  const nombre = prompt('Nombre para este pedido favorito:');
  if (!nombre) return;
  await supabase.from('pedidos_favoritos').insert({
    cliente_id: estadoApp.pedidoActual.clienteId,
    nombre,
    items: pedidoCantidades,
  });
  mostrarToast('Guardado como favorito ✓', 'success');
}

// =============================================
// CLIENTES
// =============================================
async function cargarClientes(busqueda = '') {
  let query = supabase.from('clientes').select('*, perfiles(nombre)').eq('activo', true).order('razon_social');
  if (busqueda) query = query.ilike('razon_social', `%${busqueda}%`);
  const { data: clientes } = await query;
  renderClientes(clientes || []);
}

function buscarClientes(val) { cargarClientes(val); }

async function renderClientes(clientes) {
  const container = document.getElementById('clientes-container');
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];

  if (!clientes.length) {
    container.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay clientes</p>';
    return;
  }

  // Para cada cliente calcular kg del mes
  const html = await Promise.all(clientes.map(async c => {
    const { data: items } = await supabase.from('pedido_items')
      .select('cantidad, pedidos!inner(cliente_id, fecha_pedido, estado)')
      .eq('pedidos.cliente_id', c.id).gte('pedidos.fecha_pedido', inicioMes).neq('pedidos.estado', 'cancelado');
    const kgMes = items?.reduce((s, i) => s + (i.cantidad || 0), 0) || 0;

    const initials = c.razon_social.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
    const colores = ['#eeedfe', '#eaf3de', '#faeeda', '#e6f1fb', '#e1f5ee'];
    const color = colores[c.razon_social.length % colores.length];

    let barraHtml = '';
    if (c.objetivo_kg_mensual) {
      const pct = Math.min(100, (kgMes / c.objetivo_kg_mensual) * 100);
      const clase = pct >= 80 ? 'ok' : pct >= 50 ? 'warning' : 'danger';
      const label = pct >= 80 ? `${Math.round(kgMes)} kg ✓` : `${Math.round(kgMes)} kg — ${pct < 50 ? 'en riesgo' : 'cuidado'}`;
      barraHtml = `
        <div class="objetivo-bar">
          <div class="objetivo-bar-header">
            <span class="objetivo-bar-label">Objetivo: ${c.objetivo_kg_mensual.toLocaleString()} kg/mes</span>
            <span class="objetivo-bar-valor ${clase}">${label}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${clase}" style="width:${pct}%;"></div></div>
        </div>
      `;
    } else {
      barraHtml = `<div class="objetivo-bar"><span style="font-size:10px;color:#aaa;">Sin objetivo · ${Math.round(kgMes).toLocaleString()} kg comprados este mes</span></div>`;
    }

    return `
      <div class="cliente-card" onclick="abrirCliente('${c.id}')">
        <div class="cliente-card-header">
          <div class="cliente-avatar" style="background:${color};">${initials}</div>
          <div class="cliente-card-info">
            <p class="cliente-card-nombre">${c.razon_social}</p>
            <p class="cliente-card-sub">${beneficioLabel(c)} · ${c.cuit || ''}</p>
          </div>
          <i class="ti ti-chevron-right" style="font-size:16px;color:#ccc;"></i>
        </div>
        ${barraHtml}
      </div>
    `;
  }));

  container.innerHTML = html.join('');
}

function beneficioLabel(c) {
  if (c.tipo_beneficio === 'descuento_pct') return `Desc. ${c.beneficio_pct}%`;
  if (c.tipo_beneficio === 'bonificacion_kg') return `Bonif. ${c.beneficio_pct}% kg`;
  return 'Sin beneficio';
}

async function abrirCliente(id) {
  const { data: c } = await supabase.from('clientes').select('*').eq('id', id).single();
  estadoApp.clienteActual = c;
  navegarA('detalle-cliente');
  cargarDetalleCliente(c);
}

async function cargarDetalleCliente(c) {
  // KPIs
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  const { data: pedidos } = await supabase.from('pedidos').select('total, estado, fecha_pedido').eq('cliente_id', c.id).neq('estado', 'cancelado');
  const { data: cobros } = await supabase.from('cobros').select('monto').eq('cliente_id', c.id);
  const { data: items } = await supabase.from('pedido_items').select('cantidad, pedidos!inner(cliente_id, fecha_pedido)').eq('pedidos.cliente_id', c.id).gte('pedidos.fecha_pedido', inicioMes);

  const totalComprado = pedidos?.reduce((s, p) => s + p.total, 0) || 0;
  const totalCobrado = cobros?.reduce((s, co) => s + co.monto, 0) || 0;
  const saldo = totalComprado - totalCobrado;
  const kgMes = items?.reduce((s, i) => s + i.cantidad, 0) || 0;

  document.getElementById('cli-total-comprado').textContent = formatMoney(totalComprado);
  document.getElementById('cli-saldo').textContent = formatMoney(saldo);
  document.getElementById('cli-saldo').className = `kpi-value ${saldo > 0 ? 'danger' : 'green'}`;
  document.getElementById('cli-kg-mes').textContent = Math.round(kgMes).toLocaleString();
  document.getElementById('cli-descuento').textContent = c.tipo_beneficio === 'descuento_pct' ? `${c.beneficio_pct}%` : c.tipo_beneficio === 'bonificacion_kg' ? `${c.beneficio_pct}% kg` : '—';

  // Objetivo
  if (c.objetivo_kg_mensual) {
    const pct = Math.min(100, (kgMes / c.objetivo_kg_mensual) * 100);
    const clase = pct >= 80 ? 'ok' : pct >= 50 ? 'warning' : 'danger';
    const msgs = { ok: 'Cumple objetivo — descuento asegurado', warning: 'Cuidado — quedan días del mes', danger: 'En riesgo — perderá el descuento' };
    document.getElementById('cli-objetivo-section').innerHTML = `
      <div class="objetivo-section">
        <div class="objetivo-header">
          <span class="objetivo-label">${c.objetivo_kg_mensual.toLocaleString()} kg / mes</span>
          <span class="objetivo-valor ${clase}">${Math.round(kgMes).toLocaleString()} kg</span>
        </div>
        <div class="progress-bar" style="height:8px;"><div class="progress-fill ${clase}" style="width:${pct}%;"></div></div>
        <p class="objetivo-msg" style="color:${clase === 'ok' ? '#3B6D11' : clase === 'warning' ? '#BA7517' : '#e24b4a'};">${msgs[clase]}</p>
      </div>
    `;
  } else {
    document.getElementById('cli-objetivo-section').innerHTML = '';
  }

  // Último pedido
  const ultimo = pedidos?.sort((a, b) => new Date(b.fecha_pedido) - new Date(a.fecha_pedido))[0];
  if (ultimo) {
    document.getElementById('cli-ultimo-pedido').innerHTML = `
      <div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><p style="font-size:13px;font-weight:500;">Último pedido</p><p style="font-size:11px;color:#aaa;">${formatFecha(ultimo.fecha_pedido)}</p></div>
          <span class="badge ${ultimo.estado}">${estadoLabel(ultimo.estado)}</span>
        </div>
      </div>
    `;
  }
}

function nuevoPedidoCliente() {
  if (estadoApp.clienteActual) {
    navegarA('nuevo-pedido');
    setTimeout(() => {
      const sel = document.getElementById('pedido-cliente');
      sel.value = estadoApp.clienteActual.id;
      onClienteSeleccionado();
    }, 100);
  }
}

function contactarWhatsapp() {
  const wa = estadoApp.clienteActual?.whatsapp || estadoApp.clienteActual?.telefono;
  if (wa) window.open(`https://wa.me/${wa.replace(/\D/g, '')}`);
}

// =============================================
// GUARDAR CLIENTE
// =============================================
async function guardarCliente() {
  const razon = document.getElementById('cli-razon').value.trim();
  if (!razon) { mostrarToast('Ingresá la razón social', 'error'); return; }

  const data = {
    razon_social: razon,
    cuit: document.getElementById('cli-cuit').value,
    telefono: document.getElementById('cli-tel').value,
    whatsapp: document.getElementById('cli-wa').value,
    email: document.getElementById('cli-email').value,
    direccion_entrega: document.getElementById('cli-dir-entrega').value,
    direccion_facturacion: document.getElementById('cli-dir-fact').value,
    tipo_beneficio: estadoApp.beneficioActual,
    beneficio_pct: estadoApp.beneficioActual === 'descuento_pct' ? parseFloat(document.getElementById('cli-beneficio-pct').value) || 0 : estadoApp.beneficioActual === 'bonificacion_kg' ? parseFloat(document.getElementById('cli-bonif-pct').value) || 0 : 0,
    tipo_iva: estadoApp.ivaActual,
    objetivo_kg_mensual: parseFloat(document.getElementById('cli-objetivo-kg').value) || null,
    email_portal: document.getElementById('cli-email-portal').value,
    tiene_portal: document.getElementById('cli-tiene-portal').checked,
    notas_internas: document.getElementById('cli-notas').value,
  };

  const id = estadoApp.clienteActual?.id;
  if (id) {
    await supabase.from('clientes').update(data).eq('id', id);
  } else {
    await supabase.from('clientes').insert(data);
  }

  await logActividad(id ? 'editar_cliente' : 'crear_cliente', 'clientes');
  mostrarToast('Cliente guardado ✓', 'success');
  navegarA('clientes');
}

function selBeneficio(tipo) {
  estadoApp.beneficioActual = tipo;
  ['descuento_pct', 'bonificacion_kg', 'ninguno'].forEach(t => {
    document.getElementById(`rd-${t}`)?.classList.toggle('selected', t === tipo);
    document.getElementById(`campo-${t}`)?.style && (document.getElementById(`campo-${t}`).style.display = t === tipo ? 'block' : 'none');
    document.querySelector(`[onclick="selBeneficio('${t}')"]`)?.classList.toggle('selected', t === tipo);
  });
}

function selIva(tipo) {
  estadoApp.ivaActual = tipo;
  ['mixto', 'completo', 'sin_iva'].forEach(t => {
    document.getElementById(`iva-${t}`)?.classList.toggle('active', t === tipo);
  });
  const msgs = {
    mixto: '50% con IVA 21% · 50% sin IVA = 10,5% efectivo sobre el total',
    completo: 'IVA 21% completo sobre el total del pedido',
    sin_iva: 'Cliente exento — no se agrega IVA',
  };
  const colors = { mixto: 'blue', completo: 'amber', sin_iva: 'green' };
  const box = document.getElementById('iva-descripcion');
  if (box) { box.textContent = msgs[tipo]; box.className = `info-box ${colors[tipo]}`; box.style.marginTop = '8px'; }
}

// =============================================
// COBROS
// =============================================
async function cargarCobros() {
  const { data: cobros } = await supabase.from('cobros').select('*, clientes(razon_social), pedidos(numero)').order('fecha_cobro', { ascending: false }).limit(50);
  const { data: pedidosSinCobrar } = await supabase.from('pedidos').select('*, clientes(razon_social)').eq('estado', 'entregado');

  const totalPendiente = pedidosSinCobrar?.reduce((s, p) => s + p.total, 0) || 0;
  const totalCobrado = cobros?.filter(c => {
    const fecha = new Date(c.fecha_cobro);
    const hoy = new Date();
    return fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear();
  }).reduce((s, c) => s + c.monto, 0) || 0;
  const paraRendir = cobros?.filter(c => !c.rendido).reduce((s, c) => s + c.monto, 0) || 0;

  document.getElementById('cobros-kpi-pendiente').textContent = formatMoney(totalPendiente);
  document.getElementById('cobros-kpi-cobrado').textContent = formatMoney(totalCobrado);
  document.getElementById('cobros-kpi-rendir').textContent = formatMoney(paraRendir);

  if (estadoApp.perfil?.rol === 'admin') {
    const { data: comPendientes } = await supabase.from('comisiones').select('monto_comision').eq('retirado', false);
    const totalCom = comPendientes?.reduce((s, c) => s + c.monto_comision, 0) || 0;
    document.getElementById('cobros-kpi-comision').textContent = formatMoney(totalCom);
  }

  // Urgentes
  document.getElementById('cobros-urgentes').innerHTML = (pedidosSinCobrar || []).map(p => `
    <div class="card" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div><p style="font-size:13px;font-weight:500;">${p.clientes?.razon_social}</p><p style="font-size:11px;color:#aaa;">Pedido #${String(p.numero).padStart(4,'0')}</p></div>
        <p style="font-size:15px;font-weight:700;color:#e24b4a;font-family:'Playfair Display',serif;">${formatMoney(p.total)}</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm btn-outline" onclick="enviarRecordatorioWa('${p.cliente_id}')"><i class="ti ti-brand-whatsapp"></i> Recordatorio</button>
        <button class="btn btn-sm btn-primary" onclick="estadoApp.pedidoParaCobro='${p.id}';navegarA('nuevo-cobro')">Registrar cobro</button>
      </div>
    </div>
  `).join('') || '<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">Sin cobros urgentes ✓</p>';

  // Recientes
  document.getElementById('cobros-recientes').innerHTML = (cobros || []).slice(0, 10).map(c => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div><p style="font-size:13px;font-weight:500;">${c.clientes?.razon_social}</p><p style="font-size:11px;color:#aaa;">${formasPagoLabel(c.forma_pago)} · ${formatFecha(c.fecha_cobro)}</p></div>
      <p style="font-size:13px;font-weight:500;color:#3B6D11;">+${formatMoney(c.monto)}</p>
    </div>
  `).join('') || '';
}

async function guardarCobro() {
  const monto = parseFloat(document.getElementById('cobro-monto').value);
  const fecha = document.getElementById('cobro-fecha').value;
  if (!monto || !fecha) { mostrarToast('Completá monto y fecha', 'error'); return; }

  const { data: cobro } = await supabase.from('cobros').insert({
    pedido_id: estadoApp.pedidoParaCobro || null,
    cliente_id: estadoApp.clienteActual?.id || null,
    monto,
    forma_pago: estadoApp.formaPagoActual,
    fecha_cobro: fecha,
    notas: document.getElementById('cobro-notas').value,
    rendido: false,
  }).select().single();

  // Calcular comisión automáticamente
  if (cobro && estadoApp.perfil?.rol === 'admin') {
    const { data: config } = await supabase.from('configuracion').select('comision_pct').single();
    const pct = config?.comision_pct || 5;
    const montoComision = monto * pct / 100;
    await supabase.from('comisiones').insert({
      cobro_id: cobro.id,
      pedido_id: estadoApp.pedidoParaCobro || null,
      cliente_id: estadoApp.clienteActual?.id || null,
      monto_cobrado: monto,
      pct_comision: pct,
      monto_comision: montoComision,
      retirado: false,
    });
  }

  // Actualizar estado del pedido
  if (estadoApp.pedidoParaCobro) {
    await supabase.from('pedidos').update({ estado: 'cobrado', updated_at: new Date().toISOString() }).eq('id', estadoApp.pedidoParaCobro);
  }

  await logActividad('registrar_cobro', 'cobros', cobro.id);
  mostrarToast('Cobro registrado ✓', 'success');
  navegarA('cobros');
}

function selFormaPago(tipo) {
  estadoApp.formaPagoActual = tipo;
  ['transferencia', 'efectivo', 'cheque'].forEach(t => {
    document.getElementById(`fp-${t}`)?.classList.toggle('active', t === tipo);
  });
  const labels = { transferencia: 'Foto del comprobante de transferencia', efectivo: 'Foto de la orden de pago', cheque: 'Foto del cheque' };
  const lbl = document.getElementById('cobro-foto-label');
  if (lbl) lbl.textContent = labels[tipo];
}

function formasPagoLabel(f) {
  return { transferencia: 'Transferencia', efectivo: 'Efectivo', cheque: 'Cheque' }[f] || f;
}

async function enviarRecordatorioWa(clienteId) {
  const { data: c } = await supabase.from('clientes').select('whatsapp, telefono, razon_social').eq('id', clienteId).single();
  const num = (c?.whatsapp || c?.telefono || '').replace(/\D/g, '');
  const txt = `Hola, le recordamos que tiene un pago pendiente. Muchas gracias. La Cabaña.`;
  if (num) window.open(`https://wa.me/${num}?text=${encodeURIComponent(txt)}`);
}

// =============================================
// FACTURAS Y DOCUMENTOS
// =============================================
async function cargarFacturas(filtro = 'todos') {
  let query = supabase.from('documentos').select('*, clientes(razon_social), pedidos(numero)').order('created_at', { ascending: false });
  if (filtro === 'factura' || filtro === 'remito') query = query.eq('tipo', filtro);
  if (filtro === 'pendiente') query = query.eq('verificado', false);
  const { data: docs } = await query.limit(50);

  document.getElementById('facturas-container').innerHTML = (docs || []).map(d => `
    <div class="card" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <p style="font-size:13px;font-weight:500;">${d.tipo === 'factura' ? 'Factura' : 'Remito'} ${d.numero_doc || ''}</p>
          <p style="font-size:11px;color:#aaa;">${d.clientes?.razon_social} · ${formatFecha(d.fecha_emision)}</p>
          ${d.pedidos ? `<p style="font-size:11px;color:#aaa;">Pedido #${String(d.pedidos.numero).padStart(4,'0')}</p>` : ''}
        </div>
        <div style="text-align:right;">
          <p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(d.monto)}</p>
          <span class="badge ${d.verificado ? 'cobrado' : 'pendiente'}">${d.verificado ? 'Verificado' : 'Pendiente'}</span>
        </div>
      </div>
    </div>
  `).join('') || '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay documentos</p>';
}

function filtrarDocs(filtro) {
  document.querySelectorAll('#page-facturas .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  cargarFacturas(filtro);
}

async function guardarDocumento() {
  const pedidoId = document.getElementById('doc-pedido').value;
  const tipo = estadoApp.tipoDocActual;
  const monto = parseFloat(document.getElementById('doc-monto').value);

  if (!monto) { mostrarToast('Ingresá el monto', 'error'); return; }

  // Obtener cliente del pedido
  let clienteId = null;
  if (pedidoId) {
    const { data: p } = await supabase.from('pedidos').select('cliente_id, total, subtotal_neto').eq('id', pedidoId).single();
    clienteId = p?.cliente_id;

    // Verificación automática
    const esperado = tipo === 'factura' ? p?.total / 2 : p?.subtotal_neto / 2;
    const dif = Math.abs(monto - (esperado || 0));
    if (dif > 100) {
      document.getElementById('doc-verificacion').style.display = 'block';
      document.getElementById('doc-verificacion').className = 'info-box amber';
      document.getElementById('doc-verificacion').textContent = `Atención: el monto ingresado (${formatMoney(monto)}) difiere del esperado (${formatMoney(esperado || 0)})`;
    }
  }

  await supabase.from('documentos').insert({
    pedido_id: pedidoId || null,
    cliente_id: clienteId,
    tipo,
    numero_doc: document.getElementById('doc-numero').value,
    fecha_emision: document.getElementById('doc-fecha-emision').value,
    fecha_vencimiento: document.getElementById('doc-fecha-vto').value,
    monto,
    notas: document.getElementById('doc-notas').value,
    verificado: false,
  });

  mostrarToast('Documento guardado ✓', 'success');
  navegarA('facturas');
}

function selTipoDoc(tipo) {
  estadoApp.tipoDocActual = tipo;
  ['factura', 'remito'].forEach(t => document.getElementById(`doc-${t}`)?.classList.toggle('active', t === tipo));
}

async function onPedidoDocSeleccionado() {
  const pedidoId = document.getElementById('doc-pedido').value;
  if (!pedidoId) return;
  const { data: p } = await supabase.from('pedidos').select('total, subtotal_neto, clientes(razon_social, tipo_iva)').eq('id', pedidoId).single();
  if (!p) return;
  const iva = p.clientes?.tipo_iva;
  const box = document.getElementById('doc-verificacion');
  box.style.display = 'block';
  if (iva === 'mixto') {
    box.className = 'info-box blue';
    box.innerHTML = `Este cliente tiene IVA mixto.<br>Factura esperada: ${formatMoney(p.total / 2)}<br>Remito esperado: ${formatMoney(p.subtotal_neto / 2)}`;
  } else if (iva === 'completo') {
    box.className = 'info-box blue';
    box.textContent = `Factura esperada: ${formatMoney(p.total)}`;
  } else {
    box.className = 'info-box green';
    box.textContent = `Remito esperado: ${formatMoney(p.total)}`;
  }
}

// =============================================
// ENTREGA DEL DÍA
// =============================================
async function cargarEntregasDia() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data: entregas } = await supabase.from('entregas')
    .select('*, pedidos(numero, total, clientes(razon_social, whatsapp, direccion_entrega))')
    .eq('fecha_entrega', hoy);

  const container = document.getElementById('entregas-hoy-container');
  if (!entregas?.length) {
    container.innerHTML = '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay entregas programadas para hoy</p>';
    return;
  }

  container.innerHTML = entregas.map(e => {
    const estadoEmpresa = e.estado_empresa;
    const estadoCliente = e.estado_cliente;
    const nombre = e.pedidos?.clientes?.razon_social || 'Cliente';
    const dir = e.pedidos?.clientes?.direccion_entrega || '';

    return `
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <p style="font-size:13px;font-weight:500;">${nombre}</p>
            <p style="font-size:11px;color:#aaa;">#${String(e.pedidos?.numero || 0).padStart(4,'0')} · ${dir}</p>
          </div>
          <span class="badge ${estadoCliente === 'recibido_conforme' ? 'cobrado' : estadoCliente === 'recibido_con_faltantes' ? 'sin_cobrar' : 'en_camion'}">${estadoEntregaLabel(estadoCliente)}</span>
        </div>
        ${estadoEmpresa === 'pendiente' || estadoEmpresa === 'en_camion' ? `
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm" style="flex:1;background:#eaf3de;color:#3B6D11;border:none;" onclick="registrarEntregaEmpresa('${e.id}','envio_completo')">Envío completo</button>
            <button class="btn btn-sm" style="flex:1;background:#faeeda;color:#854F0B;border:none;" onclick="registrarEntregaEmpresaDif('${e.id}')">Con diferencias</button>
          </div>
        ` : `
          <div style="background:${estadoCliente === 'recibido_con_faltantes' ? '#fcebeb' : '#eaf3de'};border-radius:8px;padding:8px 10px;">
            <p style="font-size:11px;color:${estadoCliente === 'recibido_con_faltantes' ? '#A32D2D' : '#3B6D11'};font-weight:500;">${estadoEntregaLabel(estadoCliente)}</p>
            ${e.nota_cliente ? `<p style="font-size:11px;color:#888;margin-top:2px;">${e.nota_cliente}</p>` : ''}
          </div>
        `}
      </div>
    `;
  }).join('');
}

async function avisarCamionCargado() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data: pedidosHoy } = await supabase.from('pedidos').select('id, cliente_id, clientes(razon_social, whatsapp)').eq('fecha_entrega', hoy).eq('estado', 'confirmado');

  for (const p of pedidosHoy || []) {
    // Crear entrada de entrega si no existe
    await supabase.from('entregas').upsert({ pedido_id: p.id, fecha_entrega: hoy, hora_carga: new Date().toISOString(), estado_empresa: 'en_camion' }, { onConflict: 'pedido_id' });
    // Actualizar estado pedido
    await supabase.from('pedidos').update({ estado: 'en_camion', updated_at: new Date().toISOString() }).eq('id', p.id);
  }

  mostrarToast(`Camión cargado. ${pedidosHoy?.length || 0} clientes avisados ✓`, 'success');
  await cargarEntregasDia();
}

async function registrarEntregaEmpresa(entregaId, estado) {
  await supabase.from('entregas').update({ estado_empresa: estado }).eq('id', entregaId);
  if (estado === 'envio_completo') {
    const { data: e } = await supabase.from('entregas').select('pedido_id').eq('id', entregaId).single();
    if (e) await supabase.from('pedidos').update({ estado: 'entregado', updated_at: new Date().toISOString() }).eq('id', e.pedido_id);
  }
  mostrarToast('Entrega registrada ✓', 'success');
  await cargarEntregasDia();
}

async function registrarEntregaEmpresaDif(entregaId) {
  const nota = prompt('Descripción de las diferencias:');
  if (nota === null) return;
  await supabase.from('entregas').update({ estado_empresa: 'envio_con_diferencias', nota_empresa: nota }).eq('id', entregaId);
  const { data: e } = await supabase.from('entregas').select('pedido_id').eq('id', entregaId).single();
  if (e) {
    await supabase.from('reclamos').insert({ pedido_id: e.pedido_id, tipo: 'faltante_empresa', descripcion: nota, estado: 'abierto' });
    await supabase.from('pedidos').update({ estado: 'entregado', updated_at: new Date().toISOString() }).eq('id', e.pedido_id);
  }
  mostrarToast('Diferencias registradas ✓', 'success');
  await cargarEntregasDia();
}

function estadoEntregaLabel(e) {
  return { pendiente: 'Pendiente', recibido_conforme: 'Recibido conforme ✓', recibido_con_faltantes: 'Con faltantes' }[e] || e;
}

// =============================================
// RECLAMOS
// =============================================
async function cargarReclamos(filtro = 'abierto') {
  const { data: reclamos } = await supabase.from('reclamos')
    .select('*, pedidos(numero), clientes(razon_social)').eq('estado', filtro).order('created_at', { ascending: false });

  document.getElementById('reclamos-container').innerHTML = (reclamos || []).map(r => `
    <div class="card" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <div>
          <p style="font-size:13px;font-weight:500;">${r.clientes?.razon_social}</p>
          <p style="font-size:11px;color:#aaa;">Pedido #${String(r.pedidos?.numero || 0).padStart(4,'0')} · ${r.tipo === 'faltante_empresa' ? 'Faltante empresa' : 'Faltante cliente'}</p>
        </div>
        <span class="badge ${r.estado === 'abierto' ? 'sin_cobrar' : r.estado === 'cerrado' ? 'cobrado' : 'pendiente'}">${r.estado}</span>
      </div>
      <p style="font-size:12px;color:#555;margin-bottom:10px;">${r.descripcion || ''}</p>
      ${r.estado === 'abierto' ? `
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-outline" onclick="resolverReclamo('${r.id}','entrega_pendiente')">Programar entrega</button>
          <button class="btn btn-sm btn-outline" onclick="resolverReclamo('${r.id}','nota_credito')">Nota de crédito</button>
          <button class="btn btn-sm btn-primary" onclick="resolverReclamo('${r.id}','cerrado')">Cerrar</button>
        </div>
      ` : ''}
    </div>
  `).join('') || '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay reclamos</p>';

  // Badge en menú
  const badge = document.getElementById('badge-reclamos');
  const count = reclamos?.length || 0;
  if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'block' : 'none'; }
}

async function resolverReclamo(id, estado) {
  const resolucion = estado !== 'cerrado' ? null : prompt('Descripción de la resolución:');
  await supabase.from('reclamos').update({ estado, resolucion, fecha_resolucion: estado === 'cerrado' ? new Date().toISOString().split('T')[0] : null }).eq('id', id);
  mostrarToast('Reclamo actualizado ✓', 'success');
  await cargarReclamos();
}

function filtrarReclamos(filtro) {
  document.querySelectorAll('#page-reclamos .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  cargarReclamos(filtro);
}

// =============================================
// PRODUCTOS
// =============================================
async function cargarProductos(filtro = 'todos') {
  let query = supabase.from('productos').select('*, categorias(nombre), costos_producto(costo, distribuidores(nombre))').order('nombre');
  const { data: prods } = await query;
  const filtrados = filtro === 'todos' ? prods : prods?.filter(p => p.categorias?.nombre === filtro);

  document.getElementById('productos-container').innerHTML = (filtrados || []).map(p => {
    const costos = p.costos_producto || [];
    const margen = costos[0]?.costo ? Math.round(((p.precio_lista - costos[0].costo) / p.precio_lista) * 100) : null;
    return `
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <p style="font-size:13px;font-weight:500;">${p.nombre}</p>
            <p style="font-size:11px;color:#aaa;">${p.categorias?.nombre} · ${p.presentacion || ''}</p>
          </div>
          <div style="text-align:right;">
            <p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${p.tiene_precio ? formatMoney(p.precio_lista) : 'Sin precio'}</p>
            <p style="font-size:10px;color:#aaa;">la ${p.unidad_venta}</p>
          </div>
        </div>
        <div style="border-top:0.5px solid #f0ede6;padding-top:8px;display:flex;gap:12px;">
          ${costos.map(c => `<span style="font-size:10px;color:#aaa;">${c.distribuidores?.nombre}: ${formatMoney(c.costo)}</span>`).join('')}
          ${margen !== null ? `<span style="font-size:10px;color:#3B6D11;margin-left:auto;">Margen: ${margen}%</span>` : ''}
        </div>
      </div>
    `;
  }).join('') || '';
}

function filtrarProductos(filtro) {
  document.querySelectorAll('#page-productos .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  cargarProductos(filtro);
}

// =============================================
// RENDICIÓN
// =============================================
async function cargarRendicion() {
  const { data: cobros } = await supabase.from('cobros').select('*, clientes(razon_social), pedidos(numero)').eq('rendido', false).order('fecha_cobro');
  const total = cobros?.reduce((s, c) => s + c.monto, 0) || 0;
  document.getElementById('rend-total').textContent = formatMoney(total);

  if (estadoApp.perfil?.rol === 'admin') {
    const { data: comPendientes } = await supabase.from('comisiones').select('monto_comision').eq('retirado', false);
    const totalCom = comPendientes?.reduce((s, c) => s + c.monto_comision, 0) || 0;
    document.getElementById('rend-comision').textContent = formatMoney(totalCom);
  }

  document.getElementById('rendicion-container').innerHTML = (cobros || []).map(c => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div>
        <p style="font-size:13px;font-weight:500;">${c.clientes?.razon_social}</p>
        <p style="font-size:11px;color:#aaa;">${formasPagoLabel(c.forma_pago)} · ${formatFecha(c.fecha_cobro)}</p>
      </div>
      <p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(c.monto)}</p>
    </div>
  `).join('') || '<p style="font-size:13px;color:#aaa;text-align:center;padding:12px;">Sin cobros pendientes de rendir</p>';

  const btnRendir = document.getElementById('btn-rendir');
  if (btnRendir) btnRendir.style.display = cobros?.length ? 'block' : 'none';
}

async function procesarRendicion() {
  const confirmado = confirm('¿Confirmás la rendición de todos los cobros pendientes?');
  if (!confirmado) return;

  const fecha = new Date().toISOString().split('T')[0];
  const { data: cobros } = await supabase.from('cobros').select('id').eq('rendido', false);
  const ids = cobros?.map(c => c.id) || [];

  if (ids.length) {
    await supabase.from('cobros').update({ rendido: true, fecha_rendicion: fecha }).in('id', ids);
  }

  if (estadoApp.perfil?.rol === 'admin') {
    const { data: coms } = await supabase.from('comisiones').select('id').eq('retirado', false);
    const comIds = coms?.map(c => c.id) || [];
    if (comIds.length) await supabase.from('comisiones').update({ retirado: true, fecha_retiro: fecha }).in('id', comIds);
  }

  await logActividad('rendicion', 'cobros');
  mostrarToast('Rendición confirmada ✓', 'success');
  await cargarRendicion();
}

// =============================================
// COMISIONES
// =============================================
async function cargarComisiones(periodo = 'mes') {
  const hoy = new Date();
  let desde;
  if (periodo === 'mes') desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString();
  else if (periodo === 'anio') desde = new Date(hoy.getFullYear(), 0, 1).toISOString();
  else desde = '2000-01-01';

  const { data: coms } = await supabase.from('comisiones').select('*, clientes(razon_social), pedidos(numero)').gte('created_at', desde).order('created_at', { ascending: false });

  const total = coms?.reduce((s, c) => s + c.monto_comision, 0) || 0;
  const porRetirar = coms?.filter(c => !c.retirado).reduce((s, c) => s + c.monto_comision, 0) || 0;
  const retirado = coms?.filter(c => c.retirado).reduce((s, c) => s + c.monto_comision, 0) || 0;

  document.getElementById('com-total').textContent = formatMoney(total);
  document.getElementById('com-por-retirar').textContent = formatMoney(porRetirar);
  document.getElementById('com-retirado').textContent = formatMoney(retirado);

  // Por cliente
  const porCliente = {};
  coms?.forEach(c => {
    const nombre = c.clientes?.razon_social || 'Sin cliente';
    if (!porCliente[nombre]) porCliente[nombre] = 0;
    porCliente[nombre] += c.monto_comision;
  });

  document.getElementById('comisiones-por-cliente').innerHTML = Object.entries(porCliente).sort((a, b) => b[1] - a[1]).map(([nombre, monto]) => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <p style="font-size:13px;font-weight:500;">${nombre}</p>
      <p style="font-size:14px;font-weight:700;color:#534AB7;font-family:'Playfair Display',serif;">${formatMoney(monto)}</p>
    </div>
  `).join('') || '';

  // Detalle
  document.getElementById('comisiones-detalle').innerHTML = (coms || []).map(c => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div>
        <p style="font-size:12px;font-weight:500;">${c.clientes?.razon_social || 'Sin cliente'} — Pedido #${String(c.pedidos?.numero || 0).padStart(4,'0')}</p>
        <p style="font-size:11px;color:#aaa;">${formatFecha(c.created_at)} · ${c.pct_comision}% de ${formatMoney(c.monto_cobrado)} · ${c.retirado ? 'Retirado ✓' : 'Pendiente'}</p>
      </div>
      <p style="font-size:13px;font-weight:500;color:#534AB7;">${formatMoney(c.monto_comision)}</p>
    </div>
  `).join('') || '';
}

function filtrarComisiones(periodo) {
  document.querySelectorAll('#page-comisiones .filter-tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  cargarComisiones(periodo);
}

// =============================================
// REPORTES
// =============================================
async function generarReporte() {
  const desde = document.getElementById('rep-desde').value;
  const hasta = document.getElementById('rep-hasta').value;
  const clienteId = document.getElementById('rep-cliente').value;
  const estado = document.getElementById('rep-estado').value;

  if (!desde || !hasta) { mostrarToast('Seleccioná el rango de fechas', 'error'); return; }

  let query = supabase.from('pedidos').select('*, clientes(razon_social), pedido_items(cantidad, subtotal, productos(nombre)), documentos(*), cobros(monto, forma_pago, fecha_cobro, foto_comprobante_url)').gte('fecha_pedido', desde).lte('fecha_pedido', hasta);
  if (clienteId) query = query.eq('cliente_id', clienteId);
  if (estado) query = query.eq('estado', estado);
  const { data: pedidos } = await query.order('fecha_pedido', { ascending: false });

  const totalVentas = pedidos?.reduce((s, p) => s + p.total, 0) || 0;
  const totalCobrado = pedidos?.reduce((s, p) => s + (p.cobros?.reduce((sc, c) => sc + c.monto, 0) || 0), 0) || 0;

  document.getElementById('reporte-resultado').style.display = 'block';
  document.getElementById('reporte-resumen').innerHTML = `
    <div class="card" style="margin-bottom:10px;">
      <p class="section-title-sm">Resumen</p>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:12px;color:#aaa;">Total facturado</span><span style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(totalVentas)}</span></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span style="font-size:12px;color:#aaa;">Total cobrado</span><span style="font-size:14px;font-weight:700;color:#3B6D11;font-family:'Playfair Display',serif;">${formatMoney(totalCobrado)}</span></div>
      <div style="display:flex;justify-content:space-between;"><span style="font-size:12px;color:#aaa;">Pedidos</span><span style="font-size:14px;font-weight:700;">${pedidos?.length || 0}</span></div>
    </div>
  `;

  document.getElementById('reporte-detalle').innerHTML = (pedidos || []).map(p => {
    const cobrado = p.cobros?.reduce((s, c) => s + c.monto, 0) || 0;
    const docs = p.documentos || [];
    return `
      <div class="card" style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
          <div>
            <p style="font-size:13px;font-weight:500;">${p.clientes?.razon_social}</p>
            <p style="font-size:11px;color:#aaa;">Pedido #${String(p.numero).padStart(4,'0')} · ${formatFecha(p.fecha_pedido)}</p>
          </div>
          <span class="badge ${p.estado}">${estadoLabel(p.estado)}</span>
        </div>
        <div style="background:#f5f3ef;border-radius:8px;padding:8px 10px;margin-bottom:8px;">
          ${docs.map(d => `<p style="font-size:11px;color:#555;">${d.tipo === 'factura' ? '📄 Factura' : '📋 Remito'} ${d.numero_doc || ''} — ${formatMoney(d.monto)}</p>`).join('')}
          ${p.cobros?.map(c => `<p style="font-size:11px;color:#3B6D11;">💰 ${formasPagoLabel(c.forma_pago)} · ${formatFecha(c.fecha_cobro)} · ${formatMoney(c.monto)}</p>`).join('') || ''}
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="font-size:12px;color:#aaa;">Total pedido</span>
          <span style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(p.total)}</span>
        </div>
        ${cobrado < p.total ? `<p style="font-size:11px;color:#e24b4a;margin-top:4px;">Pendiente: ${formatMoney(p.total - cobrado)}</p>` : ''}
      </div>
    `;
  }).join('');
}

function descargarReportePDF() {
  window.print();
}

// =============================================
// HOJA DE RUTA
// =============================================
async function cargarHojaRuta() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data: entregas } = await supabase.from('entregas')
    .select('*, pedidos(numero, total, clientes(razon_social, direccion_entrega, whatsapp))')
    .eq('fecha_entrega', hoy).order('created_at');

  document.getElementById('hoja-ruta-container').innerHTML = (entregas || []).map((e, i) => `
    <div class="card" style="margin-bottom:8px;">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="width:32px;height:32px;border-radius:50%;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;">${i + 1}</div>
        <div style="flex:1;">
          <p style="font-size:13px;font-weight:500;">${e.pedidos?.clientes?.razon_social}</p>
          <p style="font-size:11px;color:#aaa;">${e.pedidos?.clientes?.direccion_entrega || 'Sin dirección'}</p>
          <p style="font-size:11px;color:#aaa;">Pedido #${String(e.pedidos?.numero || 0).padStart(4,'0')} · ${formatMoney(e.pedidos?.total || 0)}</p>
        </div>
        ${e.pedidos?.clientes?.whatsapp ? `<a href="https://wa.me/${(e.pedidos.clientes.whatsapp).replace(/\D/g,'')}" style="font-size:22px;color:#25D366;"><i class="ti ti-brand-whatsapp"></i></a>` : ''}
      </div>
    </div>
  `).join('') || '<p style="font-size:13px;color:#aaa;text-align:center;padding:20px;">No hay entregas para hoy</p>';
}

// =============================================
// CONFIGURACIÓN
// =============================================
async function cargarConfig() {
  const { data: config } = await supabase.from('configuracion').select('*').single();
  if (config && document.getElementById('config-comision')) {
    document.getElementById('config-comision').value = config.comision_pct;
  }

  const { data: distribuidores } = await supabase.from('distribuidores').select('*').eq('activo', true);
  const lista = document.getElementById('distribuidores-lista');
  if (lista) {
    lista.innerHTML = (distribuidores || []).map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:0.5px solid #f0ede6;">
        <input type="text" value="${d.nombre}" class="form-input" style="flex:1;margin-right:8px;" onchange="actualizarDistribuidor('${d.id}', this.value)">
      </div>
    `).join('');
  }
}

async function guardarConfig() {
  const pct = parseFloat(document.getElementById('config-comision').value);
  await supabase.from('configuracion').update({ comision_pct: pct, updated_at: new Date().toISOString() }).eq('id', 1);
  mostrarToast('Configuración guardada ✓', 'success');
}

async function actualizarDistribuidor(id, nombre) {
  await supabase.from('distribuidores').update({ nombre }).eq('id', id);
}

async function agregarDistribuidor() {
  const nombre = prompt('Nombre del distribuidor:');
  if (!nombre) return;
  await supabase.from('distribuidores').insert({ nombre });
  await cargarConfig();
}

async function cargarFormPrecios() {
  const { data: prods } = await supabase.from('productos').select('*, categorias(nombre)').eq('activo', true).order('nombre');
  document.getElementById('precios-form-container').innerHTML = (prods || []).map(p => `
    <div class="card" style="margin-bottom:6px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <p style="font-size:13px;font-weight:500;">${p.nombre}</p>
          <p style="font-size:11px;color:#aaa;">Precio actual: ${p.tiene_precio ? formatMoney(p.precio_lista) : 'Sin precio'}</p>
        </div>
        <input type="number" class="form-input" style="width:120px;" placeholder="Nuevo precio" id="precio-${p.id}">
      </div>
    </div>
  `).join('');
}

async function guardarListaPrecios() {
  const { data: prods } = await supabase.from('productos').select('id').eq('activo', true);
  const updates = [];
  const fecha = new Date().toISOString().split('T')[0];

  for (const p of prods || []) {
    const input = document.getElementById(`precio-${p.id}`);
    if (input?.value) {
      const nuevoPrecio = parseFloat(input.value);
      // Guardar en historial
      const { data: prodActual } = await supabase.from('productos').select('precio_lista').eq('id', p.id).single();
      if (prodActual?.precio_lista) {
        await supabase.from('historial_precios').insert({ producto_id: p.id, precio_lista: prodActual.precio_lista, fecha_desde: fecha });
      }
      updates.push(supabase.from('productos').update({ precio_lista: nuevoPrecio, tiene_precio: true }).eq('id', p.id));
    }
  }

  await Promise.all(updates);
  await logActividad('actualizar_precios', 'productos');
  mostrarToast('Lista de precios actualizada ✓', 'success');
  navegarA('config');
}

// =============================================
// PORTAL CLIENTE
// =============================================
async function cargarPortalCliente() {
  if (!estadoApp.usuario) return;
  const { data: cli } = await supabase.from('clientes').select('*').eq('user_id', estadoApp.usuario.id).single();
  if (!cli) return;

  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];

  // Objetivo
  if (cli.objetivo_kg_mensual) {
    const { data: items } = await supabase.from('pedido_items').select('cantidad, pedidos!inner(cliente_id, fecha_pedido)').eq('pedidos.cliente_id', cli.id).gte('pedidos.fecha_pedido', inicioMes);
    const kgMes = items?.reduce((s, i) => s + i.cantidad, 0) || 0;
    const pct = Math.min(100, (kgMes / cli.objetivo_kg_mensual) * 100);
    const clase = pct >= 80 ? 'ok' : pct >= 50 ? 'warning' : 'danger';
    const msgs = { ok: `¡Vas a mantener tu descuento del ${cli.beneficio_pct}% este mes!`, warning: 'Cuidado — te faltan kg para llegar al objetivo', danger: 'En riesgo — puede que pierdas el descuento este mes' };
    document.getElementById('portal-objetivo-section').innerHTML = `
      <div style="background:${clase === 'ok' ? '#eaf3de' : clase === 'warning' ? '#faeeda' : '#fcebeb'};border-radius:14px;padding:12px 14px;margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <p style="font-size:12px;font-weight:500;color:${clase === 'ok' ? '#3B6D11' : clase === 'warning' ? '#854F0B' : '#A32D2D'};">Objetivo del mes: ${cli.objetivo_kg_mensual.toLocaleString()} kg</p>
          <p style="font-size:12px;font-weight:500;color:${clase === 'ok' ? '#3B6D11' : clase === 'warning' ? '#854F0B' : '#A32D2D'};">${Math.round(kgMes).toLocaleString()} kg</p>
        </div>
        <div class="progress-bar" style="height:7px;background:${clase === 'ok' ? '#c0dd97' : clase === 'warning' ? '#f5d9a8' : '#f5b8b8'};"><div class="progress-fill ${clase}" style="width:${pct}%;"></div></div>
        <p style="font-size:10px;color:${clase === 'ok' ? '#3B6D11' : clase === 'warning' ? '#854F0B' : '#A32D2D'};margin-top:6px;">${msgs[clase]}</p>
      </div>
    `;
  }

  // Pedidos
  const { data: pedidos } = await supabase.from('pedidos').select('*, pedido_items(cantidad, productos(nombre))').eq('cliente_id', cli.id).order('created_at', { ascending: false }).limit(10);
  document.getElementById('portal-pedidos').innerHTML = (pedidos || []).map(p => `
    <div class="card" style="margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <div><p style="font-size:13px;font-weight:500;">Pedido #${String(p.numero).padStart(4,'0')}</p><p style="font-size:11px;color:#aaa;">${formatFecha(p.fecha_pedido)}</p></div>
        <span class="badge ${p.estado}">${estadoLabel(p.estado)}</span>
      </div>
      <div style="border-top:0.5px solid #f0ede6;padding-top:8px;display:flex;justify-content:space-between;align-items:center;">
        <p style="font-size:11px;color:#aaa;">${p.pedido_items?.map(i => `${i.productos?.nombre} × ${i.cantidad}`).join(' · ')}</p>
        <p style="font-size:14px;font-weight:700;font-family:'Playfair Display',serif;">${formatMoney(p.total)}</p>
      </div>
      ${p.estado === 'en_camion' ? `
        <div style="display:flex;gap:6px;margin-top:10px;">
          <button class="btn btn-sm" style="flex:1;background:#eaf3de;color:#3B6D11;border:none;" onclick="confirmarRecepcion('${p.id}', 'recibido_conforme')">Recibido conforme</button>
          <button class="btn btn-sm" style="flex:1;background:#faeeda;color:#854F0B;border:none;" onclick="reportarFaltante('${p.id}')">Con faltantes</button>
        </div>
      ` : ''}
    </div>
  `).join('');

  // Facturas
  const { data: docs } = await supabase.from('documentos').select('*').eq('cliente_id', cli.id).order('created_at', { ascending: false }).limit(10);
  document.getElementById('portal-facturas').innerHTML = (docs || []).map(d => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div><p style="font-size:13px;font-weight:500;">${d.tipo === 'factura' ? 'Factura' : 'Remito'} ${d.numero_doc || ''}</p><p style="font-size:11px;color:#aaa;">${formatFecha(d.fecha_emision)} · ${formatMoney(d.monto)}</p></div>
      <span class="badge ${d.verificado ? 'cobrado' : 'pendiente'}">${d.verificado ? 'Pagada' : 'Pendiente'}</span>
    </div>
  `).join('') || '<p style="font-size:13px;color:#aaa;">Sin facturas</p>';

  // Pagos
  const { data: cobros } = await supabase.from('cobros').select('*').eq('cliente_id', cli.id).order('fecha_cobro', { ascending: false }).limit(10);
  document.getElementById('portal-pagos').innerHTML = (cobros || []).map(c => `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
      <div><p style="font-size:13px;font-weight:500;">${formasPagoLabel(c.forma_pago)}</p><p style="font-size:11px;color:#aaa;">${formatFecha(c.fecha_cobro)}</p></div>
      <p style="font-size:14px;font-weight:700;color:#3B6D11;font-family:'Playfair Display',serif;">${formatMoney(c.monto)}</p>
    </div>
  `).join('') || '<p style="font-size:13px;color:#aaa;">Sin pagos registrados</p>';
}

async function confirmarRecepcion(pedidoId, estado) {
  const { data: entrega } = await supabase.from('entregas').select('id').eq('pedido_id', pedidoId).single();
  if (entrega) {
    await supabase.from('entregas').update({ estado_cliente: estado }).eq('id', entrega.id);
    await supabase.from('pedidos').update({ estado: 'entregado', updated_at: new Date().toISOString() }).eq('id', pedidoId);
  }
  mostrarToast('Recepción confirmada ✓', 'success');
  await cargarPortalCliente();
}

async function reportarFaltante(pedidoId) {
  const descripcion = prompt('Describí qué faltó:');
  if (descripcion === null) return;
  const { data: cli } = await supabase.from('clientes').select('id').eq('user_id', estadoApp.usuario.id).single();
  await supabase.from('reclamos').insert({ pedido_id: pedidoId, cliente_id: cli?.id, tipo: 'faltante_cliente', descripcion, estado: 'abierto' });
  const { data: entrega } = await supabase.from('entregas').select('id').eq('pedido_id', pedidoId).single();
  if (entrega) await supabase.from('entregas').update({ estado_cliente: 'recibido_con_faltantes', nota_cliente: descripcion }).eq('id', entrega.id);
  mostrarToast('Reclamo enviado ✓', 'success');
  await cargarPortalCliente();
}

// =============================================
// MODAL
// =============================================
function abrirModal(titulo, contenido, acciones = []) {
  document.getElementById('modal-titulo').textContent = titulo;
  document.getElementById('modal-contenido').innerHTML = contenido;
  document.getElementById('modal-acciones').innerHTML = acciones.map(a =>
    `<button class="btn ${a.style || 'btn-outline'}" onclick="(${a.action})()">${a.label}</button>`
  ).join('');
  document.getElementById('modal-overlay').style.display = 'flex';
}

function cerrarModal() {
  document.getElementById('modal-overlay').style.display = 'none';
}

// =============================================
// TOAST
// =============================================
function mostrarToast(msg, tipo = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = msg;
  document.getElementById('toast-container').appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// =============================================
// HELPERS
// =============================================
function formatMoney(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-AR');
}

function formatFecha(f) {
  if (!f) return '';
  const d = new Date(f + 'T00:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function estadoLabel(e) {
  return { pendiente: 'Pendiente', confirmado: 'Confirmado', preparando: 'Preparando', en_camion: 'En camino', entregado: 'Entregado', cobrado: 'Cobrado', cancelado: 'Cancelado' }[e] || e;
}

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`).style.display = 'block';
  event.target.classList.add('active');
}

function onFotoSeleccionada(input, labelId) {
  const label = document.getElementById(labelId);
  if (input.files[0] && label) label.textContent = input.files[0].name;
}

function subirFoto(inputId) {
  document.getElementById(inputId)?.click();
}

async function logActividad(accion, tabla, registroId = null) {
  try {
    await supabase.from('log_actividad').insert({
      user_id: estadoApp.usuario?.id,
      accion, tabla,
      registro_id: registroId,
    });
  } catch(e) {}
}

function mostrarNotificaciones() {
  mostrarToast('Sin notificaciones nuevas', 'info');
}

function mostrarPerfil() {
  abrirModal('Mi perfil', `
    <p style="font-size:14px;font-weight:500;margin-bottom:4px;">${estadoApp.perfil?.nombre || ''}</p>
    <p style="font-size:12px;color:#aaa;margin-bottom:4px;">${estadoApp.usuario?.email || ''}</p>
    <p style="font-size:12px;color:#aaa;">Rol: ${estadoApp.perfil?.rol || ''}</p>
  `, [{ label: 'Cerrar sesión', action: cerrarSesion, style: 'btn-outline' }]);
}

// Cargar clientes en select de reportes
async function cargarSelectClientes() {
  const { data: clientes } = await supabase.from('clientes').select('id, razon_social').eq('activo', true).order('razon_social');
  const sel = document.getElementById('rep-cliente');
  if (sel) sel.innerHTML = '<option value="">Todos los clientes</option>' + (clientes || []).map(c => `<option value="${c.id}">${c.razon_social}</option>`).join('');
}

// Inicializar fecha de cobro con hoy
document.addEventListener('DOMContentLoaded', () => {
  const fechaCobro = document.getElementById('cobro-fecha');
  if (fechaCobro) fechaCobro.value = new Date().toISOString().split('T')[0];
});
