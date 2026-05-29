// ================================================
// LA CABAÑA — Lógica principal
// ================================================

let clienteEditandoId = null
let clientesCache = []
let usuarioActual = null

// ── AL CARGAR ────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await db.auth.getSession()
  if (session) {
    mostrarApp(session.user)
  } else {
    mostrarLogin()
  }
})

// ── LOGIN ────────────────────────────────────────
async function iniciarSesion() {
  const email    = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { mostrarErrorLogin('Completá email y contraseña'); return }
  const { data, error } = await db.auth.signInWithPassword({ email, password })
  if (error) { mostrarErrorLogin('Email o contraseña incorrectos'); return }
  mostrarApp(data.user)
}

function mostrarErrorLogin(mensaje) {
  const el = document.getElementById('login-error')
  el.textContent = mensaje
  el.style.display = 'block'
}

async function olvidoPassword() {
  const email = document.getElementById('login-email').value.trim()
  if (!email) { mostrarErrorLogin('Escribí tu email primero'); return }
  const { error } = await db.auth.resetPasswordForEmail(email)
  if (error) { mostrarErrorLogin('Error al enviar el email'); return }
  alert('✅ Te mandamos un email para restablecer tu contraseña')
}

async function cerrarSesion() {
  await db.auth.signOut()
  mostrarLogin()
}

function mostrarLogin() {
  document.getElementById('pantalla-login').style.display = 'flex'
  document.getElementById('pantalla-app').style.display   = 'none'
}

async function mostrarApp(usuario) {
  usuarioActual = usuario
  document.getElementById('pantalla-login').style.display = 'none'
  document.getElementById('pantalla-app').style.display   = 'block'
  const { data: perfil } = await db.from('perfiles').select('nombre_completo, rol').eq('id', usuario.id).single()
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
  if (nombre === 'pedidos')   cargarPedidos()
  if (nombre === 'cobranza')  cargarCobranza()
  if (nombre === 'logistica') cargarEnvios()
  if (nombre === 'clientes')  cargarClientes()
  if (nombre === 'productos') cargarProductos()
}

// ── DASHBOARD ────────────────────────────────────
async function cargarDashboard() {
  const hoy = new Date().toISOString().split('T')[0]
  const { data: pedidos } = await db.from('pedidos').select('id').gte('created_at', hoy)
  document.getElementById('total-pedidos-hoy').textContent = pedidos ? pedidos.length : 0
  const { data: cobros } = await db.from('cobros').select('monto').gte('created_at', hoy)
  const totalCobrado = cobros ? cobros.reduce((sum, c) => sum + Number(c.monto), 0) : 0
  document.getElementById('total-cobros-hoy').textContent = '$' + totalCobrado.toLocaleString('es-AR')
  const { data: pendientes } = await db.from('pedidos').select('id').eq('estado_cobro', 'pendiente')
  document.getElementById('total-pendientes').textContent = pendientes ? pendientes.length : 0
  const { data: envios } = await db.from('envios').select('id').eq('estado', 'en_camino')
  document.getElementById('total-envios').textContent = envios ? envios.length : 0
}

// ── PEDIDOS ──────────────────────────────────────
async function cargarPedidos() {
  const { data: pedidos } = await db.from('pedidos')
    .select('id, numero, total, estado, estado_cobro, fecha_pedido, clientes(razon_social), perfiles(nombre_completo)')
    .order('created_at', { ascending: false }).limit(50)
  const html = pedidos && pedidos.length > 0
    ? `<table class="tabla"><thead><tr><th>#</th><th>Cliente</th><th>Vendedor</th><th>Total</th><th>Estado</th><th>Cobro</th></tr></thead><tbody>
      ${pedidos.map(p => `<tr>
        <td><b>#${p.numero}</b></td>
        <td>${p.clientes?.razon_social || '-'}</td>
        <td>${p.perfiles?.nombre_completo || '-'}</td>
        <td><b>$${Number(p.total).toLocaleString('es-AR')}</b></td>
        <td>${badgeEstado(p.estado)}</td>
        <td>${badgeCobro(p.estado_cobro)}</td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="vacio">No hay pedidos todavía</p>'
  document.getElementById('lista-pedidos').innerHTML = html
}

// ── COBRANZA ─────────────────────────────────────
async function cargarCobranza() {
  const { data: pendientes } = await db.from('pedidos')
    .select('id, numero, total, monto_cobrado, fecha_pedido, clientes(razon_social)')
    .eq('estado_cobro', 'pendiente').order('fecha_pedido', { ascending: true })
  const html = pendientes && pendientes.length > 0
    ? `<table class="tabla"><thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Saldo pendiente</th></tr></thead><tbody>
      ${pendientes.map(p => `<tr>
        <td><b>#${p.numero}</b></td>
        <td>${p.clientes?.razon_social || '-'}</td>
        <td>$${Number(p.total).toLocaleString('es-AR')}</td>
        <td><b style="color:#c00">$${(Number(p.total) - Number(p.monto_cobrado)).toLocaleString('es-AR')}</b></td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="vacio">✅ No hay cobros pendientes</p>'
  document.getElementById('lista-cobranza').innerHTML = html
}

// ── ENVIOS ───────────────────────────────────────
async function cargarEnvios() {
  const { data: envios } = await db.from('envios')
    .select('id, numero, estado, vehiculo, fecha_salida, fecha_llegada, perfiles(nombre_completo)')
    .order('created_at', { ascending: false }).limit(20)
  const html = envios && envios.length > 0
    ? `<table class="tabla"><thead><tr><th>#</th><th>Repartidor</th><th>Vehículo</th><th>Estado</th><th>Salida</th><th>Llegada</th></tr></thead><tbody>
      ${envios.map(e => `<tr>
        <td><b>#${e.numero}</b></td>
        <td>${e.perfiles?.nombre_completo || '-'}</td>
        <td>${e.vehiculo || '-'}</td>
        <td>${badgeEnvio(e.estado)}</td>
        <td>${e.fecha_salida ? formatFecha(e.fecha_salida) : '-'}</td>
        <td>${e.fecha_llegada ? formatFecha(e.fecha_llegada) : '⏳ En camino'}</td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="vacio">No hay envíos registrados</p>'
  document.getElementById('lista-envios').innerHTML = html
}

// ── CLIENTES ─────────────────────────────────────
async function cargarClientes() {
  mostrarVistaClientes('lista')
  const { data, error } = await db.from('clientes')
    .select('id, razon_social, telefono, saldo_pendiente, activo')
    .order('razon_social')
  if (error) { console.error(error); return }
  clientesCache = data || []
  renderizarListaClientes(clientesCache)
}

function renderizarListaClientes(clientes) {
  const lista = document.getElementById('lista-clientes')
  if (!clientes || clientes.length === 0) {
    lista.innerHTML = '<p class="vacio">No hay clientes cargados</p>'
    return
  }
  lista.innerHTML = clientes.map(c => `
    <div class="cliente-card" onclick="abrirFichaCliente('${c.id}')">
      <div class="cliente-card-info">
        <div class="cliente-nombre">${c.razon_social}</div>
        <div class="cliente-tel">
          📞 ${c.telefono || 'Sin teléfono'}
          ${c.telefono ? `<a href="https://wa.me/54${c.telefono.replace(/\D/g,'')}"
            onclick="event.stopPropagation()"
            target="_blank" class="btn-whatsapp">💬 WhatsApp</a>` : ''}
        </div>
        <div class="cliente-saldo ${Number(c.saldo_pendiente) > 0 ? 'saldo-deuda' : 'saldo-ok'}">
          ${Number(c.saldo_pendiente) > 0
            ? '💰 Saldo: $' + Number(c.saldo_pendiente).toLocaleString('es-AR') + ' pendiente'
            : '✅ Sin deuda'}
        </div>
      </div>
      <div class="cliente-card-arrow">›</div>
    </div>
  `).join('')
}

function filtrarClientes() {
  const busqueda = document.getElementById('buscador-clientes').value.toLowerCase()
  const filtrados = clientesCache.filter(c =>
    c.razon_social.toLowerCase().includes(busqueda)
  )
  renderizarListaClientes(filtrados)
}

async function abrirFichaCliente(id) {
  mostrarVistaClientes('ficha')
  const { data: c } = await db.from('clientes').select('*').eq('id', id).single()
  if (!c) return
  clienteEditandoId = id

  const labelFactura = {
    todo_factura: 'Todo Factura',
    todo_remito:  'Todo Remito',
    mixto:        `Mixto (${c.pct_remito}% Remito / ${c.pct_factura}% Factura)`
  }
  const formasPago = [
    c.pago_efectivo      ? 'Efectivo'      : null,
    c.pago_cheque        ? 'Cheque'        : null,
    c.pago_transferencia ? 'Transferencia' : null,
  ].filter(Boolean).join(', ') || 'No especificado'

  const { data: pedidos } = await db.from('pedidos')
    .select('numero, total, estado_cobro, fecha_pedido')
    .eq('cliente_id', id)
    .order('created_at', { ascending: false })
    .limit(5)

  const pedidosHtml = pedidos && pedidos.length > 0
    ? pedidos.map(p => `
        <div class="ficha-pedido-item">
          <span><b>#${p.numero}</b> — ${formatFecha(p.fecha_pedido)}</span>
          <span>$${Number(p.total).toLocaleString('es-AR')} ${badgeCobro(p.estado_cobro)}</span>
        </div>`).join('')
    : '<p class="vacio">Sin pedidos</p>'

  document.getElementById('contenido-ficha-cliente').innerHTML = `
    <div class="form-card">
      <div class="ficha-nombre">${c.razon_social}</div>
      ${c.activo ? '<span class="badge badge-verde">Activo</span>' : '<span class="badge badge-rojo">Inactivo</span>'}

      <div class="form-seccion">DATOS BÁSICOS</div>
      <div class="ficha-fila"><span>CUIT</span><span>${c.cuit || '-'}</span></div>
      <div class="ficha-fila"><span>Teléfono</span>
        <span>${c.telefono || '-'}
          ${c.telefono ? `<a href="https://wa.me/54${c.telefono.replace(/\D/g,'')}" target="_blank" class="btn-whatsapp">💬</a>` : ''}
        </span>
      </div>
      <div class="ficha-fila"><span>Email</span><span>${c.email || '-'}</span></div>
      <div class="ficha-fila"><span>Dirección</span><span>${c.direccion || '-'}</span></div>
      <div class="ficha-fila"><span>Localidad</span><span>${c.localidad || '-'}, ${c.provincia || '-'}</span></div>

      <div class="form-seccion">CONDICIÓN FISCAL</div>
      <div class="ficha-fila"><span>Condición IVA</span><span>${c.condicion_iva?.replace(/_/g,' ') || '-'}</span></div>
      <div class="ficha-fila"><span>Facturación</span><span>${labelFactura[c.condicion_factura] || '-'}</span></div>
      <div class="ficha-fila"><span>Alícuota IVA</span><span>${c.alicuota_iva}%</span></div>

      <div class="form-seccion">BENEFICIO COMERCIAL</div>
      <div class="ficha-fila"><span>Descuento precio</span><span>${c.descuento_pct}%</span></div>
      <div class="ficha-fila"><span>Bonificación producto</span><span>${c.bonificacion_pct}%</span></div>

      <div class="form-seccion">CONDICIONES DE PAGO</div>
      <div class="ficha-fila"><span>Vencimiento</span><span>${c.dias_vencimiento} días desde entrega</span></div>
      <div class="ficha-fila"><span>Formas de pago</span><span>${formasPago}</span></div>

      ${c.observaciones ? `<div class="form-seccion">OBSERVACIONES</div>
      <div class="ficha-obs">${c.observaciones}</div>` : ''}

      <div class="form-seccion">ÚLTIMOS PEDIDOS</div>
      ${pedidosHtml}
    </div>
  `
}

function editarClienteActual() {
  if (clienteEditandoId) abrirFormCliente(clienteEditandoId)
}

async function abrirFormCliente(id = null) {
  mostrarVistaClientes('form')
  await cargarProvincias()
  clienteEditandoId = id

  if (id) {
    document.getElementById('titulo-form-cliente').textContent = 'Editar Cliente'
    const { data: c } = await db.from('clientes').select('*').eq('id', id).single()
    if (!c) return
    document.getElementById('f-razon-social').value    = c.razon_social || ''
    document.getElementById('f-cuit').value            = c.cuit || ''
    document.getElementById('f-telefono').value        = c.telefono || ''
    document.getElementById('f-email').value           = c.email || ''
    document.getElementById('f-direccion').value       = c.direccion || ''
    document.getElementById('f-condicion-iva').value   = c.condicion_iva || 'responsable_inscripto'
    document.getElementById('f-condicion-factura').value = c.condicion_factura || 'todo_factura'
    document.getElementById('f-pct-remito').value      = c.pct_remito || 50
    document.getElementById('f-pct-factura').value     = c.pct_factura || 50
    document.getElementById('f-alicuota-iva').value    = c.alicuota_iva || 21
    document.getElementById('f-descuento').value       = c.descuento_pct || 0
    document.getElementById('f-bonificacion').value    = c.bonificacion_pct || 0
    document.getElementById('f-dias-vencimiento').value = c.dias_vencimiento || 7
    document.getElementById('f-pago-efectivo').checked      = c.pago_efectivo || false
    document.getElementById('f-pago-cheque').checked        = c.pago_cheque || false
    document.getElementById('f-pago-transferencia').checked = c.pago_transferencia || false
    document.getElementById('f-observaciones').value   = c.observaciones || ''
    toggleMixto()
    if (c.provincia) {
      document.getElementById('f-provincia').value = c.provincia
      await cargarLocalidades()
      document.getElementById('f-localidad').value = c.localidad || ''
    }
  } else {
    document.getElementById('titulo-form-cliente').textContent = 'Nuevo Cliente'
    document.getElementById('f-razon-social').value = ''
    document.getElementById('f-cuit').value = ''
    document.getElementById('f-telefono').value = ''
    document.getElementById('f-email').value = ''
    document.getElementById('f-direccion').value = ''
    document.getElementById('f-condicion-iva').value = 'responsable_inscripto'
    document.getElementById('f-condicion-factura').value = 'todo_factura'
    document.getElementById('f-pct-remito').value = 50
    document.getElementById('f-pct-factura').value = 50
    document.getElementById('f-alicuota-iva').value = 21
    document.getElementById('f-descuento').value = 0
    document.getElementById('f-bonificacion').value = 0
    document.getElementById('f-dias-vencimiento').value = 7
    document.getElementById('f-pago-efectivo').checked = false
    document.getElementById('f-pago-cheque').checked = false
    document.getElementById('f-pago-transferencia').checked = false
    document.getElementById('f-observaciones').value = ''
    toggleMixto()
  }
}

async function guardarCliente() {
  const razonSocial = document.getElementById('f-razon-social').value.trim()
  if (!razonSocial) {
    document.getElementById('form-error').textContent = 'La razón social es obligatoria'
    document.getElementById('form-error').style.display = 'block'
    return
  }
  document.getElementById('form-error').style.display = 'none'

  const datos = {
    razon_social:        razonSocial,
    cuit:                document.getElementById('f-cuit').value.trim() || null,
    telefono:            document.getElementById('f-telefono').value.trim() || null,
    email:               document.getElementById('f-email').value.trim() || null,
    direccion:           document.getElementById('f-direccion').value.trim() || null,
    provincia:           document.getElementById('f-provincia').value || null,
    localidad:           document.getElementById('f-localidad').value || null,
    condicion_iva:       document.getElementById('f-condicion-iva').value,
    condicion_factura:   document.getElementById('f-condicion-factura').value,
    pct_remito:          parseInt(document.getElementById('f-pct-remito').value) || 50,
    pct_factura:         parseInt(document.getElementById('f-pct-factura').value) || 50,
    alicuota_iva:        parseFloat(document.getElementById('f-alicuota-iva').value) || 21,
    descuento_pct:       parseFloat(document.getElementById('f-descuento').value) || 0,
    bonificacion_pct:    parseFloat(document.getElementById('f-bonificacion').value) || 0,
    dias_vencimiento:    parseInt(document.getElementById('f-dias-vencimiento').value) || 7,
    pago_efectivo:       document.getElementById('f-pago-efectivo').checked,
    pago_cheque:         document.getElementById('f-pago-cheque').checked,
    pago_transferencia:  document.getElementById('f-pago-transferencia').checked,
    observaciones:       document.getElementById('f-observaciones').value.trim() || null,
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

  if (error) {
    document.getElementById('form-error').textContent = 'Error al guardar: ' + error.message
    document.getElementById('form-error').style.display = 'block'
    return
  }

  await cargarClientes()
  alert('✅ Cliente guardado correctamente')
}

function volverAClientes() {
  cargarClientes()
}

function mostrarVistaClientes(vista) {
  document.getElementById('vista-lista-clientes').style.display = vista === 'lista' ? 'block' : 'none'
  document.getElementById('vista-ficha-cliente').style.display  = vista === 'ficha' ? 'block' : 'none'
  document.getElementById('vista-form-cliente').style.display   = vista === 'form'  ? 'block' : 'none'
}

function toggleMixto() {
  const tipo = document.getElementById('f-condicion-factura').value
  document.getElementById('campo-mixto').style.display = tipo === 'mixto' ? 'block' : 'none'
}

function sincronizarPct(origen) {
  if (origen === 'remito') {
    const val = parseInt(document.getElementById('f-pct-remito').value) || 0
    document.getElementById('f-pct-factura').value = 100 - val
  } else {
    const val = parseInt(document.getElementById('f-pct-factura').value) || 0
    document.getElementById('f-pct-remito').value = 100 - val
  }
}

// ── PROVINCIAS Y LOCALIDADES (API Argentina) ─────
async function cargarProvincias() {
  const select = document.getElementById('f-provincia')
  if (select.options.length > 1) return
  try {
    const res  = await fetch('https://apis.datos.gob.ar/georef/api/provincias?orden=nombre&max=100')
    const data = await res.json()
    data.provincias.forEach(p => {
      const opt = document.createElement('option')
      opt.value = p.nombre
      opt.textContent = p.nombre
      select.appendChild(opt)
    })
  } catch(e) {
    console.error('Error cargando provincias', e)
  }
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
    data.municipios.forEach(m => {
      const opt = document.createElement('option')
      opt.value = m.nombre
      opt.textContent = m.nombre
      select.appendChild(opt)
    })
  } catch(e) {
    select.innerHTML = '<option value="">Error al cargar localidades</option>'
  }
}

// ── PRODUCTOS ────────────────────────────────────
async function cargarProductos() {
  const { data: productos } = await db.from('productos')
    .select('id, codigo, descripcion, precio_1, unidad, activo').order('descripcion')
  const html = productos && productos.length > 0
    ? `<table class="tabla"><thead><tr><th>Código</th><th>Descripción</th><th>Precio</th><th>Unidad</th><th>Estado</th></tr></thead><tbody>
      ${productos.map(p => `<tr>
        <td>${p.codigo}</td>
        <td><b>${p.descripcion}</b></td>
        <td>$${Number(p.precio_1).toLocaleString('es-AR')}</td>
        <td>${p.unidad}</td>
        <td><span class="badge ${p.activo ? 'badge-verde' : 'badge-rojo'}">${p.activo ? 'Activo' : 'Inactivo'}</span></td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="vacio">No hay productos cargados</p>'
  document.getElementById('lista-productos').innerHTML = html
}

// ── STUBS ────────────────────────────────────────
function nuevoPedido()   { alert('🚧 Próximamente') }
function nuevoEnvio()    { alert('🚧 Próximamente') }
function nuevoProducto() { alert('🚧 Próximamente') }

// ── HELPERS ──────────────────────────────────────
function formatFecha(fecha) {
  if (!fecha) return '-'
  return new Date(fecha).toLocaleDateString('es-AR')
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
