// ================================================
// LA CABAÑA — Lógica principal v2.0
// ================================================

let clienteEditandoId = null
let clientesCache     = []
let usuarioActual     = null
let pedidoActualId    = null

// ── AL CARGAR ────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await db.auth.getSession()
  if (session) mostrarApp(session.user)
  else mostrarLogin()
})

// ── AUTH ─────────────────────────────────────────
async function iniciarSesion() {
  const email    = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { mostrarErrorLogin('Completá email y contraseña'); return }
  const { data, error } = await db.auth.signInWithPassword({ email, password })
  if (error) { mostrarErrorLogin('Email o contraseña incorrectos'); return }
  mostrarApp(data.user)
}
function mostrarErrorLogin(m) {
  const el = document.getElementById('login-error')
  el.textContent = m; el.style.display = 'block'
}
async function olvidoPassword() {
  const email = document.getElementById('login-email').value.trim()
  if (!email) { mostrarErrorLogin('Escribí tu email primero'); return }
  await db.auth.resetPasswordForEmail(email)
  alert('✅ Te mandamos un email para restablecer tu contraseña')
}
async function cerrarSesion() { await db.auth.signOut(); mostrarLogin() }
function mostrarLogin() {
  document.getElementById('pantalla-login').style.display = 'flex'
  document.getElementById('pantalla-app').style.display   = 'none'
}
async function mostrarApp(usuario) {
  usuarioActual = usuario
  document.getElementById('pantalla-login').style.display = 'none'
  document.getElementById('pantalla-app').style.display   = 'block'
  const { data: perfil } = await db.from('perfiles').select('nombre_completo').eq('id', usuario.id).single()
  if (perfil) document.getElementById('nombre-usuario').textContent = perfil.nombre_completo
  mostrarSeccion('dashboard')
}

// ── NAVEGACIÓN ───────────────────────────────────
function mostrarSeccion(nombre) {
  document.querySelectorAll('.seccion').forEach(s => s.style.display = 'none')
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('activo'))
  document.getElementById('seccion-' + nombre).style.display = 'block'
  document.getElementById('nav-' + nombre).classList.add('activo')
  if (nombre === 'dashboard') cargarDashboard()
  if (nombre === 'pedidos')   { mostrarVistaPedidos('lista'); cargarPedidos() }
  if (nombre === 'cobranza')  cargarCobranza()
  if (nombre === 'logistica') cargarEnvios()
  if (nombre === 'clientes')  cargarClientes()
  if (nombre === 'productos') cargarProductos()
}

// ── DASHBOARD ────────────────────────────────────
async function cargarDashboard() {
  const hoy = new Date().toISOString().split('T')[0]
  const { data: pedidos }    = await db.from('pedidos').select('id').gte('created_at', hoy)
  const { data: cobros }     = await db.from('cobros').select('monto').gte('created_at', hoy)
  const { data: pendientes } = await db.from('pedidos').select('id').eq('estado_cobro', 'pendiente')
  const { data: envios }     = await db.from('envios').select('id').eq('estado', 'en_camino')
  const { data: porVencer }  = await db.from('pedidos')
    .select('numero, fecha_vencimiento_cobro, clientes(razon_social)')
    .eq('estado_cobro', 'pendiente')
    .lte('fecha_vencimiento_cobro', new Date(Date.now() + 2*86400000).toISOString().split('T')[0])
    .gte('fecha_vencimiento_cobro', hoy)

  document.getElementById('total-pedidos-hoy').textContent  = pedidos?.length || 0
  document.getElementById('total-cobros-hoy').textContent   = '$' + (cobros?.reduce((s,c) => s + Number(c.monto), 0) || 0).toLocaleString('es-AR')
  document.getElementById('total-pendientes').textContent   = pendientes?.length || 0
  document.getElementById('total-envios').textContent       = envios?.length || 0

  const alertasEl = document.getElementById('alertas-vencimiento')
  if (porVencer && porVencer.length > 0) {
    alertasEl.innerHTML = `
      <div class="alerta-box">
        ⚠️ <b>${porVencer.length} pedido(s) vencen en los próximos 2 días:</b><br>
        ${porVencer.map(p => `#${p.numero} — ${p.clientes?.razon_social} — vence ${formatFecha(p.fecha_vencimiento_cobro)}`).join('<br>')}
      </div>`
  } else {
    alertasEl.innerHTML = ''
  }
}

// ── PEDIDOS ──────────────────────────────────────
function mostrarVistaPedidos(vista) {
  document.getElementById('vista-lista-pedidos').style.display   = vista === 'lista'   ? 'block' : 'none'
  document.getElementById('vista-detalle-pedido').style.display  = vista === 'detalle' ? 'block' : 'none'
  document.getElementById('vista-nuevo-pedido').style.display    = vista === 'nuevo'   ? 'block' : 'none'
  document.getElementById('vista-resumen-pedido').style.display  = vista === 'resumen' ? 'block' : 'none'
}


async function cargarEnvios() {
  const { data: envios } = await db.from('envios')
    .select('id, numero, estado, vehiculo, fecha_salida, fecha_llegada, perfiles(nombre_completo)')
    .order('created_at', { ascending: false }).limit(20)

  const html = envios && envios.length > 0
    ? `<table class="tabla"><thead><tr><th>#</th><th>Repartidor</th><th>Vehículo</th><th>Estado</th><th>Salida</th></tr></thead><tbody>
      ${envios.map(e => `<tr>
        <td><b>#${e.numero}</b></td>
        <td>${e.perfiles?.nombre_completo || '-'}</td>
        <td>${e.vehiculo || '-'}</td>
        <td>${badgeEnvio(e.estado)}</td>
        <td>${e.fecha_salida ? formatFecha(e.fecha_salida) : '-'}</td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="vacio">No hay envíos registrados</p>'

  document.getElementById('lista-envios').innerHTML = html
}

// ── CLIENTES ─────────────────────────────────────
async function cargarClientes() {
  mostrarVistaClientes('lista')
  const { data, error } = await db.from('clientes').select('id, razon_social, telefono, saldo_pendiente, activo').order('razon_social')
  if (error) { console.error(error); return }
  clientesCache = data || []
  renderizarListaClientes(clientesCache)
}
function renderizarListaClientes(clientes) {
  const lista = document.getElementById('lista-clientes')
  if (!clientes || clientes.length === 0) { lista.innerHTML = '<p class="vacio">No hay clientes cargados</p>'; return }
  lista.innerHTML = clientes.map(c => `
    <div class="cliente-card" onclick="abrirFichaCliente('${c.id}')">
      <div class="cliente-card-info">
        <div class="cliente-nombre">${c.razon_social}</div>
        <div class="cliente-tel">📞 ${c.telefono || 'Sin teléfono'}
          ${c.telefono ? `<a href="https://wa.me/54${c.telefono.replace(/\D/g,'')}" onclick="event.stopPropagation()" target="_blank" class="btn-whatsapp">💬 WhatsApp</a>` : ''}
        </div>
        <div class="cliente-saldo ${Number(c.saldo_pendiente) > 0 ? 'saldo-deuda' : 'saldo-ok'}">
          ${Number(c.saldo_pendiente) > 0 ? '💰 Saldo: $' + Number(c.saldo_pendiente).toLocaleString('es-AR') + ' pendiente' : '✅ Sin deuda'}
        </div>
      </div>
      <div class="cliente-card-arrow">›</div>
    </div>`).join('')
}
function filtrarClientes() {
  const b = document.getElementById('buscador-clientes').value.toLowerCase()
  renderizarListaClientes(clientesCache.filter(c => c.razon_social.toLowerCase().includes(b)))
}
async function abrirFichaCliente(id) {
  mostrarVistaClientes('ficha')
  const { data: c } = await db.from('clientes').select('*').eq('id', id).single()
  if (!c) return
  clienteEditandoId = id
  const formasPago = [c.pago_efectivo ? 'Efectivo' : null, c.pago_cheque ? 'Cheque' : null, c.pago_transferencia ? 'Transferencia' : null].filter(Boolean).join(', ') || 'No especificado'
  const { data: pedidos } = await db.from('pedidos').select('numero, total, estado_cobro, etapa, fecha_pedido').eq('cliente_id', id).order('created_at', { ascending: false }).limit(5)
  document.getElementById('contenido-ficha-cliente').innerHTML = `
    <div class="form-card">
      <div class="ficha-nombre">${c.razon_social}</div>
      ${c.activo ? '<span class="badge badge-verde">Activo</span>' : '<span class="badge badge-rojo">Inactivo</span>'}
      <div class="form-seccion">DATOS BÁSICOS</div>
      <div class="ficha-fila"><span>CUIT</span><span>${c.cuit || '-'}</span></div>
      <div class="ficha-fila"><span>Teléfono</span><span>${c.telefono || '-'} ${c.telefono ? `<a href="https://wa.me/54${c.telefono.replace(/\D/g,'')}" target="_blank" class="btn-whatsapp">💬</a>` : ''}</span></div>
      <div class="ficha-fila"><span>Email</span><span>${c.email || '-'}</span></div>
      <div class="ficha-fila"><span>Dirección</span><span>${c.direccion || '-'}</span></div>
      <div class="ficha-fila"><span>Localidad</span><span>${c.localidad || '-'}, ${c.provincia || '-'}</span></div>
      <div class="form-seccion">CONDICIÓN FISCAL</div>
      <div class="ficha-fila"><span>Condición IVA</span><span>${c.condicion_iva?.replace(/_/g,' ') || '-'}</span></div>
      <div class="ficha-fila"><span>Facturación</span><span>${labelFacturacion(c.condicion_factura, c.pct_remito, c.pct_factura)}</span></div>
      <div class="ficha-fila"><span>Alícuota IVA</span><span>${c.alicuota_iva}%</span></div>
      <div class="form-seccion">BENEFICIO COMERCIAL</div>
      <div class="ficha-fila"><span>Descuento precio</span><span>${c.descuento_pct}%</span></div>
      <div class="ficha-fila"><span>Bonificación producto</span><span>${c.bonificacion_pct}%</span></div>
      <div class="form-seccion">CONDICIONES DE PAGO</div>
      <div class="ficha-fila"><span>Vencimiento</span><span>${c.dias_vencimiento} días desde entrega</span></div>
      <div class="ficha-fila"><span>Formas de pago</span><span>${formasPago}</span></div>
      ${c.observaciones ? `<div class="form-seccion">OBSERVACIONES</div><div class="ficha-obs">${c.observaciones}</div>` : ''}
      <div class="form-seccion">ÚLTIMOS PEDIDOS</div>
      ${pedidos && pedidos.length > 0 ? pedidos.map(p => `
        <div class="ficha-pedido-item">
          <span><b>#${p.numero}</b> — ${formatFecha(p.fecha_pedido)}</span>
          <span>$${Number(p.total).toLocaleString('es-AR')} ${badgeCobro(p.estado_cobro)}</span>
        </div>`).join('') : '<p class="vacio">Sin pedidos</p>'}
    </div>`
}
function editarClienteActual() { if (clienteEditandoId) abrirFormCliente(clienteEditandoId) }
async function abrirFormCliente(id = null) {
  mostrarVistaClientes('form')
  await cargarProvincias()
  clienteEditandoId = id
  if (id) {
    document.getElementById('titulo-form-cliente').textContent = 'Editar Cliente'
    const { data: c } = await db.from('clientes').select('*').eq('id', id).single()
    if (!c) return
    document.getElementById('f-razon-social').value   = c.razon_social || ''
    document.getElementById('f-cuit').value           = c.cuit || ''
    document.getElementById('f-telefono').value       = c.telefono || ''
    document.getElementById('f-email').value          = c.email || ''
    document.getElementById('f-direccion').value      = c.direccion || ''
    document.getElementById('f-condicion-iva').value  = c.condicion_iva || 'responsable_inscripto'
    document.getElementById('f-condicion-factura').value = c.condicion_factura || 'todo_factura'
    document.getElementById('f-pct-remito').value     = c.pct_remito || 50
    document.getElementById('f-pct-factura').value    = c.pct_factura || 50
    document.getElementById('f-alicuota-iva').value   = c.alicuota_iva || 21
    document.getElementById('f-descuento').value      = c.descuento_pct || 0
    document.getElementById('f-bonificacion').value   = c.bonificacion_pct || 0
    document.getElementById('f-dias-vencimiento').value = c.dias_vencimiento || 7
    document.getElementById('f-pago-efectivo').checked      = c.pago_efectivo || false
    document.getElementById('f-pago-cheque').checked        = c.pago_cheque || false
    document.getElementById('f-pago-transferencia').checked = c.pago_transferencia || false
    document.getElementById('f-observaciones').value  = c.observaciones || ''
    toggleMixto()
    if (c.provincia) {
      document.getElementById('f-provincia').value = c.provincia
      await cargarLocalidades()
      document.getElementById('f-localidad').value = c.localidad || ''
    }
  } else {
    document.getElementById('titulo-form-cliente').textContent = 'Nuevo Cliente'
    ;['f-razon-social','f-cuit','f-telefono','f-email','f-direccion','f-observaciones'].forEach(id => document.getElementById(id).value = '')
    document.getElementById('f-condicion-iva').value = 'responsable_inscripto'
    document.getElementById('f-condicion-factura').value = 'todo_factura'
    document.getElementById('f-pct-remito').value = 50
    document.getElementById('f-pct-factura').value = 50
    document.getElementById('f-alicuota-iva').value = 21
    document.getElementById('f-descuento').value = 0
    document.getElementById('f-bonificacion').value = 0
    document.getElementById('f-dias-vencimiento').value = 7
    document.getElementById('f-pago-efectivo').checked = false
    document.getElementById('f-pago-cheque').checked   = false
    document.getElementById('f-pago-transferencia').checked = false
    toggleMixto()
  }
}
async function guardarCliente() {
  const razonSocial = document.getElementById('f-razon-social').value.trim()
  if (!razonSocial) { document.getElementById('form-error').textContent = 'La razón social es obligatoria'; document.getElementById('form-error').style.display = 'block'; return }
  document.getElementById('form-error').style.display = 'none'
  const datos = {
    razon_social: razonSocial,
    cuit: document.getElementById('f-cuit').value.trim() || null,
    telefono: document.getElementById('f-telefono').value.trim() || null,
    email: document.getElementById('f-email').value.trim() || null,
    direccion: document.getElementById('f-direccion').value.trim() || null,
    provincia: document.getElementById('f-provincia').value || null,
    localidad: document.getElementById('f-localidad').value || null,
    condicion_iva: document.getElementById('f-condicion-iva').value,
    condicion_factura: document.getElementById('f-condicion-factura').value,
    pct_remito: parseInt(document.getElementById('f-pct-remito').value) || 50,
    pct_factura: parseInt(document.getElementById('f-pct-factura').value) || 50,
    alicuota_iva: parseFloat(document.getElementById('f-alicuota-iva').value) || 21,
    descuento_pct: parseFloat(document.getElementById('f-descuento').value) || 0,
    bonificacion_pct: parseFloat(document.getElementById('f-bonificacion').value) || 0,
    dias_vencimiento: parseInt(document.getElementById('f-dias-vencimiento').value) || 7,
    pago_efectivo: document.getElementById('f-pago-efectivo').checked,
    pago_cheque: document.getElementById('f-pago-cheque').checked,
    pago_transferencia: document.getElementById('f-pago-transferencia').checked,
    observaciones: document.getElementById('f-observaciones').value.trim() || null,
  }
  let error
  if (clienteEditandoId) {
    const res = await db.from('clientes').update(datos).eq('id', clienteEditandoId)
    error = res.error
  } else {
    datos.vendedor_id = usuarioActual.id
    datos.codigo = 'CLI-' + Date.now()
    const res = await db.from('clientes').insert(datos)
    error = res.error
  }
  if (error) { document.getElementById('form-error').textContent = 'Error: ' + error.message; document.getElementById('form-error').style.display = 'block'; return }
  await cargarClientes()
  alert('✅ Cliente guardado correctamente')
}
function volverAClientes() { cargarClientes() }
function mostrarVistaClientes(vista) {
  document.getElementById('vista-lista-clientes').style.display = vista === 'lista' ? 'block' : 'none'
  document.getElementById('vista-ficha-cliente').style.display  = vista === 'ficha' ? 'block' : 'none'
  document.getElementById('vista-form-cliente').style.display   = vista === 'form'  ? 'block' : 'none'
}
function toggleMixto() {
  document.getElementById('campo-mixto').style.display =
    document.getElementById('f-condicion-factura').value === 'mixto' ? 'block' : 'none'
}
function sincronizarPct(origen) {
  const val = parseInt(document.getElementById('f-pct-' + origen).value) || 0
  document.getElementById('f-pct-' + (origen === 'remito' ? 'factura' : 'remito')).value = 100 - val
}
async function cargarProvincias() {
  const select = document.getElementById('f-provincia')
  if (select.options.length > 1) return
  try {
    const res  = await fetch('https://apis.datos.gob.ar/georef/api/provincias?orden=nombre&max=100')
    const data = await res.json()
    data.provincias.forEach(p => { const o = document.createElement('option'); o.value = p.nombre; o.textContent = p.nombre; select.appendChild(o) })
  } catch(e) { console.error(e) }
}
async function cargarLocalidades() {
  const provincia = document.getElementById('f-provincia').value
  const select    = document.getElementById('f-localidad')
  select.innerHTML = '<option value="">Cargando...</option>'
  if (!provincia) { select.innerHTML = '<option value="">Primero seleccioná una provincia...</option>'; return }
  try {
    const res  = await fetch(`https://apis.datos.gob.ar/georef/api/municipios?provincia=${encodeURIComponent(provincia)}&orden=nombre&max=500`)
    const data = await res.json()
    select.innerHTML = '<option value="">Seleccioná una localidad...</option>'
    data.municipios.forEach(m => { const o = document.createElement('option'); o.value = m.nombre; o.textContent = m.nombre; select.appendChild(o) })
  } catch(e) { select.innerHTML = '<option value="">Error al cargar</option>' }
}

// ── PRODUCTOS ────────────────────────────────────
async function cargarProductos() {
  const { data: productos } = await db.from('productos').select('id, codigo, descripcion, precio_1, unidad, activo').order('descripcion')
  const html = productos && productos.length > 0
    ? `<table class="tabla"><thead><tr><th>Código</th><th>Descripción</th><th>Precio</th><th>Unidad</th><th>Estado</th></tr></thead><tbody>
      ${productos.map(p => `<tr><td>${p.codigo}</td><td><b>${p.descripcion}</b></td><td>$${Number(p.precio_1).toLocaleString('es-AR')}</td><td>${p.unidad}</td>
      <td><span class="badge ${p.activo ? 'badge-verde' : 'badge-rojo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td></tr>`).join('')}</tbody></table>`
    : '<p class="vacio">No hay productos cargados</p>'
  document.getElementById('lista-productos').innerHTML = html
}

// ── STUBS ────────────────────────────────────────
function nuevoPedido()   { alert('🚧 Próximamente') }
function nuevoEnvio()    { alert('🚧 Próximamente') }
function nuevoProducto() { alert('🚧 Próximamente') }

// ── HELPERS ──────────────────────────────────────
function formatFecha(f) { if (!f) return '-'; return new Date(f).toLocaleDateString('es-AR') }
function formatFechaHora(f) { if (!f) return '-'; return new Date(f).toLocaleString('es-AR', { dateStyle:'short', timeStyle:'short' }) }
function labelFacturacion(tipo, pctR, pctF) {
  if (tipo === 'todo_remito')  return 'Todo Remito'
  if (tipo === 'todo_factura') return 'Todo Factura'
  if (tipo === 'mixto')        return `Mixto (${pctR}% Remito / ${pctF}% Factura)`
  return '-'
}
function labelTipoDoc(t) {
  const l = { remito:'Remito', factura_a:'Factura A', factura_b:'Factura B', factura_c:'Factura C' }
  return l[t] || t
}
function labelMedio(m) {
  const l = { efectivo:'Efectivo', transferencia:'Transferencia', cheque:'Cheque', echeq:'Echeq' }
  return l[m] || m
}
function iconMedio(m) {
  const i = { efectivo:'💵', transferencia:'🏦', cheque:'📋', echeq:'📱' }
  return i[m] || '💰'
}
function iconAccion(a) {
  const i = { pedido_creado:'📦', documento_subido:'📄', cobro_registrado:'💰', estado_cambiado:'🔄', pedido_cerrado:'✅' }
  return i[a] || '•'
}
function renderDiferencias(d) {
  if (!d) return ''
  if (d.mensaje) return `<p>${d.mensaje}</p>`
  return '<p>Ver diferencias en detalle</p>'
}
function badgeVerificacion(v) {
  const c = { pendiente:'badge-gris', ok:'badge-verde', con_diferencias:'badge-amarillo', error:'badge-rojo' }
  const l = { pendiente:'⏳ Pendiente', ok:'✅ Verificado', con_diferencias:'⚠️ Con diferencias', error:'❌ Error' }
  return `<span class="badge ${c[v]||'badge-gris'}">${l[v]||v}</span>`
}
function badgeEtapa(e) {
  const c = { pedido:'badge-gris', documentado:'badge-azul', cobrado:'badge-amarillo', cerrado:'badge-verde' }
  const l = { pedido:'Pedido', documentado:'Documentado', cobrado:'Cobrado', cerrado:'Cerrado' }
  return `<span class="badge ${c[e]||'badge-gris'}">${l[e]||e}</span>`
}
function badgeEstado(e) {
  const c = { borrador:'badge-gris', confirmado:'badge-azul', en_camino:'badge-amarillo', entregado:'badge-verde', cancelado:'badge-rojo' }
  return `<span class="badge ${c[e]||'badge-gris'}">${e}</span>`
}
function badgeCobro(e) {
  const c = { pendiente:'badge-amarillo', cobrado_efectivo:'badge-verde', cobrado_transferencia:'badge-verde', cobrado_cheque:'badge-verde', cobrado_tarjeta:'badge-verde', incobrable:'badge-rojo' }
  const l = { pendiente:'Pendiente', cobrado_efectivo:'Efectivo', cobrado_transferencia:'Transferencia', cobrado_cheque:'Cheque', cobrado_tarjeta:'Tarjeta', incobrable:'Incobrable' }
  return `<span class="badge ${c[e]||'badge-gris'}">${l[e]||e}</span>`
}
function badgeEnvio(e) {
  const c = { preparando:'badge-gris', en_camino:'badge-amarillo', entregado:'badge-verde' }
  return `<span class="badge ${c[e]||'badge-gris'}">${e}</span>`
}
// ================================================
// AGREGAR AL FINAL DE app.js
// Funciones de Productos y Lista de Precios
// ================================================

// ── PRODUCTOS ────────────────────────────────────
let rolUsuarioActual = null

async function cargarRolUsuario() {
  if (rolUsuarioActual) return rolUsuarioActual
  const { data } = await db.from('perfiles').select('rol').eq('id', usuarioActual.id).single()
  rolUsuarioActual = data?.rol || 'vendedor'
  return rolUsuarioActual
}

async function cargarProductos() {
  mostrarVistaProductos('catalogo')
  const rol = await cargarRolUsuario()
  const btnActualizar = document.getElementById('btn-actualizar-precios')
  if (btnActualizar) btnActualizar.style.display = rol === 'admin' ? 'block' : 'none'

  const { data: productos } = await db.from('productos')
    .select('*, categorias(nombre, orden)')
    .order('descripcion')

  if (!productos || productos.length === 0) {
    document.getElementById('lista-productos').innerHTML = '<p class="vacio">No hay productos cargados</p>'
    return
  }

  // Agrupar por categoría manteniendo orden
  const porCategoria = {}
  productos.forEach(p => {
    const cat = p.categorias?.nombre || 'Sin categoría'
    if (!porCategoria[cat]) porCategoria[cat] = []
    porCategoria[cat].push(p)
  })

  let html = ''
  Object.entries(porCategoria).forEach(([cat, prods]) => {
    html += `<div class="categoria-grupo">
      <div class="categoria-titulo">${cat}</div>
      <table class="tabla">
        <thead>
          <tr>
            <th>Descripción</th>
            <th>Precio unitario</th>
            <th>Precio por caja</th>
            <th>Últ. actualización</th>
          </tr>
        </thead>
        <tbody>
          ${prods.map(p => {
            const esPorKg   = p.tipo_precio === 'por_kg'
            const tieneCaja = p.unidades_por_caja > 1 || esPorKg

            const precioUnidad = esPorKg
              ? `$${Number(p.precio_por_kg).toLocaleString('es-AR')}<small> /kg</small>`
              : p.precio_1 > 0
                ? `$${Number(p.precio_1).toLocaleString('es-AR')}<small> /${p.unidad}</small>`
                : '<span class="precio-sin-definir">Sin precio</span>'

            const precioCaja = tieneCaja && p.precio_caja > 0
              ? `$${Number(p.precio_caja).toLocaleString('es-AR')}<small> /caja</small>`
              : esPorKg
                ? `$${Number(p.precio_1).toLocaleString('es-AR')}<small> /caja</small>`
                : '-'

            return `<tr>
              <td>
                <b>${p.descripcion}</b>
                ${esPorKg ? `<br><small class="desc-detalle">Caja ${p.kg_por_unidad}kg</small>` : ''}
                ${!esPorKg && p.unidades_por_caja > 1 ? `<br><small class="desc-detalle">${p.unidades_por_caja} ${p.unidad}s por caja</small>` : ''}
              </td>
              <td class="precio-col">${precioUnidad}</td>
              <td class="precio-col">${precioCaja}</td>
              <td>${p.fecha_ultimo_precio ? formatFecha(p.fecha_ultimo_precio) : '-'}</td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>`
  })

  document.getElementById('lista-productos').innerHTML = html
}

function mostrarVistaProductos(vista) {
  document.getElementById('vista-catalogo-productos').style.display   = vista === 'catalogo'  ? 'block' : 'none'
  document.getElementById('vista-actualizar-precios').style.display   = vista === 'actualizar'? 'block' : 'none'
  document.getElementById('vista-historial-precios').style.display    = vista === 'historial' ? 'block' : 'none'

  if (vista === 'actualizar') cargarTablaActualizarPrecios()
  if (vista === 'historial')  cargarHistorialPrecios()
}

async function cargarTablaActualizarPrecios() {
  // Setear fecha de hoy por defecto
  const hoy = new Date().toISOString().split('T')[0]
  document.getElementById('precio-fecha-vigencia').value = hoy

  // Preview foto
  document.getElementById('precio-foto-lista').onchange = function() {
    const file = this.files[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = e => {
        document.getElementById('precio-foto-img').src = e.target.result
        document.getElementById('precio-foto-preview').style.display = 'block'
      }
      reader.readAsDataURL(file)
    }
  }

  const { data: categorias } = await db.from('categorias').select('id, nombre').order('orden')
  const { data: productos }  = await db.from('productos').select('*').order('descripcion')

  if (!productos) return

  // Agrupar por categoría
  const porCategoria = {}
  categorias?.forEach(c => { porCategoria[c.id] = { nombre: c.nombre, productos: [] } })
  productos.forEach(p => {
    if (porCategoria[p.categoria_id]) porCategoria[p.categoria_id].productos.push(p)
  })

  let html = ''
  Object.values(porCategoria).forEach(cat => {
    if (cat.productos.length === 0) return
    html += `<div class="categoria-grupo">
      <div class="categoria-titulo">${cat.nombre}</div>
      <table class="tabla-precios">
        <thead><tr><th>Producto</th><th>Precio actual</th><th>Precio nuevo</th></tr></thead>
        <tbody>
          ${cat.productos.map(p => `<tr>
            <td>
              <b>${p.descripcion}</b><br>
              <small>${p.unidad}</small>
            </td>
            <td class="precio-actual-col">
              ${p.precio_1 > 0 ? '$' + Number(p.precio_1).toLocaleString('es-AR') : '<span class="precio-sin-definir">Sin precio</span>'}
            </td>
            <td>
              <div class="input-con-sufijo">
                <span>$</span>
                <input type="number"
                  class="input-precio-nuevo"
                  data-producto-id="${p.id}"
                  data-precio-actual="${p.precio_1}"
                  placeholder="${p.precio_1 > 0 ? Number(p.precio_1).toLocaleString('es-AR') : '0'}"
                  min="0" step="0.01">
              </div>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`
  })

  document.getElementById('tabla-actualizar-precios').innerHTML = html
}

async function guardarNuevosPrecios() {
  const fechaVigencia = document.getElementById('precio-fecha-vigencia').value
  if (!fechaVigencia) {
    document.getElementById('precio-error').textContent = 'Ingresá la fecha de vigencia'
    document.getElementById('precio-error').style.display = 'block'
    return
  }
  document.getElementById('precio-error').style.display = 'none'

  // Recolectar precios que cambiaron
  const inputs = document.querySelectorAll('.input-precio-nuevo')
  const cambios = []
  inputs.forEach(input => {
    const nuevo = parseFloat(input.value)
    const actual = parseFloat(input.dataset.precioActual)
    if (nuevo && nuevo > 0 && nuevo !== actual) {
      cambios.push({
        id:       input.dataset.productoId,
        anterior: actual,
        nuevo:    nuevo
      })
    }
  })

  if (cambios.length === 0) {
    alert('No ingresaste ningún precio nuevo.')
    return
  }

  // Subir foto de referencia si hay
  let fotoUrl = null
  const fotoFile = document.getElementById('precio-foto-lista').files[0]
  if (fotoFile) {
    const ext  = fotoFile.name.split('.').pop()
    const path = `listas/lista_${fechaVigencia}_${Date.now()}.${ext}`
    const { error: upErr } = await db.storage.from('documentos').upload(path, fotoFile, { upsert: true })
    if (!upErr) {
      const { data: urlData } = db.storage.from('documentos').getPublicUrl(path)
      fotoUrl = urlData.publicUrl
    }
  }

  // Actualizar cada producto que cambió
  let actualizados = 0
  for (const c of cambios) {
    const { error } = await db.from('productos').update({
      precio_anterior:    c.anterior,
      precio_1:           c.nuevo,
      fecha_ultimo_precio: fechaVigencia
    }).eq('id', c.id)
    if (!error) actualizados++
  }

  // Guardar en historial
  await db.from('historial_listas_precio').insert({
    fecha_vigencia:         fechaVigencia,
    imagen_url:             fotoUrl,
    subido_por:             usuarioActual.id,
    precios_confirmados:    cambios,
    confirmado:             true,
    productos_actualizados: actualizados
  })

  alert(`✅ Lista actualizada correctamente.\n${actualizados} precios actualizados.`)
  mostrarVistaProductos('catalogo')
  cargarProductos()
}

async function cargarHistorialPrecios() {
  const { data: historial } = await db.from('historial_listas_precio')
    .select('*, perfiles(nombre_completo)')
    .order('created_at', { ascending: false })

  const el = document.getElementById('lista-historial-precios')
  if (!historial || historial.length === 0) {
    el.innerHTML = '<p class="vacio">No hay listas de precios registradas</p>'
    return
  }

  el.innerHTML = historial.map(h => `
    <div class="historial-lista-item">
      <div class="historial-lista-info">
        <div class="historial-lista-fecha">📅 Vigente desde: <b>${formatFecha(h.fecha_vigencia)}</b></div>
        <div class="historial-lista-detalle">
          ${h.productos_actualizados} precios actualizados •
          Subido por ${h.perfiles?.nombre_completo || '-'} •
          ${formatFechaHora(h.created_at)}
        </div>
        ${h.precios_confirmados ? `
        <div class="historial-lista-cambios">
          ${h.precios_confirmados.slice(0,3).map(c =>
            `<span class="cambio-badge">$${Number(c.anterior).toLocaleString('es-AR')} → $${Number(c.nuevo).toLocaleString('es-AR')}</span>`
          ).join('')}
          ${h.precios_confirmados.length > 3 ? `<span class="cambio-badge">+${h.precios_confirmados.length - 3} más</span>` : ''}
        </div>` : ''}
      </div>
      ${h.imagen_url ? `<a href="${h.imagen_url}" target="_blank" class="btn-ver">📷 Ver lista</a>` : ''}
    </div>`).join('')
}

// ── ACTUALIZAR ETAPA ─────────────────────────────
async function actualizarEtapaPedido(pedidoId, pedido) {
  if (pedido.etapa === 'cobrado') return

  const [{ data: docs }, { data: cobrosData }] = await Promise.all([
    db.from('documentos_pedido').select('id').eq('pedido_id', pedidoId),
    db.from('cobros').select('monto').eq('pedido_id', pedidoId)
  ])

  const totalCobrado   = cobrosData?.reduce((s, c) => s + Number(c.monto), 0) || 0
  const pagadoCompleto = Number(pedido.total) > 0 && Math.abs(totalCobrado - Number(pedido.total)) <= 1
  const tieneDocumentos = docs && docs.length > 0
  const etapaActual = pedido.etapa || 'pedido'

  let etapaReal = etapaActual
  if (tieneDocumentos && etapaActual === 'pedido') etapaReal = 'facturado'
  if (pagadoCompleto && ['pedido','facturado','enviado','recibido'].includes(etapaActual)) etapaReal = 'cobrado'

  actualizarBarraProgreso(etapaReal)

  if (etapaReal !== etapaActual) {
    await db.from('pedidos').update({ etapa: etapaReal, monto_cobrado: totalCobrado }).eq('id', pedidoId)
  }
}

function actualizarBarraProgreso(etapa) {
  const etapas = ['pedido', 'facturado', 'enviado', 'recibido', 'cobrado']
  const mapa   = { documentado: 'facturado', cerrado: 'cobrado' }
  const e      = mapa[etapa] || etapa
  const idx    = etapas.indexOf(e)
  etapas.forEach((et, i) => {
    const el = document.getElementById('prog-' + et)
    if (!el) return
    const c = el.querySelector('.progreso-circulo')
    if (c) c.className = 'progreso-circulo' + (i <= idx ? ' activo' : '')
  })
}

async function cerrarPedido(pedidoId) {
  const ok = confirm('¿Cerrar este pedido definitivamente?')
  if (!ok) return
  await db.from('pedidos').update({ etapa: 'cobrado' }).eq('id', pedidoId)
  await registrarHistorial(pedidoId, 'pedido_cerrado', 'Pedido cerrado manualmente')
  await abrirPedido(pedidoId)
}

async function cancelarPedido(pedidoId) {
  const confirmar = confirm('¿Cancelar este pedido?')
  if (!confirmar) return
  await db.from('pedidos').update({ estado: 'cancelado', etapa: 'pedido' }).eq('id', pedidoId)
  await registrarHistorial(pedidoId, 'estado_cambiado', 'Pedido cancelado')
  volverAPedidos()
}

async function eliminarPedido(pedidoId) {
  const confirmar = confirm('¿Eliminar este pedido definitivamente?')
  if (!confirmar) return
  await db.from('pedido_items').delete().eq('pedido_id', pedidoId)
  await db.from('historial_pedido').delete().eq('pedido_id', pedidoId)
  await db.from('documentos_pedido').delete().eq('pedido_id', pedidoId)
  await db.from('cobros').delete().eq('pedido_id', pedidoId)
  await db.from('notificaciones_admin').delete().eq('pedido_id', pedidoId)
  await db.from('pedidos').delete().eq('id', pedidoId)
  volverAPedidos()
}

async function aprobarPedido(pedidoId) {
  await db.from('pedidos').update({ estado: 'confirmado', aprobado_por: usuarioActual.id, fecha_aprobacion: new Date().toISOString() }).eq('id', pedidoId)
  await registrarHistorial(pedidoId, 'estado_cambiado', 'Pedido aprobado por el vendedor')
  await abrirPedido(pedidoId)
}

async function rechazarPedido(pedidoId) {
  const motivo = prompt('¿Por qué rechazás este pedido?')
  if (!motivo) return
  await db.from('pedidos').update({ estado: 'rechazado', motivo_rechazo: motivo }).eq('id', pedidoId)
  await registrarHistorial(pedidoId, 'estado_cambiado', 'Pedido rechazado: ' + motivo)
  await abrirPedido(pedidoId)
}


async function abrirPedido(id) {
  pedidoActualId = id
  mostrarVistaPedidos('detalle')

  const { data: p } = await db.from('pedidos')
    .select('*, clientes(*)')
    .eq('id', id).single()
  if (!p) return

  document.getElementById('titulo-pedido').textContent = 'Pedido #' + p.numero

  // Barra de progreso inicial
  actualizarBarraProgreso(p.etapa || 'pedido')

  // Alerta vencimiento
  const alertaEl = document.getElementById('alerta-vencimiento-pedido')
  if (p.alerta_vencimiento) {
    alertaEl.style.display = 'block'
    document.getElementById('texto-alerta-vencimiento').textContent =
      'Este pedido vence el ' + formatFecha(p.fecha_vencimiento_cobro) + '. ¡Gestionar cobro urgente!'
  } else {
    alertaEl.style.display = 'none'
  }

  // Info del pedido
  const cliente = p.clientes
  document.getElementById('info-pedido').innerHTML = `
    <div class="info-grid">
      <div><span class="info-label">Cliente</span><span class="info-valor">${cliente?.razon_social || '-'}</span></div>
      <div><span class="info-label">Total</span><span class="info-valor total-grande">$${Number(p.total).toLocaleString('es-AR')}</span></div>
      <div><span class="info-label">Facturación</span><span class="info-valor">${labelFacturacion(cliente?.condicion_factura, cliente?.pct_remito, cliente?.pct_factura)}</span></div>
      <div><span class="info-label">Vencimiento</span><span class="info-valor">${p.fecha_vencimiento_cobro ? formatFecha(p.fecha_vencimiento_cobro) : 'No definido'}</span></div>
      <div><span class="info-label">Estado cobro</span><span class="info-valor">${badgeCobro(p.estado_cobro)}</span></div>
      <div><span class="info-label">Descuento</span><span class="info-valor">${cliente?.descuento_pct || 0}%</span></div>
      ${cliente?.bonificacion_pct > 0 ? `<div><span class="info-label">Bonificación</span><span class="info-valor">${cliente.bonificacion_pct}% en producto</span></div>` : ''}
    </div>`

  await cargarDocumentosPedido(id)
  await cargarProductosPedido(id)
  await cargarCobrosPedido(id)
  await cargarHistorialPedido(id)
  await actualizarEtapaPedido(id, p)

  // Botones de acción
  const rol3 = await cargarRolUsuario()
  const esAdmin3 = rol3 === 'admin'
  const esVendedor3 = rol3 === 'vendedor'
  const puedeAprobar3 = p.estado === 'pendiente_aprobacion'
  const etapaActual3 = p.etapa || 'pedido'

  const botonesEl = document.getElementById('info-pedido')
  if (botonesEl) {
    botonesEl.innerHTML += `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:16px;border-top:1px solid #eee">
      ${puedeAprobar3 ? `
        <button onclick="aprobarPedido('${id}')" class="btn-nuevo">✅ Aprobar</button>
        <button onclick="rechazarPedido('${id}')" class="btn-cancelar" style="color:#c00">❌ Rechazar</button>
      ` : ''}
      ${etapaActual3 === 'facturado' && (esAdmin3 || esVendedor3) ? `
        <button onclick="marcarEnviado('${id}')" class="btn-enviado">
          <i class="ti ti-truck" aria-hidden="true"></i> Marcar como enviado
        </button>` : ''}
      ${etapaActual3 === 'enviado' ? `
        <button onclick="marcarRecibido('${id}')" class="btn-recibido">
          <i class="ti ti-check" aria-hidden="true"></i> Confirmar recepción
        </button>` : ''}
      ${etapaActual3 === 'cobrado' ? `
        <button onclick="descargarPDF('${id}')" class="btn-secundario">
          <i class="ti ti-file-download" aria-hidden="true"></i> Descargar PDF
        </button>` : ''}
      ${!['cobrado','cancelado'].includes(etapaActual3) && (esAdmin3 || esVendedor3) ? `
        <button onclick="cancelarPedido('${id}')" class="btn-cancelar">🚫 Cancelar</button>
      ` : ''}
      ${esAdmin3 ? `
        <button onclick="eliminarPedido('${id}')" class="btn-cancelar" style="color:#c00;border-color:#c00">🗑️ Eliminar</button>
      ` : ''}
    </div>`
  }
}

function volverAPedidos() {
  pedidoActualId = null
  mostrarVistaPedidos('lista')
  cargarPedidos()
}

async function cargarDocumentosPedido(pedidoId) {
  const { data: docs } = await db.from('documentos_pedido')
    .select('*, perfiles(nombre_completo)')
    .eq('pedido_id', pedidoId).order('created_at', { ascending: false })
  const el = document.getElementById('lista-documentos-pedido')
  if (!docs || docs.length === 0) { el.innerHTML = '<p class="vacio">Sin documentos subidos</p>'; return }
  el.innerHTML = docs.map(d => `
    <div class="doc-item">
      <div class="doc-info">
        <span class="doc-tipo">${labelTipoDoc(d.tipo)}</span>
        ${badgeVerificacion(d.verificacion)}
        ${d.nota ? `<span class="doc-nota">📝 ${d.nota}</span>` : ''}
        <span class="doc-quien">Subido por ${d.perfiles?.nombre_completo || '-'} — ${formatFechaHora(d.created_at)}</span>
      </div>
      <div class="doc-acciones">
        <a href="${d.archivo_url}" target="_blank" class="btn-ver">👁️ Ver</a>
      </div>
    </div>`).join('')
}

async function cargarProductosPedido(pedidoId) {
  const { data: items } = await db.from('pedido_items')
    .select('*, productos(descripcion, codigo, unidad)')
    .eq('pedido_id', pedidoId)
  const el = document.getElementById('productos-pedido')
  if (!items || items.length === 0) { el.innerHTML = '<p class="vacio">Sin productos</p>'; return }
  el.innerHTML = `<table class="tabla">
    <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
    <tbody>
      ${items.map(i => `<tr>
        <td><b>${i.productos?.descripcion || '-'}</b><br><small>${i.productos?.codigo || ''}</small></td>
        <td>${i.cantidad} ${i.productos?.unidad || ''}</td>
        <td>$${Number(i.precio_unitario).toLocaleString('es-AR')}</td>
        <td><b>$${Number(i.subtotal).toLocaleString('es-AR')}</b></td>
      </tr>`).join('')}
    </tbody></table>`
}

async function cargarCobrosPedido(pedidoId) {
  const { data: pedido } = await db.from('pedidos').select('total, monto_cobrado, estado_cobro').eq('id', pedidoId).single()
  const { data: cobros } = await db.from('cobros').select('*').eq('pedido_id', pedidoId).order('created_at')
  const total = Number(pedido?.total || 0)
  const cobrado = Number(pedido?.monto_cobrado || 0)
  const pendiente = total - cobrado
  const pct = total > 0 ? Math.min((cobrado / total) * 100, 100) : 0
  document.getElementById('resumen-cobro').innerHTML = `
    <div class="cobro-resumen">
      <div class="cobro-barra-wrap">
        <div class="cobro-barra"><div class="cobro-barra-fill" style="width:${pct}%"></div></div>
        <span>${Math.round(pct)}%</span>
      </div>
      <div class="cobro-numeros">
        <span>Total: <b>$${total.toLocaleString('es-AR')}</b></span>
        <span>Cobrado: <b class="verde">$${cobrado.toLocaleString('es-AR')}</b></span>
        <span>Pendiente: <b class="${pendiente > 0 ? 'rojo' : 'verde'}">$${pendiente.toLocaleString('es-AR')}</b></span>
      </div>
    </div>`
  const listEl = document.getElementById('lista-cobros-pedido')
  if (!cobros || cobros.length === 0) { listEl.innerHTML = '<p class="vacio">Sin cobros registrados</p>'; return }
  listEl.innerHTML = cobros.map(c => `
    <div class="cobro-item">
      <div class="cobro-item-info">
        <span class="cobro-medio">${iconMedio(c.medio_pago)} ${labelMedio(c.medio_pago)}</span>
        <span class="cobro-monto">$${Number(c.monto).toLocaleString('es-AR')}</span>
        ${c.fecha_vencimiento_cheque ? `<span class="cobro-cheque-fecha">📅 Cheque vence: ${formatFecha(c.fecha_vencimiento_cheque)}</span>` : ''}
        ${c.nota ? `<span class="cobro-nota">📝 ${c.nota}</span>` : ''}
        <span class="cobro-fecha">${formatFechaHora(c.created_at)}</span>
      </div>
      ${c.foto_url ? `<a href="${c.foto_url}" target="_blank" class="btn-ver">📷 Ver</a>` : ''}
    </div>`).join('')
}

async function cargarHistorialPedido(pedidoId) {
  const { data: historial } = await db.from('historial_pedido')
    .select('*, perfiles(nombre_completo)')
    .eq('pedido_id', pedidoId).order('created_at', { ascending: false })
  const el = document.getElementById('historial-pedido')
  if (!historial || historial.length === 0) { el.innerHTML = '<p class="vacio">Sin actividad</p>'; return }
  el.innerHTML = historial.map(h => `
    <div class="historial-item">
      <div class="historial-icono">${iconAccion(h.accion)}</div>
      <div class="historial-info">
        <span class="historial-detalle">${h.detalle}</span>
        <span class="historial-quien">${h.perfiles?.nombre_completo || 'Sistema'} — ${formatFechaHora(h.created_at)}</span>
      </div>
    </div>`).join('')
}

async function registrarHistorial(pedidoId, accion, detalle) {
  await db.from('historial_pedido').insert({ pedido_id: pedidoId, usuario_id: usuarioActual?.id, accion, detalle })
}

function abrirSubirDocumento() { document.getElementById('form-subir-documento').style.display = 'block' }
function cancelarSubirDocumento() { document.getElementById('form-subir-documento').style.display = 'none' }

async function subirDocumento() {
  const tipo    = document.getElementById('tipo-documento').value
  const archivo = document.getElementById('archivo-documento').files[0]
  const nota    = document.getElementById('nota-documento').value.trim()
  if (!archivo) { alert('Seleccioná un archivo'); return }
  const ext = archivo.name.split('.').pop()
  const nombre = `${pedidoActualId}/${tipo}_${Date.now()}.${ext}`
  const { error: uploadError } = await db.storage.from('documentos').upload(nombre, archivo, { upsert: true })
  if (uploadError) { alert('Error al subir: ' + uploadError.message); return }
  const { data: urlData } = db.storage.from('documentos').getPublicUrl(nombre)
  await db.from('documentos_pedido').insert({
    pedido_id: pedidoActualId, tipo, archivo_url: urlData.publicUrl,
    archivo_tipo: archivo.type === 'application/pdf' ? 'pdf' : 'imagen',
    nota: nota || null, subido_por: usuarioActual.id, verificacion: 'pendiente'
  })
  await registrarHistorial(pedidoActualId, 'documento_subido', `Se subió ${labelTipoDoc(tipo)}`)
  cancelarSubirDocumento()
  await abrirPedido(pedidoActualId)
}

function abrirAgregarCobro() {
  document.getElementById('form-agregar-cobro').style.display = 'block'
  document.getElementById('cobro-medio').onchange = function() {
    const es = this.value === 'cheque' || this.value === 'echeq'
    document.getElementById('campo-fecha-cheque').style.display = es ? 'block' : 'none'
  }
}
function cancelarAgregarCobro() { document.getElementById('form-agregar-cobro').style.display = 'none' }

async function guardarCobro() {
  const medio  = document.getElementById('cobro-medio').value
  const monto  = parseFloat(document.getElementById('cobro-monto').value)
  const nota   = document.getElementById('cobro-nota').value.trim()
  const foto   = document.getElementById('cobro-foto').files[0]
  const fechaCheque = document.getElementById('cobro-fecha-cheque').value
  if (!monto || monto <= 0) { alert('Ingresá un monto válido'); return }
  const { data: pedido } = await db.from('pedidos').select('total, monto_cobrado').eq('id', pedidoActualId).single()
  const pendiente = Number(pedido.total) - Number(pedido.monto_cobrado)
  if (monto > pendiente + 0.01) { alert('El monto supera el saldo pendiente'); return }
  let fotoUrl = null
  if (foto) {
    const ext = foto.name.split('.').pop()
    const path = `${pedidoActualId}/${medio}_${Date.now()}.${ext}`
    const { error: upErr } = await db.storage.from('comprobantes').upload(path, foto, { upsert: true })
    if (!upErr) { const { data: ud } = db.storage.from('comprobantes').getPublicUrl(path); fotoUrl = ud.publicUrl }
  }
  const { data: cobrosAnt } = await db.from('cobros').select('medio_pago').eq('pedido_id', pedidoActualId)
  const hayOtroMedio = cobrosAnt?.some(c => c.medio_pago !== medio)
  const nuevoMonto = Number(pedido.monto_cobrado) + monto
  const nuevoPendiente = Number(pedido.total) - nuevoMonto
  const pagoCompleto = nuevoPendiente <= 0.01
  const estadoMap = { efectivo:'cobrado_efectivo', transferencia:'cobrado_transferencia', cheque:'cobrado_cheque', echeq:'cobrado_cheque' }
  const nuevoEstado = pagoCompleto ? (estadoMap[medio] || 'cobrado_efectivo') : 'pendiente'
  const { error } = await db.from('cobros').insert({
    pedido_id: pedidoActualId, vendedor_id: usuarioActual.id,
    estado: nuevoEstado, monto, medio_pago: medio,
    foto_url: fotoUrl, nota: nota || null,
    fecha_vencimiento_cheque: fechaCheque || null
  })
  if (error) { alert('Error: ' + error.message); return }
  const updateData = { monto_cobrado: nuevoMonto, estado_cobro: nuevoEstado }
  if (pagoCompleto) updateData.etapa = 'cobrado'
  await db.from('pedidos').update(updateData).eq('id', pedidoActualId)
  await registrarHistorial(pedidoActualId, 'cobro_registrado', `${labelMedio(medio)} por $${monto.toLocaleString('es-AR')}`)
  cancelarAgregarCobro()
  document.getElementById('cobro-monto').value = ''
  document.getElementById('cobro-nota').value = ''
  document.getElementById('cobro-foto').value = ''
  await abrirPedido(pedidoActualId)
}


// ================================================
// KANBAN DE PEDIDOS
// ================================================

const ETAPAS_KANBAN = [
  { id: 'pedido',    label: 'Pedido',    icono: 'ti-package',      color: '#888780', bg: 'var(--color-background-secondary)' },
  { id: 'facturado', label: 'Facturado', icono: 'ti-file-invoice', color: '#378add', bg: '#e3f2fd' },
  { id: 'enviado',   label: 'Enviado',   icono: 'ti-truck',        color: '#1d9e75', bg: '#e8f5e9' },
  { id: 'recibido',  label: 'Recibido',  icono: 'ti-hand-stop',    color: '#ba7517', bg: '#fff8e1' },
  { id: 'cobrado',   label: 'Cobrado',   icono: 'ti-circle-check', color: '#1d9e75', bg: '#e8f5e9' },
]

// Cliente seleccionado en el filtro del kanban
let _filtroClienteId   = null
let _filtroClienteNombre = null
let _filtroClientesCache = []

async function cargarPedidos() {
  const fechaDesde = document.getElementById('filtro-fecha-desde')?.value || ''
  const fechaHasta = document.getElementById('filtro-fecha-hasta')?.value || ''

  let query = db.from('pedidos')
    .select('id, numero, total, estado, etapa, estado_cobro, alerta_vencimiento, fecha_vencimiento_cobro, fecha_pedido, created_at, updated_at, clientes(razon_social)')
    .not('etapa', 'eq', 'cancelado')
    .order('created_at', { ascending: false })
    .limit(200)

  if (_filtroClienteId) query = query.eq('cliente_id', _filtroClienteId)
  if (fechaDesde) query = query.gte('fecha_pedido', fechaDesde)
  if (fechaHasta) query = query.lte('fecha_pedido', fechaHasta + 'T23:59:59')

  const { data: todos } = await query
  const pedidos = todos

  renderKanban(pedidos || [])
}

function renderKanban(pedidos) {
  const contenedor = document.getElementById('kanban-board')
  if (!contenedor) return

  // Agrupar por etapa
  const grupos = {}
  ETAPAS_KANBAN.forEach(e => grupos[e.id] = [])
  pedidos.forEach(p => {
    const etapa = p.etapa || 'pedido'
    if (grupos[etapa] !== undefined) grupos[etapa].push(p)
    else grupos['pedido'].push(p)
  })

  contenedor.innerHTML = ETAPAS_KANBAN.map(etapa => `
    <div class="kanban-col">
      <div class="kanban-col-header" style="background:${etapa.bg}">
        <i class="ti ${etapa.icono}" style="font-size:14px; color:${etapa.color};" aria-hidden="true"></i>
        <span style="color:${etapa.color}">${etapa.label}</span>
        <span class="kanban-count" style="background:${etapa.color}20; color:${etapa.color}">${grupos[etapa.id].length}</span>
      </div>
      <div class="kanban-cards">
        ${grupos[etapa.id].length === 0
          ? `<div class="kanban-empty">
               <i class="ti ti-inbox" aria-hidden="true"></i>
               <span>Sin pedidos</span>
             </div>`
          : grupos[etapa.id].map(p => renderKanbanCard(p, etapa)).join('')
        }
      </div>
    </div>
  `).join('')
}

function renderKanbanCard(p, etapa) {
  const esCobrado = etapa.id === 'cobrado'
  return `
    <div class="kanban-card" style="border-left:3px solid ${etapa.color}"
         onclick="abrirPedido('${p.id}')">
      <div class="kanban-card-num">#${p.numero} · ${p.clientes?.razon_social || '-'}</div>
      <div class="kanban-card-total">$${Number(p.total).toLocaleString('es-AR')}</div>
      <div class="kanban-card-fecha">
        <i class="ti ti-calendar" style="font-size:10px" aria-hidden="true"></i>
        ${formatFechaHora(p.created_at)}
      </div>
      ${p.alerta_vencimiento ? `<div class="kanban-alerta">⚠️ Vence pronto</div>` : ''}
      ${esCobrado ? `
        <button class="kanban-pdf-btn" onclick="event.stopPropagation(); descargarPDF('${p.id}')">
          <i class="ti ti-file-download" aria-hidden="true"></i> PDF
        </button>` : ''}
    </div>`
}


// ── DROPDOWN CLIENTE EN PEDIDO ───────────────────
let _clientesPedidoCache = []

async function cargarListaClientesPedido() {
  const { data: clientes } = await db.from('clientes')
    .select('id, razon_social, descuento_pct, bonificacion_pct, condicion_factura, pct_remito, pct_factura, alicuota_iva, bloqueado, saldo_pendiente, activo')
    .eq('activo', true).order('razon_social')
  _clientesPedidoCache = clientes || []
  renderListaClientesPedido(_clientesPedidoCache)
}

async function mostrarDropdownClientes() {
  const el = document.getElementById('resultados-cliente-pedido')
  if (!el) return
  el.style.display = 'block'
  if (_clientesPedidoCache.length === 0) {
    el.innerHTML = '<p style="padding:12px;color:#888;font-size:13px">Cargando...</p>'
    await cargarListaClientesPedido()
  } else {
    renderListaClientesPedido(_clientesPedidoCache)
  }
}

function ocultarDropdownClientes() {
  setTimeout(() => {
    const el = document.getElementById('resultados-cliente-pedido')
    if (el) el.style.display = 'none'
  }, 250)
}

function filtrarListaClientes() {
  const q = document.getElementById('buscar-cliente-pedido')?.value?.toLowerCase() || ''
  const filtrados = q.length === 0 ? _clientesPedidoCache
    : _clientesPedidoCache.filter(c => c.razon_social.toLowerCase().includes(q))
  renderListaClientesPedido(filtrados)
  const el = document.getElementById('resultados-cliente-pedido')
  if (el) el.style.display = 'block'
}

function renderListaClientesPedido(clientes) {
  const el = document.getElementById('resultados-cliente-pedido')
  if (!el) return
  if (!clientes || clientes.length === 0) {
    el.innerHTML = '<p style="padding:12px;color:#888;font-size:13px">No hay clientes</p>'
    return
  }
  el.innerHTML = clientes.map(c => `
    <div onclick="seleccionarClientePedido('${c.id}')"
      style="padding:12px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer;display:flex;justify-content:space-between;align-items:center;"
      onmouseover="this.style.background='#f0f7f4'" onmouseout="this.style.background='white'">
      <div>
        <div style="font-size:14px;font-weight:bold;color:#1a1a1a">${c.razon_social}</div>
        <div style="display:flex;gap:6px;margin-top:3px;flex-wrap:wrap">
          ${c.bloqueado ? '<span style="background:#fee;color:#c00;font-size:11px;padding:1px 7px;border-radius:20px;font-weight:500">⚠️ Deuda</span>' : ''}
          ${c.descuento_pct > 0 ? `<span style="background:#e8f5e9;color:#2d6a4f;font-size:11px;padding:1px 7px;border-radius:20px;font-weight:500">Desc. ${c.descuento_pct}%</span>` : ''}
          ${c.bonificacion_pct > 0 ? `<span style="background:#e3f2fd;color:#1565c0;font-size:11px;padding:1px 7px;border-radius:20px;font-weight:500">Bonif. ${c.bonificacion_pct}%</span>` : ''}
        </div>
      </div>
      <span style="color:#ccc;font-size:20px">›</span>
    </div>`).join('')
}

async function seleccionarClientePedido(id) {
  const { data: c } = await db.from('clientes').select('*').eq('id', id).single()
  pedidoActual.cliente = c
  _clientesPedidoCache = []
  await renderizarFormPedido()
}

function cambiarCliente() {
  pedidoActual.cliente = null
  pedidoActual.items = {}
  _clientesPedidoCache = []
  renderizarFormPedido()
}

async function buscarClientePedido() {
  filtrarListaClientes()
}



// ── FILTRO CLIENTE KANBAN ────────────────────────
async function toggleFiltroClientes() {
  const dropdown = document.getElementById('filtro-cliente-dropdown')
  if (!dropdown) return
  const visible = dropdown.style.display !== 'none'
  if (visible) {
    dropdown.style.display = 'none'
    return
  }
  dropdown.style.display = 'block'
  if (_filtroClientesCache.length === 0) {
    document.getElementById('filtro-cliente-lista').innerHTML =
      '<p style="padding:12px;color:#888;font-size:13px">Cargando...</p>'
    const { data } = await db.from('clientes').select('id, razon_social').eq('activo', true).order('razon_social')
    _filtroClientesCache = data || []
  }
  renderFiltroClientes(_filtroClientesCache)
  // Foco en el buscador
  setTimeout(() => document.getElementById('filtro-cliente-buscar')?.focus(), 100)
  // Cerrar al clickear afuera
  setTimeout(() => {
    document.addEventListener('click', cerrarFiltroClientesAfuera, { once: true })
  }, 100)
}

function cerrarFiltroClientesAfuera(e) {
  const dropdown = document.getElementById('filtro-cliente-dropdown')
  const display  = document.getElementById('filtro-cliente-display')
  if (dropdown && !dropdown.contains(e.target) && !display?.contains(e.target)) {
    dropdown.style.display = 'none'
  }
}

function filtrarDropdownClientes() {
  const q = document.getElementById('filtro-cliente-buscar')?.value?.toLowerCase() || ''
  const filtrados = q ? _filtroClientesCache.filter(c => c.razon_social.toLowerCase().includes(q)) : _filtroClientesCache
  renderFiltroClientes(filtrados)
}

function renderFiltroClientes(clientes) {
  const el = document.getElementById('filtro-cliente-lista')
  if (!el) return
  const html = [
    `<div onclick="seleccionarFiltroCliente(null, 'Todos los clientes')"
      style="padding:10px 16px;cursor:pointer;font-size:13px;color:#888;border-bottom:1px solid #f0f0f0;"
      onmouseover="this.style.background='#f9f9f9'" onmouseout="this.style.background='white'">
      🔍 Todos los clientes
    </div>`,
    ...clientes.map(c => `
      <div onclick="seleccionarFiltroCliente('${c.id}', '${c.razon_social.replace(/'/g, "\'")}')"
        style="padding:10px 16px;cursor:pointer;font-size:14px;font-weight:500;border-bottom:1px solid #f0f0f0;"
        onmouseover="this.style.background='#f0f7f4'" onmouseout="this.style.background='white'">
        ${c.razon_social}
      </div>`)
  ].join('')
  el.innerHTML = html
}

function seleccionarFiltroCliente(id, nombre) {
  _filtroClienteId    = id
  _filtroClienteNombre = nombre
  const label = document.getElementById('filtro-cliente-label')
  if (label) {
    label.textContent = id ? nombre : '🔍 Todos los clientes'
    label.style.color = id ? '#1a1a1a' : '#888'
  }
  document.getElementById('filtro-cliente-dropdown').style.display = 'none'
  cargarPedidos()
}


function limpiarFiltrosPedidos() {
  _filtroClienteId    = null
  _filtroClienteNombre = null
  const label = document.getElementById('filtro-cliente-label')
  if (label) { label.textContent = '🔍 Todos los clientes'; label.style.color = '#888' }
  const d = document.getElementById('filtro-fecha-desde')
  const h = document.getElementById('filtro-fecha-hasta')
  if (d) d.value = ''
  if (h) h.value = ''
  cargarPedidos()
}

// ── MARCAR ENVIADO ───────────────────────────────
async function marcarEnviado(pedidoId) {
  const ok = confirm('¿Confirmás que la mercadería fue enviada?')
  if (!ok) return
  const { error } = await db.from('pedidos').update({
    etapa:         'enviado',
    fecha_enviado: new Date().toISOString(),
    enviado_por:   usuarioActual.id,
    updated_at:    new Date().toISOString()
  }).eq('id', pedidoId)
  if (error) { alert('Error: ' + error.message); return }
  await registrarHistorial(pedidoId, 'estado_cambiado', 'Pedido marcado como enviado')
  await abrirPedido(pedidoId)
}

// ── MARCAR RECIBIDO ──────────────────────────────
async function marcarRecibido(pedidoId) {
  const ok = confirm('¿Confirmás que recibiste la mercadería?')
  if (!ok) return
  const { error } = await db.from('pedidos').update({
    etapa:          'recibido',
    fecha_recibido: new Date().toISOString(),
    recibido_por:   'Cliente',
    updated_at:     new Date().toISOString()
  }).eq('id', pedidoId)
  if (error) { alert('Error: ' + error.message); return }
  await registrarHistorial(pedidoId, 'estado_cambiado', 'Recepción confirmada por el cliente')
  await abrirPedido(pedidoId)
}

// ── GENERAR PDF ──────────────────────────────────
async function descargarPDF(pedidoId) {
  const { data: p } = await db.from('pedidos')
    .select('*, clientes(*)')
    .eq('id', pedidoId).single()
  const { data: items } = await db.from('pedido_items')
    .select('*, productos(descripcion, unidad)')
    .eq('pedido_id', pedidoId)
  const { data: cobros } = await db.from('cobros')
    .select('*').eq('pedido_id', pedidoId)
  const { data: historial } = await db.from('historial_pedido')
    .select('*').eq('pedido_id', pedidoId).order('created_at')

  const html = generarHTMLPDF(p, items, cobros, historial)
  const ventana = window.open('', '_blank')
  ventana.document.write(html)
  ventana.document.close()
  ventana.print()
}

function generarHTMLPDF(p, items, cobros, historial) {
  const cliente = p.clientes
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Pedido #${p.numero} — La Cabaña</title>
  <style>
    body { font-family: Arial, sans-serif; color: #1a1a1a; padding: 24px; max-width: 700px; margin: 0 auto; }
    h1 { font-size: 22px; color: #1a3a2a; margin-bottom: 4px; }
    .subtitulo { color: #888; font-size: 13px; margin-bottom: 24px; }
    .seccion { margin-bottom: 20px; }
    .seccion-titulo { font-size: 11px; font-weight: bold; color: #2d6a4f; letter-spacing: 1px; text-transform: uppercase; border-bottom: 2px solid #e8f5e9; padding-bottom: 6px; margin-bottom: 10px; }
    .fila { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
    .fila span:first-child { color: #888; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f8f8f8; padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
    td { padding: 8px; border-bottom: 1px solid #f5f5f5; }
    .total-row { font-weight: bold; font-size: 16px; }
    .timeline-item { display: flex; gap: 12px; padding: 8px 0; font-size: 13px; }
    .timeline-icono { color: #2d6a4f; font-size: 16px; width: 20px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>🥛 La Cabaña — Pedido #${p.numero}</h1>
  <p class="subtitulo">Generado el ${new Date().toLocaleString('es-AR')}</p>

  <div class="seccion">
    <div class="seccion-titulo">Datos del cliente</div>
    <div class="fila"><span>Cliente</span><span>${cliente?.razon_social || '-'}</span></div>
    <div class="fila"><span>CUIT</span><span>${cliente?.cuit || '-'}</span></div>
    <div class="fila"><span>Condición IVA</span><span>${cliente?.condicion_iva?.replace(/_/g,' ') || '-'}</span></div>
    <div class="fila"><span>Facturación</span><span>${labelFacturacion(cliente?.condicion_factura, cliente?.pct_remito, cliente?.pct_factura)}</span></div>
  </div>

  <div class="seccion">
    <div class="seccion-titulo">Productos</div>
    <table>
      <thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
      <tbody>
        ${items?.map(i => `<tr>
          <td>${i.productos?.descripcion || '-'}</td>
          <td>${i.cantidad} ${i.productos?.unidad || ''}</td>
          <td>$${Number(i.precio_unitario).toLocaleString('es-AR')}</td>
          <td>$${Number(i.subtotal).toLocaleString('es-AR')}</td>
        </tr>`).join('') || '<tr><td colspan="4">Sin items</td></tr>'}
        <tr class="total-row">
          <td colspan="3">TOTAL</td>
          <td>$${Number(p.total).toLocaleString('es-AR')}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="seccion">
    <div class="seccion-titulo">Cobros recibidos</div>
    ${cobros?.map(c => `
      <div class="fila">
        <span>${labelMedio(c.medio_pago)}</span>
        <span>$${Number(c.monto).toLocaleString('es-AR')} · ${formatFechaHora(c.created_at)}</span>
      </div>`).join('') || '<p style="color:#888; font-size:13px">Sin cobros registrados</p>'}
  </div>

  <div class="seccion">
    <div class="seccion-titulo">Línea de tiempo</div>
    ${historial?.map(h => `
      <div class="timeline-item">
        <span class="timeline-icono">${iconAccion(h.accion)}</span>
        <div>
          <div>${h.detalle}</div>
          <div style="color:#888; font-size:11px">${formatFechaHora(h.created_at)}</div>
        </div>
      </div>`).join('') || '<p style="color:#888; font-size:13px">Sin historial</p>'}
  </div>
</body>
</html>`
}


// ================================================
// LA CABAÑA — Módulo de Creación de Pedidos
// Agregar al final de app.js
// ================================================

let pedidoActual = {
  cliente: null,
  items: {},      // { producto_id: { producto, cantidad, unidad_venta } }
  borrador_id: null
}

// ── ABRIR FORMULARIO DE PEDIDO ───────────────────
async function nuevoPedido() {
  const rol = await cargarRolUsuario()
  pedidoActual = { cliente: null, items: {}, borrador_id: null }

  // Si es cliente, cargar su ficha automáticamente
  if (rol === 'cliente') {
    const { data: perfil } = await db.from('perfiles')
      .select('cliente_id, clientes(*)')
      .eq('id', usuarioActual.id).single()
    if (perfil?.clientes) {
      pedidoActual.cliente = perfil.clientes
    }
  }

  mostrarVistaPedidos('nuevo')
  await renderizarFormPedido()
}

async function renderizarFormPedido() {
  const rol = await cargarRolUsuario()
  const el  = document.getElementById('contenido-nuevo-pedido')

  // Selector de cliente (solo para vendedor/admin)
  const selectorCliente = rol !== 'cliente' ? `
    <div class="pedido-selector-cliente">
      <div class="form-seccion">CLIENTE</div>
      ${pedidoActual.cliente
        ? `<div class="cliente-seleccionado">
            <span>${pedidoActual.cliente.razon_social}</span>
            <button class="btn-cambiar" onclick="cambiarCliente()">Cambiar</button>
           </div>`
        : `<div class="buscador-box" style="position:relative">
            <input type="search" id="buscar-cliente-pedido"
              placeholder="▼ Tocá para ver clientes..."
              oninput="filtrarListaClientes()"
              onclick="mostrarDropdownClientes()"
              onfocus="mostrarDropdownClientes()"
              onblur="ocultarDropdownClientes()"
              autocomplete="new-password"
              autocorrect="off"
              spellcheck="false"
              class="buscador-input"
              style="cursor:pointer">
            <div id="resultados-cliente-pedido"
              style="display:none;position:absolute;top:calc(100% + 4px);left:0;right:0;
                z-index:999;background:white;border:1px solid #ddd;border-radius:10px;
                box-shadow:0 8px 24px rgba(0,0,0,0.2);max-height:300px;overflow-y:auto;">
            </div>
           </div>`
      }
      ${pedidoActual.cliente ? renderCondicionesCliente() : ''}
    </div>` : renderCondicionesCliente()

  el.innerHTML = `
    ${selectorCliente}
    <div class="form-seccion" style="margin-top:20px">PRODUCTOS</div>
    <div class="tabs-categorias" id="tabs-cats"></div>
    <div id="catalogo-pedido"></div>
  `

  await cargarCatalogoPedido()
  actualizarBarraTotal()
}

function renderCondicionesCliente() {
  const c = pedidoActual.cliente
  if (!c) return ''
  return `
    <div class="condiciones-cliente">
      ${c.descuento_pct > 0 ? `<span class="badge badge-verde">Descuento ${c.descuento_pct}%</span>` : ''}
      ${c.bonificacion_pct > 0 ? `<span class="badge badge-azul">Bonif. ${c.bonificacion_pct}%</span>` : ''}
      <span class="badge badge-gris">${labelFacturacion(c.condicion_factura, c.pct_remito, c.pct_factura)}</span>
      <span class="badge badge-gris">IVA ${c.alicuota_iva}%</span>
      ${c.bloqueado ? `<span class="badge badge-rojo">⚠️ BLOQUEADO</span>` : ''}
    </div>
    ${c.bloqueado ? `<div class="alerta-box">⚠️ Este cliente tiene deuda vencida de $${Number(c.saldo_pendiente).toLocaleString('es-AR')}. Podés continuar igual.</div>` : ''}
  `
}

async function buscarClientePedido() {
  const q = document.getElementById('buscar-cliente-pedido').value.toLowerCase()
  if (q.length < 2) { document.getElementById('resultados-cliente-pedido').innerHTML = ''; return }

  const { data: clientes } = await db.from('clientes')
    .select('id, razon_social, descuento_pct, bonificacion_pct, condicion_factura, pct_remito, pct_factura, alicuota_iva, bloqueado, saldo_pendiente, activo')
    .ilike('razon_social', `%${q}%`).eq('activo', true).limit(8)

  document.getElementById('resultados-cliente-pedido').innerHTML = clientes?.map(c => `
    <div class="resultado-cliente" onclick="seleccionarClientePedido('${c.id}')">
      <span>${c.razon_social}</span>
      ${c.bloqueado ? '<span class="badge badge-rojo">⚠️</span>' : ''}
      ${c.descuento_pct > 0 ? `<span class="badge badge-verde">${c.descuento_pct}%</span>` : ''}
    </div>`).join('') || '<p class="vacio">No encontrado</p>'
}

async function seleccionarClientePedido(id) {
  const { data: c } = await db.from('clientes').select('*').eq('id', id).single()
  pedidoActual.cliente = c
  await renderizarFormPedido()
}

function cambiarCliente() {
  pedidoActual.cliente = null
  pedidoActual.items   = {}
  renderizarFormPedido()
}

// ── CATÁLOGO DE PRODUCTOS ────────────────────────
async function cargarCatalogoPedido() {
  const { data: cats }  = await db.from('categorias').select('*').order('orden')
  const { data: prods } = await db.from('productos')
    .select('*, categorias(nombre)').eq('activo', true).order('descripcion')

  if (!prods) return

  // Tabs de categorías
  const tabsEl = document.getElementById('tabs-cats')
  tabsEl.innerHTML = `
    <button class="tab-cat activo" onclick="filtrarCatPedido('todos', this)">Todos</button>
    ${cats?.map(c => `<button class="tab-cat" onclick="filtrarCatPedido('${c.id}', this)">${c.nombre}</button>`).join('')}
  `

  // Guardar productos para filtrar
  window._productosPedido = prods
  renderCatalogoPedido(prods)
}

function filtrarCatPedido(catId, btn) {
  document.querySelectorAll('.tab-cat').forEach(b => b.classList.remove('activo'))
  btn.classList.add('activo')
  const prods = catId === 'todos'
    ? window._productosPedido
    : window._productosPedido.filter(p => p.categoria_id === catId)
  renderCatalogoPedido(prods)
}

function renderCatalogoPedido(prods) {
  const descuento = pedidoActual.cliente?.descuento_pct || 0
  const el = document.getElementById('catalogo-pedido')

  el.innerHTML = prods.map(p => {
    const esPorKg    = p.tipo_precio === 'por_kg'
    const tieneCaja  = p.unidades_por_caja > 1 || esPorKg
    const precioBase = esPorKg ? p.precio_caja : p.precio_1
    const precioDesc = precioBase * (1 - descuento / 100)
    const item       = pedidoActual.items[p.id]
    const cantCaja   = item?.cantidad_caja || 0
    const cantUnidad = item?.cantidad_unidad || 0

    return `
      <div class="producto-pedido-card" id="card-${p.id}">
        <div class="prod-pedido-info">
          <div class="prod-pedido-nombre">${p.descripcion}</div>
          <div class="prod-pedido-precios">
            ${esPorKg
              ? `<span>$${Number(p.precio_por_kg).toLocaleString('es-AR')}/kg</span>
                 <span class="sep">•</span>
                 <span class="precio-dest">$${Number(precioDesc).toLocaleString('es-AR')}/caja</span>`
              : `<span class="precio-dest">$${Number(precioDesc).toLocaleString('es-AR')}/${p.unidad}</span>
                 ${tieneCaja ? `<span class="sep">•</span><span>$${Number(precioDesc * p.unidades_por_caja).toLocaleString('es-AR')}/caja</span>` : ''}`
            }
            ${descuento > 0 ? `<span class="badge badge-verde">-${descuento}%</span>` : ''}
          </div>
        </div>
        <div class="prod-pedido-controles">
          ${tieneCaja && !esPorKg ? `
            <div class="control-cantidad">
              <span class="control-label">Cajas</span>
              <div class="cantidad-btns">
                <button onclick="cambiarCantidad('${p.id}', 'caja', -1)" class="btn-cant">−</button>
                <input type="number" value="${cantCaja}" min="0"
                  onchange="setCantidad('${p.id}', 'caja', this.value)"
                  class="input-cant">
                <button onclick="cambiarCantidad('${p.id}', 'caja', 1)" class="btn-cant">+</button>
              </div>
            </div>` : ''}
          <div class="control-cantidad">
            <span class="control-label">${esPorKg ? 'Cajas' : p.unidad + 's'}</span>
            <div class="cantidad-btns">
              <button onclick="cambiarCantidad('${p.id}', 'unidad', -1)" class="btn-cant">−</button>
              <input type="number" value="${cantUnidad}" min="0"
                onchange="setCantidad('${p.id}', 'unidad', this.value)"
                class="input-cant">
              <button onclick="cambiarCantidad('${p.id}', 'unidad', 1)" class="btn-cant">+</button>
            </div>
          </div>
        </div>
      </div>`
  }).join('')
}

function cambiarCantidad(prodId, tipo, delta) {
  const prod  = window._productosPedido.find(p => p.id === prodId)
  if (!prod) return
  if (!pedidoActual.items[prodId]) {
    pedidoActual.items[prodId] = { producto: prod, cantidad_caja: 0, cantidad_unidad: 0 }
  }
  const key = tipo === 'caja' ? 'cantidad_caja' : 'cantidad_unidad'
  pedidoActual.items[prodId][key] = Math.max(0, (pedidoActual.items[prodId][key] || 0) + delta)
  if (pedidoActual.items[prodId].cantidad_caja === 0 && pedidoActual.items[prodId].cantidad_unidad === 0) {
    delete pedidoActual.items[prodId]
  }
  // Actualizar input en pantalla
  const card = document.getElementById(`card-${prodId}`)
  if (card) {
    const inputs = card.querySelectorAll('.input-cant')
    if (tipo === 'caja' && inputs[0]) inputs[0].value = pedidoActual.items[prodId]?.cantidad_caja || 0
    if (tipo === 'unidad') {
      const lastInput = inputs[inputs.length - 1]
      if (lastInput) lastInput.value = pedidoActual.items[prodId]?.cantidad_unidad || 0
    }
  }
  actualizarBarraTotal()
}

function setCantidad(prodId, tipo, valor) {
  const prod = window._productosPedido.find(p => p.id === prodId)
  if (!prod) return
  if (!pedidoActual.items[prodId]) {
    pedidoActual.items[prodId] = { producto: prod, cantidad_caja: 0, cantidad_unidad: 0 }
  }
  const key = tipo === 'caja' ? 'cantidad_caja' : 'cantidad_unidad'
  pedidoActual.items[prodId][key] = Math.max(0, parseFloat(valor) || 0)
  if (pedidoActual.items[prodId].cantidad_caja === 0 && pedidoActual.items[prodId].cantidad_unidad === 0) {
    delete pedidoActual.items[prodId]
  }
  actualizarBarraTotal()
}

// ── BARRA DE TOTAL FLOTANTE ──────────────────────
function actualizarBarraTotal() {
  const totales = calcularTotales()
  const barra   = document.getElementById('barra-total-pedido')
  if (!barra) return
  const cant = Object.keys(pedidoActual.items).length
  barra.innerHTML = `
    <div class="barra-total-info">
      <span>${cant} producto${cant !== 1 ? 's' : ''}</span>
      <span class="sep">•</span>
      <span>${totales.totalKg.toFixed(1)} kg</span>
      <span class="sep">•</span>
      <span class="barra-monto">$${totales.neto.toLocaleString('es-AR')}</span>
    </div>
    <button class="btn-ver-resumen ${cant === 0 ? 'disabled' : ''}"
      onclick="${cant > 0 ? 'mostrarResumenPedido()' : ''}"
      ${cant === 0 ? 'disabled' : ''}>
      Ver resumen →
    </button>
  `
}

// ── CÁLCULO DE TOTALES ───────────────────────────
function calcularTotales() {
  const cliente   = pedidoActual.cliente
  const descuento = cliente?.descuento_pct || 0
  const bonif     = cliente?.bonificacion_pct || 0
  const iva       = cliente?.alicuota_iva || 21
  const factura   = cliente?.condicion_factura || 'todo_factura'
  const pctRemito = cliente?.pct_remito || 0
  const pctFact   = cliente?.pct_factura || 100

  let subtotal = 0
  let totalKg  = 0
  const lineas = []

  Object.values(pedidoActual.items).forEach(item => {
    const p         = item.producto
    const esPorKg   = p.tipo_precio === 'por_kg'
    const tieneCaja = p.unidades_por_caja > 1 || esPorKg

    // Calcular cantidad total en unidades base
    let cantidadBase = item.cantidad_unidad || 0
    if (tieneCaja && item.cantidad_caja > 0) {
      cantidadBase += item.cantidad_caja * (esPorKg ? 1 : p.unidades_por_caja)
    }
    if (cantidadBase === 0) return

    // Precio base por unidad de venta
    const precioBase = esPorKg ? p.precio_caja : p.precio_1
    const lineaSubtotal = precioBase * cantidadBase

    // Kg
    if (esPorKg) {
      totalKg += item.cantidad_caja * p.kg_por_unidad
      totalKg += (item.cantidad_unidad || 0) * p.kg_por_unidad
    }

    subtotal += lineaSubtotal
    lineas.push({
      descripcion: p.descripcion,
      cantidad: cantidadBase,
      unidad: esPorKg ? 'cajas' : p.unidad + 's',
      precioUnitario: precioBase,
      subtotal: lineaSubtotal,
      kg: esPorKg ? cantidadBase * p.kg_por_unidad : 0
    })
  })

  const descuentoMonto = subtotal * (descuento / 100)
  const neto           = subtotal - descuentoMonto

  // Split remito / factura
  let montoRemito  = 0
  let montoFactura = 0
  let ivaTotal     = 0

  if (factura === 'todo_remito') {
    montoRemito = neto
  } else if (factura === 'todo_factura') {
    montoFactura = neto
    ivaTotal     = neto * (iva / 100)
  } else if (factura === 'mixto') {
    montoRemito  = neto * (pctRemito / 100)
    montoFactura = neto * (pctFact / 100)
    ivaTotal     = montoFactura * (iva / 100)
  }

  const total = neto + ivaTotal

  // Bonificación
  let bonifDetalle = ''
  if (bonif > 0) {
    bonifDetalle = `${bonif}% de mercadería extra`
  }

  return { subtotal, descuentoMonto, neto, montoRemito, montoFactura, ivaTotal, total, totalKg, lineas, bonifDetalle, iva, factura, pctRemito, pctFact }
}

// ── RESUMEN DEL PEDIDO ───────────────────────────
function mostrarResumenPedido() {
  if (!pedidoActual.cliente) { alert('Seleccioná un cliente primero'); return }
  const t  = calcularTotales()
  const el = document.getElementById('contenido-resumen-pedido')

  el.innerHTML = `
    <div class="form-card">
      <div class="form-seccion">CLIENTE</div>
      <div class="ficha-fila"><span>Cliente</span><span>${pedidoActual.cliente.razon_social}</span></div>

      <div class="form-seccion">DETALLE DE PRODUCTOS</div>
      <table class="tabla">
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>
          ${t.lineas.map(l => `<tr>
            <td>${l.descripcion}</td>
            <td>${l.cantidad} ${l.unidad} ${l.kg > 0 ? `<small>(${l.kg.toFixed(1)} kg)</small>` : ''}</td>
            <td>$${Number(l.precioUnitario).toLocaleString('es-AR')}</td>
            <td>$${Number(l.subtotal).toLocaleString('es-AR')}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="form-seccion">RESUMEN FISCAL</div>
      <div class="resumen-fiscal">
        <div class="fiscal-fila"><span>Total kg:</span><span><b>${t.totalKg.toFixed(1)} kg</b></span></div>
        <div class="fiscal-fila"><span>Subtotal sin IVA:</span><span>$${Number(t.subtotal).toLocaleString('es-AR')}</span></div>
        ${t.descuentoMonto > 0 ? `<div class="fiscal-fila descuento-fila"><span>Descuento ${pedidoActual.cliente.descuento_pct}%:</span><span>- $${Number(t.descuentoMonto).toLocaleString('es-AR')}</span></div>` : ''}
        <div class="fiscal-fila"><span>Neto:</span><span>$${Number(t.neto).toLocaleString('es-AR')}</span></div>
        <div class="fiscal-separador"></div>
        ${t.factura === 'mixto' ? `
          <div class="fiscal-fila"><span>Remito (${t.pctRemito}%):</span><span>$${Number(t.montoRemito).toLocaleString('es-AR')}</span></div>
          <div class="fiscal-fila"><span>Factura (${t.pctFact}%):</span><span>$${Number(t.montoFactura).toLocaleString('es-AR')}</span></div>
          <div class="fiscal-fila"><span>IVA ${t.iva}% s/factura:</span><span>$${Number(t.ivaTotal).toLocaleString('es-AR')}</span></div>
        ` : t.factura === 'todo_factura' ? `
          <div class="fiscal-fila"><span>IVA ${t.iva}%:</span><span>$${Number(t.ivaTotal).toLocaleString('es-AR')}</span></div>
        ` : `
          <div class="fiscal-fila"><span>Todo Remito (sin IVA)</span><span></span></div>
        `}
        <div class="fiscal-fila total-fila">
          <span>TOTAL A PAGAR:</span>
          <span>$${Number(t.total).toLocaleString('es-AR')}</span>
        </div>
        ${t.bonifDetalle ? `
          <div class="bonif-box">
            🎁 Bonificación: ${t.bonifDetalle}
          </div>` : ''}
      </div>

      <div class="form-seccion">ENTREGA</div>
      <div class="campo">
        <label>Fecha de entrega</label>
        <input type="date" id="pedido-fecha-entrega" min="${new Date().toISOString().split('T')[0]}">
      </div>
      <div class="campo">
        <label>Observaciones</label>
        <textarea id="pedido-observaciones" rows="2" placeholder="Indicaciones especiales..."></textarea>
      </div>

      <div class="form-botones" style="margin-top:20px">
        <button class="btn-cancelar" onclick="guardarBorrador()">💾 Guardar borrador</button>
        <button class="btn-guardar-inline" onclick="confirmarPedido()">✅ Confirmar pedido</button>
      </div>
    </div>
  `
  mostrarVistaPedidos('resumen')
}

// ── CONFIRMAR PEDIDO ─────────────────────────────
async function confirmarPedido() {
  const rol     = await cargarRolUsuario()
  const t       = calcularTotales()
  const cliente = pedidoActual.cliente
  const fecha   = document.getElementById('pedido-fecha-entrega').value
  const obs     = document.getElementById('pedido-observaciones').value

  if (Object.keys(pedidoActual.items).length === 0) {
    alert('No hay productos en el pedido'); return
  }

  // Estado según quién crea
  const estado = rol === 'cliente' ? 'pendiente_aprobacion' : 'confirmado'

  // Calcular vencimiento
  const diasVenc = cliente.dias_vencimiento || 7
  const fechaVenc = fecha
    ? new Date(new Date(fecha).getTime() + diasVenc * 86400000).toISOString().split('T')[0]
    : new Date(Date.now() + diasVenc * 86400000).toISOString().split('T')[0]

  // Crear pedido
  const { data: pedido, error } = await db.from('pedidos').insert({
    cliente_id:              cliente.id,
    vendedor_id:             rol === 'cliente' ? null : usuarioActual.id,
    estado,
    fecha_entrega:           fecha || null,
    subtotal:                t.subtotal,
    descuento:               t.descuentoMonto,
    iva_total:               t.ivaTotal,
    total:                   t.total,
    condicion_pago:          'contado',
    observaciones:           obs || null,
    fecha_vencimiento_cobro: fechaVenc,
    creado_por_rol:          rol,
    etapa:                   'pedido'
  }).select().single()

  if (error) { alert('Error al guardar: ' + error.message); return }

  // Crear items del pedido
  const itemsParaInsertar = []
  Object.values(pedidoActual.items).forEach(item => {
    const p       = item.producto
    const esPorKg = p.tipo_precio === 'por_kg'
    let cantidad  = item.cantidad_unidad || 0
    if (item.cantidad_caja > 0) {
      cantidad += item.cantidad_caja * (esPorKg ? 1 : p.unidades_por_caja)
    }
    if (cantidad === 0) return

    const descuento = cliente.descuento_pct || 0
    const precio    = esPorKg ? p.precio_caja : p.precio_1

    itemsParaInsertar.push({
      pedido_id:       pedido.id,
      producto_id:     p.id,
      cantidad,
      precio_unitario: precio,
      descuento_pct:   descuento,
      alicuota_iva:    p.alicuota_iva,
      subtotal:        precio * cantidad * (1 - descuento / 100)
    })
  })

  await db.from('pedido_items').insert(itemsParaInsertar)

  // Registrar en historial
  await registrarHistorial(pedido.id, 'pedido_creado',
    `Pedido creado por ${rol} — $${Number(t.total).toLocaleString('es-AR')}`)

  // Borrar borrador si había
  if (pedidoActual.borrador_id) {
    await db.from('pedidos').delete().eq('id', pedidoActual.borrador_id)
  }

  pedidoActual = { cliente: null, items: {}, borrador_id: null }

  if (rol === 'cliente') {
    alert('✅ Pedido enviado. El vendedor lo revisará pronto.')
  } else {
    alert('✅ Pedido confirmado correctamente.')
  }

  mostrarVistaPedidos('lista')
  cargarPedidos()
}

// ── GUARDAR BORRADOR ─────────────────────────────
async function guardarBorrador() {
  if (!pedidoActual.cliente) { alert('Seleccioná un cliente primero'); return }
  const t = calcularTotales()

  const { data: pedido, error } = await db.from('pedidos').insert({
    cliente_id:  pedidoActual.cliente.id,
    vendedor_id: usuarioActual.id,
    estado:      'borrador',
    subtotal:    t.subtotal,
    descuento:   t.descuentoMonto,
    iva_total:   t.ivaTotal,
    total:       t.total,
    etapa:       'pedido',
    observaciones: document.getElementById('pedido-observaciones')?.value || null
  }).select().single()

  if (error) { alert('Error al guardar borrador'); return }

  const itemsParaInsertar = []
  Object.values(pedidoActual.items).forEach(item => {
    const p       = item.producto
    const esPorKg = p.tipo_precio === 'por_kg'
    let cantidad  = item.cantidad_unidad || 0
    if (item.cantidad_caja > 0) cantidad += item.cantidad_caja * (esPorKg ? 1 : p.unidades_por_caja)
    if (cantidad === 0) return
    itemsParaInsertar.push({
      pedido_id: pedido.id, producto_id: p.id, cantidad,
      precio_unitario: esPorKg ? p.precio_caja : p.precio_1,
      descuento_pct: pedidoActual.cliente.descuento_pct || 0,
      alicuota_iva: p.alicuota_iva, subtotal: 0
    })
  })
  if (itemsParaInsertar.length > 0) await db.from('pedido_items').insert(itemsParaInsertar)

  alert('💾 Borrador guardado correctamente')
  mostrarVistaPedidos('lista')
  cargarPedidos()
}

// ── APROBAR / RECHAZAR PEDIDO ────────────────────
async function aprobarPedido(pedidoId) {
  const { error } = await db.from('pedidos').update({
    estado:           'confirmado',
    aprobado_por:     usuarioActual.id,
    fecha_aprobacion: new Date().toISOString()
  }).eq('id', pedidoId)

  if (error) { alert('Error al aprobar'); return }
  await registrarHistorial(pedidoId, 'estado_cambiado', 'Pedido aprobado por el vendedor')
  await cargarCobrosPedido(pedidoId)
  await abrirPedido(pedidoId)
}

async function rechazarPedido(pedidoId) {
  const motivo = prompt('¿Por qué rechazás este pedido?')
  if (!motivo) return

  await db.from('pedidos').update({
    estado:         'rechazado',
    motivo_rechazo: motivo
  }).eq('id', pedidoId)

  await registrarHistorial(pedidoId, 'estado_cambiado', `Pedido rechazado: ${motivo}`)
  await abrirPedido(pedidoId)
}


// ================================================
// LA CABAÑA — Módulo de Cobranza
// ================================================

let _cobFiltroClienteId   = null
let _cobFiltroClienteNombre = null
let _cobFiltroVendedorId  = null
let _cobFiltroVendedorNombre = null
let _cobEstado            = 'todos'
let _cobClientesCache     = []
let _cobVendedoresCache   = []
let _cobroPedidoActualId  = null

// ── CARGAR COBRANZA ──────────────────────────────
async function cargarCobranza() {
  const rol      = await cargarRolUsuario()
  const esAdmin  = rol === 'admin'
  const hoy      = new Date().toISOString().split('T')[0]
  const desde    = document.getElementById('cob-fecha-desde')?.value || ''
  const hasta    = document.getElementById('cob-fecha-hasta')?.value || ''

  // Mostrar/ocultar filtro vendedor según rol
  const vendWrap = document.getElementById('cob-vendedor-wrap')
  if (vendWrap) vendWrap.style.display = esAdmin ? 'block' : 'none'

  // Query pedidos con cobros pendientes o cobrados
  let query = db.from('pedidos')
    .select(`id, numero, total, monto_cobrado, estado_cobro, etapa,
             fecha_vencimiento_cobro, fecha_pedido, vendedor_id,
             clientes(id, razon_social, telefono)`)
    .not('etapa', 'eq', 'cancelado')
    .order('fecha_vencimiento_cobro', { ascending: true, nullsFirst: false })

  if (!esAdmin) query = query.eq('vendedor_id', usuarioActual.id)
  if (_cobFiltroClienteId)  query = query.eq('cliente_id', _cobFiltroClienteId)
  if (_cobFiltroVendedorId) query = query.eq('vendedor_id', _cobFiltroVendedorId)
  if (desde) query = query.gte('fecha_pedido', desde)
  if (hasta) query = query.lte('fecha_pedido', hasta + 'T23:59:59')

  // Filtro por estado
  if (_cobEstado === 'vencido')   query = query.or('estado_cobro.eq.pendiente,estado_cobro.is.null').lt('fecha_vencimiento_cobro', hoy)
  if (_cobEstado === 'pendiente') query = query.or('estado_cobro.eq.pendiente,estado_cobro.is.null')
  if (_cobEstado === 'cobrado')   query = query.not('estado_cobro', 'is', null).not('estado_cobro', 'eq', 'pendiente')

  const { data: pedidos, error: pedErr } = await query
  if (pedErr) { console.error('Cobranza error:', pedErr); return }

  // Calcular stats
  await renderCobStats(pedidos, hoy, esAdmin)

  // Renderizar lista
  renderListaCobranza(pedidos, hoy, esAdmin)
}

// ── STATS ────────────────────────────────────────
async function renderCobStats(pedidos, hoy, esAdmin) {
  const pendientes = pedidos?.filter(p => !p.estado_cobro || p.estado_cobro === 'pendiente') || []
  const cobrados   = pedidos?.filter(p => p.estado_cobro && p.estado_cobro !== 'pendiente') || []
  const vencidos   = pendientes.filter(p => p.fecha_vencimiento_cobro && p.fecha_vencimiento_cobro < hoy)

  const totalPendiente = pendientes.reduce((s, p) => s + (Number(p.total) - Number(p.monto_cobrado)), 0)
  const totalVencido   = vencidos.reduce((s, p) => s + (Number(p.total) - Number(p.monto_cobrado)), 0)

  // Cobrado este mes
  const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0)
  const { data: cobrosDelMes } = await db.from('cobros')
    .select('monto')
    .gte('created_at', inicioMes.toISOString())
    .eq(esAdmin ? 'vendedor_id' : 'vendedor_id', esAdmin ? undefined : usuarioActual.id)

  // Quitar filtro si admin
  let cobMesQuery = db.from('cobros').select('monto').gte('created_at', inicioMes.toISOString())
  if (!esAdmin) cobMesQuery = cobMesQuery.eq('vendedor_id', usuarioActual.id)
  const { data: cobMes } = await cobMesQuery
  const totalCobradoMes = cobMes?.reduce((s, c) => s + Number(c.monto), 0) || 0

  document.getElementById('cob-stats').innerHTML = `
    <div class="cob-stats-grid">
      <div class="cob-stat-card">
        <div class="cob-stat-label">Total pendiente</div>
        <div class="cob-stat-num">${formatMonto(totalPendiente)}</div>
        <div class="cob-stat-sub">${pendientes.length} pedido${pendientes.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="cob-stat-card">
        <div class="cob-stat-label">Cobrado este mes</div>
        <div class="cob-stat-num">${formatMonto(totalCobradoMes)}</div>
        <div class="cob-stat-sub">${cobMes?.length || 0} cobro${(cobMes?.length || 0) !== 1 ? 's' : ''}</div>
      </div>
      <div class="cob-stat-card rojo">
        <div class="cob-stat-label">Total vencido</div>
        <div class="cob-stat-num rojo">${formatMonto(totalVencido)}</div>
        <div class="cob-stat-sub rojo">${vencidos.length} vencido${vencidos.length !== 1 ? 's' : ''}</div>
      </div>
    </div>`
}

// ── LISTA ─────────────────────────────────────────
function renderListaCobranza(pedidos, hoy, esAdmin) {
  const el = document.getElementById('lista-cobranza')
  if (!pedidos || pedidos.length === 0) {
    el.innerHTML = '<p class="vacio">No hay cobros en este período</p>'
    return
  }

  // Separar pendientes y cobrados
  const pendientes = pedidos.filter(p => !p.estado_cobro || p.estado_cobro === 'pendiente')
  const cobrados   = pedidos.filter(p => p.estado_cobro && p.estado_cobro !== 'pendiente')

  let html = ''

  if (pendientes.length > 0) {
    html += `<div class="cob-seccion-titulo">
      <i class="ti ti-clock" aria-hidden="true"></i> Pendientes de cobro
      <span class="cob-seccion-count">${pendientes.length}</span>
    </div>`
    html += pendientes.map(p => renderCobCard(p, hoy, esAdmin)).join('')
  }

  if (cobrados.length > 0) {
    html += `<div class="cob-seccion-titulo" style="margin-top:20px">
      <i class="ti ti-circle-check" aria-hidden="true"></i> Cobrados
      <span class="cob-seccion-count">${cobrados.length}</span>
    </div>`
    html += cobrados.map(p => renderCobCard(p, hoy, esAdmin, true)).join('')
  }

  el.innerHTML = html
}

function renderCobCard(p, hoy, esAdmin, esCobrado = false) {
  const venc     = p.fecha_vencimiento_cobro
  const pendiente = Number(p.total) - Number(p.monto_cobrado)
  const pct      = p.total > 0 ? Math.min((Number(p.monto_cobrado) / Number(p.total)) * 100, 100) : 0

  // Color según urgencia
  let color = '#1d9e75', bgAlerta = '#e1f5ee', textAlerta = '#085041', textoAlerta = ''
  if (!esCobrado && venc) {
    const diasRestantes = Math.ceil((new Date(venc) - new Date(hoy)) / 86400000)
    if (diasRestantes < 0) {
      color = '#e24b4a'; bgAlerta = '#fcebeb'; textAlerta = '#a32d2d'
      textoAlerta = `Vencido hace ${Math.abs(diasRestantes)} día${Math.abs(diasRestantes) !== 1 ? 's' : ''}`
    } else if (diasRestantes <= 3) {
      color = '#ef9f27'; bgAlerta = '#faeeda'; textAlerta = '#633806'
      textoAlerta = `Vence en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}`
    } else if (diasRestantes <= 7) {
      color = '#ba7517'; bgAlerta = '#faeeda'; textAlerta = '#633806'
      textoAlerta = `Vence en ${diasRestantes} días`
    } else {
      textoAlerta = `Vence en ${diasRestantes} días`
    }
  }

  const tel = p.clientes?.telefono?.replace(/\D/g, '') || ''

  return `
    <div class="cob-card ${esCobrado ? 'cob-card-cobrada' : ''}" style="border-left:3px solid ${color};cursor:pointer"
      onclick="abrirDetalleCob('${p.id}')">
      <div class="cob-card-main">
        <div class="cob-card-top">
          <span class="cob-card-cliente">${p.clientes?.razon_social || '-'}</span>
          ${textoAlerta ? `<span class="cob-alerta-badge" style="background:${bgAlerta};color:${textAlerta}">${textoAlerta}</span>` : ''}
          ${esCobrado ? `<span class="cob-alerta-badge" style="background:#e1f5ee;color:#085041"><i class="ti ti-circle-check" aria-hidden="true"></i> Cobrado</span>` : ''}
        </div>
        <div class="cob-card-meta">
          <span>Pedido #${p.numero}</span>
          ${venc ? `<span><i class="ti ti-calendar" style="font-size:12px" aria-hidden="true"></i> Vence: ${formatFecha(venc)}</span>` : ''}
          ${esAdmin && p.vendedor_nombre ? `<span><i class="ti ti-user" style="font-size:12px" aria-hidden="true"></i> ${p.vendedor_nombre}</span>` : ''}
        </div>
        ${Number(p.monto_cobrado) > 0 ? `
          <div class="cob-barra-mini">
            <div class="cob-barra-mini-fill" style="width:${pct}%;background:${color}"></div>
          </div>
          <div class="cob-parcial-info">
            <span>Cobrado: ${formatMonto(Number(p.monto_cobrado))}</span>
            <span style="color:${color}">Pendiente: ${formatMonto(pendiente)}</span>
          </div>` : ''}
      </div>
      <div class="cob-card-right">
        <div class="cob-card-monto" style="color:${esCobrado ? 'var(--color-text-secondary)' : 'var(--color-text-primary)'}">
          ${formatMonto(esCobrado ? Number(p.total) : pendiente)}
        </div>
        <div class="cob-card-acciones">
          ${tel ? `<a href="https://wa.me/54${tel}" target="_blank" class="btn-whatsapp" onclick="event.stopPropagation()">
            <i class="ti ti-brand-whatsapp" aria-hidden="true"></i>
          </a>` : ''}
          ${!esCobrado ? `<button onclick="event.stopPropagation(); abrirModalCobro('${p.id}', '${p.clientes?.razon_social || ''}', ${pendiente})"
            class="btn-cobrar">
            <i class="ti ti-cash" aria-hidden="true"></i> Cobrar
          </button>` : `<button onclick="descargarPDF('${p.id}')" class="btn-secundario" style="font-size:12px;padding:6px 12px">
            <i class="ti ti-file-download" aria-hidden="true"></i> PDF
          </button>`}
        </div>
      </div>
    </div>`
}

// ── MODAL COBRO RÁPIDO ───────────────────────────
function abrirModalCobro(pedidoId, clienteNombre, pendiente) {
  _cobroPedidoActualId = pedidoId
  document.getElementById('modal-cobro-titulo').textContent = 'Registrar cobro'
  document.getElementById('modal-cobro-info').innerHTML = `
    <div style="font-weight:500">${clienteNombre}</div>
    <div style="color:var(--color-text-secondary);margin-top:4px">Pendiente: ${formatMonto(pendiente)}</div>`
  document.getElementById('mc-monto').value = pendiente.toFixed(2)
  document.getElementById('mc-nota').value = ''
  document.getElementById('mc-foto').value = ''
  document.getElementById('mc-error').style.display = 'none'
  document.getElementById('mc-medio').onchange = function() {
    const es = this.value === 'cheque' || this.value === 'echeq'
    document.getElementById('mc-campo-cheque').style.display = es ? 'block' : 'none'
  }
  const modal = document.getElementById('modal-cobro')
  modal.style.display = 'flex'
}

function cerrarModalCobro() {
  document.getElementById('modal-cobro').style.display = 'none'
  _cobroPedidoActualId = null
}

async function guardarCobroRapido() {
  if (!_cobroPedidoActualId) return
  const medio  = document.getElementById('mc-medio').value
  const monto  = parseFloat(document.getElementById('mc-monto').value)
  const nota   = document.getElementById('mc-nota').value.trim()
  const foto   = document.getElementById('mc-foto').files[0]
  const fechaCheque = document.getElementById('mc-fecha-cheque').value

  if (!monto || monto <= 0) {
    document.getElementById('mc-error').textContent = 'Ingresá un monto válido'
    document.getElementById('mc-error').style.display = 'block'
    return
  }

  const { data: pedido } = await db.from('pedidos')
    .select('total, monto_cobrado').eq('id', _cobroPedidoActualId).single()

  const pendiente = Number(pedido.total) - Number(pedido.monto_cobrado)
  if (monto > pendiente + 0.01) {
    document.getElementById('mc-error').textContent = 'El monto supera el saldo pendiente'
    document.getElementById('mc-error').style.display = 'block'
    return
  }

  let fotoUrl = null
  if (foto) {
    const ext = foto.name.split('.').pop()
    const path = `${_cobroPedidoActualId}/${medio}_${Date.now()}.${ext}`
    const { error: upErr } = await db.storage.from('comprobantes').upload(path, foto, { upsert: true })
    if (!upErr) { const { data: ud } = db.storage.from('comprobantes').getPublicUrl(path); fotoUrl = ud.publicUrl }
  }

  const estadoMap = { efectivo:'cobrado_efectivo', transferencia:'cobrado_transferencia', cheque:'cobrado_cheque', echeq:'cobrado_cheque' }
  const nuevoMonto = Number(pedido.monto_cobrado) + monto
  const pagoCompleto = (Number(pedido.total) - nuevoMonto) <= 0.01

  const { error } = await db.from('cobros').insert({
    pedido_id:  _cobroPedidoActualId,
    vendedor_id: usuarioActual.id,
    estado:     estadoMap[medio] || 'cobrado_efectivo',
    monto, medio_pago: medio,
    foto_url: fotoUrl, nota: nota || null,
    fecha_vencimiento_cheque: fechaCheque || null
  })

  if (error) {
    document.getElementById('mc-error').textContent = 'Error: ' + error.message
    document.getElementById('mc-error').style.display = 'block'
    return
  }

  const updateData = { monto_cobrado: nuevoMonto }
  if (pagoCompleto) { updateData.estado_cobro = estadoMap[medio]; updateData.etapa = 'cobrado' }
  await db.from('pedidos').update(updateData).eq('id', _cobroPedidoActualId)
  await registrarHistorial(_cobroPedidoActualId, 'cobro_registrado',
    `${labelMedio(medio)} por ${formatMonto(monto)}`)

  cerrarModalCobro()
  await cargarCobranza()
}

// ── FILTROS COBRANZA ─────────────────────────────
async function toggleCobFiltroClientes() {
  const dropdown = document.getElementById('cob-filtro-cliente-dropdown')
  if (!dropdown) return
  const visible = dropdown.style.display !== 'none'
  if (visible) { dropdown.style.display = 'none'; return }
  dropdown.style.display = 'block'
  if (_cobClientesCache.length === 0) {
    document.getElementById('cob-filtro-cliente-lista').innerHTML =
      '<p style="padding:12px;color:var(--color-text-secondary);font-size:13px">Cargando...</p>'
    const { data } = await db.from('clientes').select('id, razon_social').eq('activo', true).order('razon_social')
    _cobClientesCache = data || []
  }
  renderCobFiltroClientes(_cobClientesCache)
  setTimeout(() => { document.addEventListener('click', cerrarCobDropdownAfuera, { once: true }) }, 100)
}

function cerrarCobDropdownAfuera(e) {
  ['cob-filtro-cliente-dropdown','cob-filtro-vendedor-dropdown'].forEach(id => {
    const el = document.getElementById(id)
    if (el && !el.contains(e.target)) el.style.display = 'none'
  })
}

function filtrarCobClientes() {
  const q = document.getElementById('cob-filtro-cliente-buscar')?.value?.toLowerCase() || ''
  renderCobFiltroClientes(q ? _cobClientesCache.filter(c => c.razon_social.toLowerCase().includes(q)) : _cobClientesCache)
}

function renderCobFiltroClientes(clientes) {
  document.getElementById('cob-filtro-cliente-lista').innerHTML = [
    `<div onclick="seleccionarCobCliente(null,'Todos los clientes')" class="cob-dropdown-item">Todos los clientes</div>`,
    ...clientes.map(c => `<div onclick="seleccionarCobCliente('${c.id}','${c.razon_social.replace(/'/g,"\\'")}'')" class="cob-dropdown-item">${c.razon_social}</div>`)
  ].join('')
}

function seleccionarCobCliente(id, nombre) {
  _cobFiltroClienteId = id
  document.getElementById('cob-filtro-cliente-label').textContent = nombre || 'Todos los clientes'
  document.getElementById('cob-filtro-cliente-dropdown').style.display = 'none'
  cargarCobranza()
}

async function toggleCobFiltroVendedores() {
  const dropdown = document.getElementById('cob-filtro-vendedor-dropdown')
  if (!dropdown) return
  const visible = dropdown.style.display !== 'none'
  if (visible) { dropdown.style.display = 'none'; return }
  dropdown.style.display = 'block'
  if (_cobVendedoresCache.length === 0) {
    const { data } = await db.from('perfiles').select('id, nombre_completo').neq('rol', 'cliente').order('nombre_completo')
    _cobVendedoresCache = data || []
  }
  document.getElementById('cob-filtro-vendedor-lista').innerHTML = [
    `<div onclick="seleccionarCobVendedor(null,'Todos los vendedores')" class="cob-dropdown-item">Todos los vendedores</div>`,
    ..._cobVendedoresCache.map(v => `<div onclick="seleccionarCobVendedor('${v.id}','${v.nombre_completo.replace(/'/g,"\\'")}'')" class="cob-dropdown-item">${v.nombre_completo}</div>`)
  ].join('')
  setTimeout(() => { document.addEventListener('click', cerrarCobDropdownAfuera, { once: true }) }, 100)
}

function seleccionarCobVendedor(id, nombre) {
  _cobFiltroVendedorId = id
  document.getElementById('cob-filtro-vendedor-label').textContent = nombre || 'Todos los vendedores'
  document.getElementById('cob-filtro-vendedor-dropdown').style.display = 'none'
  cargarCobranza()
}

function setCobEstado(estado) {
  _cobEstado = estado
  ;['vencido','pendiente','cobrado','todos'].forEach(e => {
    const btn = document.getElementById('cob-btn-' + e)
    if (btn) btn.classList.toggle('activo', e === estado)
  })
  cargarCobranza()
}

function limpiarCobFiltros() {
  _cobFiltroClienteId = null; _cobFiltroVendedorId = null; _cobEstado = 'todos'
  const cl = document.getElementById('cob-filtro-cliente-label')
  const vl = document.getElementById('cob-filtro-vendedor-label')
  if (cl) cl.textContent = 'Todos los clientes'
  if (vl) vl.textContent = 'Todos los vendedores'
  ;['vencido','pendiente','cobrado'].forEach(e => document.getElementById('cob-btn-' + e)?.classList.remove('activo'))
  document.getElementById('cob-btn-todos')?.classList.add('activo')
  const d = document.getElementById('cob-fecha-desde'); if (d) d.value = ''
  const h = document.getElementById('cob-fecha-hasta'); if (h) h.value = ''
  cargarCobranza()
}

// ── EXPORTAR ─────────────────────────────────────
async function exportarCobranza() {
  const hoy    = new Date().toISOString().split('T')[0]
  const { data: pedidos } = await db.from('pedidos')
    .select('numero, total, monto_cobrado, estado_cobro, fecha_vencimiento_cobro, clientes(razon_social)')
    .not('etapa', 'eq', 'cancelado')
    .order('fecha_vencimiento_cobro', { ascending: true })

  const rows = pedidos?.map(p => [
    `#${p.numero}`,
    p.clientes?.razon_social || '-',
    '-',
    `$${Number(p.total).toLocaleString('es-AR')}`,
    `$${Number(p.monto_cobrado).toLocaleString('es-AR')}`,
    `$${(Number(p.total) - Number(p.monto_cobrado)).toLocaleString('es-AR')}`,
    p.estado_cobro === 'pendiente' ? 'Pendiente' : 'Cobrado',
    p.fecha_vencimiento_cobro ? formatFecha(p.fecha_vencimiento_cobro) : '-',
    p.fecha_vencimiento_cobro && p.fecha_vencimiento_cobro < hoy && p.estado_cobro === 'pendiente' ? 'VENCIDO' : ''
  ]) || []

  // Usar ; como separador (estándar Excel Argentina)
  const SEP = ';'
  const csv = [
    ['Pedido','Cliente','Vendedor','Total','Cobrado','Pendiente','Estado','Vencimiento','Alerta'],
    ...rows
  ].map(r => r.map(c => String(c).replace(/;/g, ',')).join(SEP)).join('\r\n')

  // BOM para que Excel reconozca UTF-8
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `cobranza_${hoy}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}


// ── DETALLE PEDIDO EN COBRANZA ───────────────────
let _detalleCobPedidoId = null

async function abrirDetalleCob(pedidoId) {
  _detalleCobPedidoId = pedidoId
  const modal = document.getElementById('modal-detalle-cob')
  if (!modal) return
  modal.style.display = 'flex'
  modal.style.alignItems = 'flex-start'
  modal.style.justifyContent = 'flex-end'

  // Mostrar skeleton mientras carga
  document.getElementById('mdc-titulo').textContent = 'Cargando...'
  document.getElementById('mdc-cliente').innerHTML = '<p class="vacio">Cargando...</p>'
  document.getElementById('mdc-productos').innerHTML = ''
  document.getElementById('mdc-documentos').innerHTML = ''
  document.getElementById('mdc-cobros').innerHTML = ''
  document.getElementById('mdc-historial').innerHTML = ''

  // Cargar datos en paralelo
  const [
    { data: p },
    { data: items },
    { data: cobros },
    { data: docs },
    { data: historial }
  ] = await Promise.all([
    db.from('pedidos').select('*, clientes(*)').eq('id', pedidoId).single(),
    db.from('pedido_items').select('*, productos(descripcion, unidad, codigo)').eq('pedido_id', pedidoId),
    db.from('cobros').select('*').eq('pedido_id', pedidoId).order('created_at'),
    db.from('documentos_pedido').select('*').eq('pedido_id', pedidoId).order('created_at'),
    db.from('historial_pedido').select('*').eq('pedido_id', pedidoId).order('created_at')
  ])

  if (!p) return

  document.getElementById('mdc-titulo').textContent = `Pedido #${p.numero}`

  // Cliente
  const c = p.clientes
  const totalCobrado = cobros?.reduce((s, cb) => s + Number(cb.monto), 0) || 0
  const pendiente    = Number(p.total) - totalCobrado
  const pct          = p.total > 0 ? Math.min((totalCobrado / Number(p.total)) * 100, 100) : 0

  document.getElementById('mdc-cliente').innerHTML = `
    <div class="info-grid">
      <div><span class="info-label">Cliente</span><span class="info-valor">${c?.razon_social || '-'}</span></div>
      <div><span class="info-label">Total</span><span class="info-valor" style="font-size:18px;font-weight:500;color:#1a3a2a">$${Number(p.total).toLocaleString('es-AR')}</span></div>
      <div><span class="info-label">CUIT</span><span class="info-valor">${c?.cuit || '-'}</span></div>
      <div><span class="info-label">Facturación</span><span class="info-valor">${labelFacturacion(c?.condicion_factura, c?.pct_remito, c?.pct_factura)}</span></div>
    </div>
    <div style="margin-top:12px">
      <div class="cobro-barra-wrap">
        <div class="cobro-barra"><div class="cobro-barra-fill" style="width:${pct}%"></div></div>
        <span style="font-size:13px;font-weight:500">${Math.round(pct)}%</span>
      </div>
      <div style="display:flex;gap:16px;font-size:13px;margin-top:6px">
        <span>Cobrado: <b style="color:#1d9e75">$${totalCobrado.toLocaleString('es-AR')}</b></span>
        <span>Pendiente: <b style="color:${pendiente > 0 ? '#e24b4a' : '#1d9e75'}">$${pendiente.toLocaleString('es-AR')}</b></span>
      </div>
    </div>`

  // Productos
  document.getElementById('mdc-productos').innerHTML = items?.length
    ? `<table class="tabla">
        <thead><tr><th>Producto</th><th>Cantidad</th><th>Subtotal</th></tr></thead>
        <tbody>${items.map(i => `<tr>
          <td>${i.productos?.descripcion || '-'}</td>
          <td>${i.cantidad} ${i.productos?.unidad || ''}</td>
          <td>$${Number(i.subtotal).toLocaleString('es-AR')}</td>
        </tr>`).join('')}</tbody>
      </table>`
    : '<p class="vacio">Sin productos</p>'

  // Documentos (facturas)
  document.getElementById('mdc-documentos').innerHTML = docs?.length
    ? docs.map(d => `
        <div class="mdc-doc-item">
          <div>
            <span class="doc-tipo">${labelTipoDoc(d.tipo)}</span>
            ${badgeVerificacion(d.verificacion)}
            <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:2px">${formatFechaHora(d.created_at)}</div>
          </div>
          <a href="${d.archivo_url}" target="_blank" class="btn-ver-doc">
            <i class="ti ti-${d.archivo_tipo === 'pdf' ? 'file-type-pdf' : 'photo'}" aria-hidden="true"></i>
            Ver ${d.archivo_tipo === 'pdf' ? 'PDF' : 'imagen'}
          </a>
        </div>`).join('')
    : '<p class="vacio">Sin documentos subidos</p>'

  // Cobros con fotos
  document.getElementById('mdc-cobros').innerHTML = cobros?.length
    ? cobros.map(cb => `
        <div class="mdc-cobro-item">
          <div class="mdc-cobro-info">
            <span class="cobro-medio">${iconMedio(cb.medio_pago)} ${labelMedio(cb.medio_pago)}</span>
            <span class="cobro-monto">$${Number(cb.monto).toLocaleString('es-AR')}</span>
            ${cb.fecha_vencimiento_cheque ? `<span style="font-size:12px;color:#633806">📅 Vence cheque: ${formatFecha(cb.fecha_vencimiento_cheque)}</span>` : ''}
            ${cb.nota ? `<span style="font-size:12px;color:var(--color-text-secondary)">📝 ${cb.nota}</span>` : ''}
            <span style="font-size:12px;color:var(--color-text-tertiary)">${formatFechaHora(cb.created_at)}</span>
          </div>
          ${cb.foto_url ? `
            <div class="mdc-foto-wrap">
              <a href="${cb.foto_url}" target="_blank" class="btn-ver-doc foto">
                <i class="ti ti-photo" aria-hidden="true"></i> Ver comprobante
              </a>
              <img src="${cb.foto_url}" alt="Comprobante"
                style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-top:8px;cursor:pointer"
                onclick="window.open('${cb.foto_url}', '_blank')">
            </div>` : ''}
        </div>`).join('')
    : '<p class="vacio">Sin cobros registrados</p>'

  // Historial
  document.getElementById('mdc-historial').innerHTML = historial?.length
    ? historial.map(h => `
        <div class="historial-item">
          <div class="historial-icono">${iconAccion(h.accion)}</div>
          <div class="historial-info">
            <span class="historial-detalle">${h.detalle}</span>
            <span class="historial-quien">${formatFechaHora(h.created_at)}</span>
          </div>
        </div>`).join('')
    : '<p class="vacio">Sin historial</p>'

  // Botón cobrar si pendiente
  const btnEl = document.getElementById('mdc-btn-cobrar')
  if (pendiente > 0.01) {
    btnEl.innerHTML = `
      <button onclick="cerrarDetalleCob(); abrirModalCobro('${pedidoId}', '${c?.razon_social || ''}', ${pendiente})"
        class="btn-cobrar" style="width:100%;justify-content:center;padding:14px">
        <i class="ti ti-cash" aria-hidden="true"></i> Registrar cobro ($${pendiente.toLocaleString('es-AR')} pendiente)
      </button>`
  } else {
    btnEl.innerHTML = ''
  }
}

function cerrarDetalleCob() {
  const modal = document.getElementById('modal-detalle-cob')
  if (modal) modal.style.display = 'none'
  _detalleCobPedidoId = null
}

function abrirPDFDesdeCobranza() {
  if (_detalleCobPedidoId) descargarPDF(_detalleCobPedidoId)
}


// ── HELPERS COBRANZA ─────────────────────────────
function formatMonto(n) {
  return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
