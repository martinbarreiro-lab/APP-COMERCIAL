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
}

async function cargarPedidos() {
  const { data: pedidos } = await db.from('pedidos')
    .select('id, numero, total, estado, etapa, estado_cobro, alerta_vencimiento, fecha_vencimiento_cobro, clientes(razon_social)')
    .order('created_at', { ascending: false }).limit(50)

  const html = pedidos && pedidos.length > 0
    ? pedidos.map(p => `
      <div class="pedido-card ${p.alerta_vencimiento ? 'pedido-alerta' : ''}" onclick="abrirPedido('${p.id}')">
        <div class="pedido-card-top">
          <span class="pedido-numero">#${p.numero}</span>
          ${p.alerta_vencimiento ? '<span class="badge badge-rojo">⚠️ Vence pronto</span>' : ''}
          ${badgeEtapa(p.etapa)}
        </div>
        <div class="pedido-cliente">${p.clientes?.razon_social || '-'}</div>
        <div class="pedido-card-bottom">
          <span class="pedido-total">$${Number(p.total).toLocaleString('es-AR')}</span>
          ${badgeCobro(p.estado_cobro)}
          ${p.fecha_vencimiento_cobro ? `<span class="pedido-vence">Vence: ${formatFecha(p.fecha_vencimiento_cobro)}</span>` : ''}
        </div>
      </div>`).join('')
    : '<p class="vacio">No hay pedidos todavía</p>'

  document.getElementById('lista-pedidos').innerHTML = html
}

async function abrirPedido(id) {
  pedidoActualId = id
  mostrarVistaPedidos('detalle')

  const { data: p } = await db.from('pedidos')
    .select('*, clientes(*)')
    .eq('id', id).single()
  if (!p) return

  document.getElementById('titulo-pedido').textContent = `Pedido #${p.numero}`

  // Progreso
  const etapas = ['pedido', 'documentado', 'cobrado', 'cerrado']
  const idx = etapas.indexOf(p.etapa || 'pedido')
  etapas.forEach((e, i) => {
    const el = document.getElementById('prog-' + e)
    if (el) {
      el.querySelector('.progreso-circulo').className = 'progreso-circulo ' + (i <= idx ? 'activo' : '')
    }
  })

  // Alerta vencimiento
  const alertaEl = document.getElementById('alerta-vencimiento-pedido')
  if (p.alerta_vencimiento) {
    alertaEl.style.display = 'block'
    document.getElementById('texto-alerta-vencimiento').textContent =
      `Este pedido vence el ${formatFecha(p.fecha_vencimiento_cobro)}. ¡Gestionar cobro urgente!`
  } else {
    alertaEl.style.display = 'none'
  }

  // Info
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
}

function volverAPedidos() {
  pedidoActualId = null
  mostrarVistaPedidos('lista')
  cargarPedidos()
}

// ── DOCUMENTOS ───────────────────────────────────
async function cargarDocumentosPedido(pedidoId) {
  const { data: docs } = await db.from('documentos_pedido')
    .select('*, perfiles(nombre_completo)')
    .eq('pedido_id', pedidoId)
    .order('created_at', { ascending: false })

  const el = document.getElementById('lista-documentos-pedido')
  if (!docs || docs.length === 0) {
    el.innerHTML = '<p class="vacio">Sin documentos subidos</p>'
    return
  }
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
        ${d.verificacion === 'pendiente' ? `<button onclick="verificarDocumento('${d.id}')" class="btn-verificar">🤖 Verificar</button>` : ''}
      </div>
      ${d.diferencias && d.verificacion === 'con_diferencias' ? `
        <div class="diferencias-box">
          ${renderDiferencias(d.diferencias)}
        </div>` : ''}
    </div>`).join('')
}

function abrirSubirDocumento() {
  document.getElementById('form-subir-documento').style.display = 'block'
}
function cancelarSubirDocumento() {
  document.getElementById('form-subir-documento').style.display = 'none'
}

async function subirDocumento() {
  const tipo    = document.getElementById('tipo-documento').value
  const archivo = document.getElementById('archivo-documento').files[0]
  const nota    = document.getElementById('nota-documento').value.trim()

  if (!archivo) { alert('Seleccioná un archivo'); return }

  const ext      = archivo.name.split('.').pop()
  const nombre   = `${pedidoActualId}/${tipo}_${Date.now()}.${ext}`
  const archivoTipo = archivo.type === 'application/pdf' ? 'pdf' : 'imagen'

  const { data: upload, error: uploadError } = await db.storage
    .from('documentos').upload(nombre, archivo, { upsert: true })

  if (uploadError) { alert('Error al subir el archivo: ' + uploadError.message); return }

  const { data: urlData } = db.storage.from('documentos').getPublicUrl(nombre)
  const url = urlData.publicUrl

  const { data: doc, error } = await db.from('documentos_pedido').insert({
    pedido_id:   pedidoActualId,
    tipo,
    archivo_url: url,
    archivo_tipo: archivoTipo,
    nota:        nota || null,
    subido_por:  usuarioActual.id,
    verificacion: 'pendiente'
  }).select().single()

  if (error) { alert('Error al guardar el documento'); return }

  await registrarHistorial(pedidoActualId, 'documento_subido',
    `Se subió ${labelTipoDoc(tipo)}${nota ? ': ' + nota : ''}`)

  await actualizarEstadoDocumento(pedidoActualId)
  cancelarSubirDocumento()
  await cargarDocumentosPedido(pedidoActualId)
  await cargarHistorialPedido(pedidoActualId)

  // Verificar automáticamente
  await verificarDocumento(doc.id)
}

async function verificarDocumento(docId) {
  const { data: doc } = await db.from('documentos_pedido').select('*').eq('id', docId).single()
  if (!doc) return

  const { data: items } = await db.from('pedido_items')
    .select('*, productos(descripcion, codigo)')
    .eq('pedido_id', doc.pedido_id)

  const { data: pedido } = await db.from('pedidos')
    .select('*, clientes(cuit, razon_social)')
    .eq('id', doc.pedido_id).single()

  // Mostrar que está verificando
  alert('🤖 Verificando documento con IA... (función disponible con Edge Function configurada)')

  // Por ahora marcamos como pendiente manual
  await db.from('documentos_pedido').update({
    verificacion: 'pendiente',
    diferencias: {
      mensaje: 'Verificación manual requerida. Comparar con pedido.',
      productos_pedido: items?.map(i => ({
        descripcion: i.productos?.descripcion,
        cantidad: i.cantidad,
        precio: i.precio_unitario
      }))
    }
  }).eq('id', docId)

  await cargarDocumentosPedido(doc.pedido_id)
}

async function actualizarEstadoDocumento(pedidoId) {
  const { data: docs } = await db.from('documentos_pedido')
    .select('tipo').eq('pedido_id', pedidoId)
  const tipos = docs?.map(d => d.tipo) || []
  let estado = 'sin_doc'
  if (tipos.length > 0) estado = 'parcial'

  const { data: pedido } = await db.from('pedidos').select('clientes(condicion_factura)').eq('id', pedidoId).single()
  const condicion = pedido?.clientes?.condicion_factura

  if (condicion === 'todo_remito'  && tipos.some(t => t === 'remito'))                        estado = 'completo'
  if (condicion === 'todo_factura' && tipos.some(t => t.startsWith('factura')))               estado = 'completo'
  if (condicion === 'mixto'        && tipos.some(t => t === 'remito') && tipos.some(t => t.startsWith('factura'))) estado = 'completo'

  let etapa = 'pedido'
  if (estado === 'completo') etapa = 'documentado'

  await db.from('pedidos').update({ estado_documento: estado, etapa }).eq('id', pedidoId)
}

// ── PRODUCTOS DEL PEDIDO ─────────────────────────
async function cargarProductosPedido(pedidoId) {
  const { data: items } = await db.from('pedido_items')
    .select('*, productos(descripcion, codigo, unidad)')
    .eq('pedido_id', pedidoId)

  const el = document.getElementById('productos-pedido')
  if (!items || items.length === 0) { el.innerHTML = '<p class="vacio">Sin productos</p>'; return }

  el.innerHTML = `
    <table class="tabla">
      <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unit.</th><th>Subtotal</th></tr></thead>
      <tbody>
        ${items.map(i => `<tr>
          <td><b>${i.productos?.descripcion || '-'}</b><br><small>${i.productos?.codigo || ''}</small></td>
          <td>${i.cantidad} ${i.productos?.unidad || ''}</td>
          <td>$${Number(i.precio_unitario).toLocaleString('es-AR')}</td>
          <td><b>$${Number(i.subtotal).toLocaleString('es-AR')}</b></td>
        </tr>`).join('')}
      </tbody>
    </table>`
}

// ── COBROS DEL PEDIDO ────────────────────────────
async function cargarCobrosPedido(pedidoId) {
  const { data: pedido } = await db.from('pedidos').select('total, monto_cobrado, estado_cobro').eq('id', pedidoId).single()
  const { data: cobros }  = await db.from('cobros').select('*').eq('pedido_id', pedidoId).order('created_at')

  const total    = Number(pedido?.total || 0)
  const cobrado  = Number(pedido?.monto_cobrado || 0)
  const pendiente = total - cobrado
  const pct      = total > 0 ? Math.min((cobrado / total) * 100, 100) : 0

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
  if (!cobros || cobros.length === 0) {
    listEl.innerHTML = '<p class="vacio">Sin cobros registrados</p>'
    return
  }
  listEl.innerHTML = cobros.map(c => `
    <div class="cobro-item">
      <div class="cobro-item-info">
        <span class="cobro-medio">${iconMedio(c.medio_pago)} ${labelMedio(c.medio_pago)}</span>
        <span class="cobro-monto">$${Number(c.monto).toLocaleString('es-AR')}</span>
        ${c.fecha_vencimiento_cheque ? `<span class="cobro-cheque-fecha">📅 Cheque vence: ${formatFecha(c.fecha_vencimiento_cheque)}</span>` : ''}
        ${c.nota ? `<span class="cobro-nota">📝 ${c.nota}</span>` : ''}
        <span class="cobro-fecha">${formatFechaHora(c.created_at)}</span>
      </div>
      ${c.foto_url ? `<a href="${c.foto_url}" target="_blank" class="btn-ver">📷 Ver comprobante</a>` : ''}
    </div>`).join('')
}

function abrirAgregarCobro() {
  document.getElementById('form-agregar-cobro').style.display = 'block'
  document.getElementById('cobro-medio').onchange = function() {
    const esCheque = this.value === 'cheque' || this.value === 'echeq'
    document.getElementById('campo-fecha-cheque').style.display = esCheque ? 'block' : 'none'
  }
}
function cancelarAgregarCobro() {
  document.getElementById('form-agregar-cobro').style.display = 'none'
}

async function guardarCobro() {
  const medio  = document.getElementById('cobro-medio').value
  const monto  = parseFloat(document.getElementById('cobro-monto').value)
  const nota   = document.getElementById('cobro-nota').value.trim()
  const foto   = document.getElementById('cobro-foto').files[0]
  const fechaCheque = document.getElementById('cobro-fecha-cheque').value

  if (!monto || monto <= 0) { alert('Ingresá un monto válido'); return }

  // Verificar que no supere el saldo pendiente
  const { data: pedido } = await db.from('pedidos').select('total, monto_cobrado').eq('id', pedidoActualId).single()
  const pendiente = Number(pedido.total) - Number(pedido.monto_cobrado)
  if (monto > pendiente + 0.01) {
    alert(`⚠️ El monto ($${monto.toLocaleString('es-AR')}) supera el saldo pendiente ($${pendiente.toLocaleString('es-AR')})`)
    return
  }

  let fotoUrl = null
  if (foto) {
    const ext  = foto.name.split('.').pop()
    const path = `${pedidoActualId}/${medio}_${Date.now()}.${ext}`
    const { error: upErr } = await db.storage.from('comprobantes').upload(path, foto, { upsert: true })
    if (!upErr) {
      const { data: urlData } = db.storage.from('comprobantes').getPublicUrl(path)
      fotoUrl = urlData.publicUrl
    }
  }

  const { error } = await db.from('cobros').insert({
    pedido_id:  pedidoActualId,
    vendedor_id: usuarioActual.id,
    estado:     'cobrado_' + (medio === 'transferencia' ? 'transferencia' : medio === 'cheque' || medio === 'echeq' ? 'cheque' : 'efectivo'),
    monto,
    medio_pago: medio,
    foto_url:   fotoUrl,
    nota:       nota || null,
    fecha_vencimiento_cheque: fechaCheque || null,
    creado_offline: false
  })

  if (error) { alert('Error al guardar el cobro: ' + error.message); return }

  // Actualizar monto cobrado en el pedido
  const nuevoMonto = Number(pedido.monto_cobrado) + monto
  const nuevoPendiente = Number(pedido.total) - nuevoMonto
  const nuevoEstado = nuevoPendiente <= 0.01 ? 'cobrado_efectivo' : 'pendiente'
  const nuevaEtapa  = nuevoPendiente <= 0.01 ? 'cobrado' : undefined

  const updateData = { monto_cobrado: nuevoMonto, estado_cobro: nuevoEstado }
  if (nuevaEtapa) updateData.etapa = nuevaEtapa

  await db.from('pedidos').update(updateData).eq('id', pedidoActualId)

  await registrarHistorial(pedidoActualId, 'cobro_registrado',
    `${labelMedio(medio)} por $${monto.toLocaleString('es-AR')}${nota ? ' — ' + nota : ''}`)

  cancelarAgregarCobro()
  await cargarCobrosPedido(pedidoActualId)
  await cargarHistorialPedido(pedidoActualId)
  document.getElementById('cobro-monto').value = ''
  document.getElementById('cobro-nota').value  = ''
  document.getElementById('cobro-foto').value  = ''
}

// ── HISTORIAL ────────────────────────────────────
async function cargarHistorialPedido(pedidoId) {
  const { data: historial } = await db.from('historial_pedido')
    .select('*, perfiles(nombre_completo)')
    .eq('pedido_id', pedidoId)
    .order('created_at', { ascending: false })

  const el = document.getElementById('historial-pedido')
  if (!historial || historial.length === 0) {
    el.innerHTML = '<p class="vacio">Sin actividad registrada</p>'
    return
  }
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
  await db.from('historial_pedido').insert({
    pedido_id:  pedidoId,
    usuario_id: usuarioActual?.id,
    accion,
    detalle
  })
}

// ── COBRANZA ─────────────────────────────────────
async function cargarCobranza() {
  const { data: pendientes } = await db.from('pedidos')
    .select('id, numero, total, monto_cobrado, fecha_vencimiento_cobro, alerta_vencimiento, clientes(razon_social)')
    .eq('estado_cobro', 'pendiente').order('fecha_vencimiento_cobro', { ascending: true })

  const html = pendientes && pendientes.length > 0
    ? `<table class="tabla">
        <thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Saldo</th><th>Vence</th><th></th></tr></thead>
        <tbody>
        ${pendientes.map(p => `<tr class="${p.alerta_vencimiento ? 'fila-alerta' : ''}">
          <td><b>#${p.numero}</b></td>
          <td>${p.clientes?.razon_social || '-'}</td>
          <td>$${Number(p.total).toLocaleString('es-AR')}</td>
          <td><b class="rojo">$${(Number(p.total) - Number(p.monto_cobrado)).toLocaleString('es-AR')}</b></td>
          <td>${p.fecha_vencimiento_cobro ? formatFecha(p.fecha_vencimiento_cobro) : '-'} ${p.alerta_vencimiento ? '⚠️' : ''}</td>
          <td><button onclick="mostrarSeccion('pedidos'); setTimeout(()=>abrirPedido('${p.id}'),100)" class="btn-mini">Ver pedido</button></td>
        </tr>`).join('')}
        </tbody></table>`
    : '<p class="vacio">✅ No hay cobros pendientes</p>'

  document.getElementById('lista-cobranza').innerHTML = html
}

// ── ENVIOS ───────────────────────────────────────
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

  // Mostrar botón actualizar solo al admin
  const btnActualizar = document.getElementById('btn-actualizar-precios')
  if (btnActualizar) btnActualizar.style.display = rol === 'admin' ? 'block' : 'none'

  const { data: categorias } = await db.from('categorias').select('id, nombre').order('orden')
  const { data: productos }  = await db.from('productos').select('*, categorias(nombre)').order('descripcion')

  if (!productos || productos.length === 0) {
    document.getElementById('lista-productos').innerHTML = '<p class="vacio">No hay productos cargados</p>'
    return
  }

  // Agrupar por categoría
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
        <thead><tr><th>Código</th><th>Descripción</th><th>Precio</th><th>Unidad</th><th>Últ. actualización</th></tr></thead>
        <tbody>
          ${prods.map(p => `<tr>
            <td>${p.codigo}</td>
            <td><b>${p.descripcion}</b></td>
            <td class="${p.precio_1 > 0 ? '' : 'precio-sin-definir'}">
              ${p.precio_1 > 0 ? '$' + Number(p.precio_1).toLocaleString('es-AR') : 'Sin precio'}
              ${p.precio_anterior > 0 ? `<br><small class="precio-anterior">Ant: $${Number(p.precio_anterior).toLocaleString('es-AR')}</small>` : ''}
            </td>
            <td>${p.unidad}</td>
            <td>${p.fecha_ultimo_precio ? formatFecha(p.fecha_ultimo_precio) : '-'}</td>
          </tr>`).join('')}
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
  return `<span class="badge ${c[e]||'badge-gris'}">${e}</span>`
}
