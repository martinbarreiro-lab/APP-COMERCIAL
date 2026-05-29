// ================================================
// LA CABAÑA — Lógica principal
// ================================================

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await db.auth.getSession()
  if (session) {
    mostrarApp(session.user)
  } else {
    mostrarLogin()
  }
})

async function iniciarSesion() {
  const email    = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value

  if (!email || !password) {
    mostrarErrorLogin('Completá email y contraseña')
    return
  }

  const { data, error } = await db.auth.signInWithPassword({ email, password })

  if (error) {
    mostrarErrorLogin('Email o contraseña incorrectos')
    return
  }

  mostrarApp(data.user)
}

function mostrarErrorLogin(mensaje) {
  const el = document.getElementById('login-error')
  el.textContent = mensaje
  el.style.display = 'block'
}

async function olvidoPassword() {
  const email = document.getElementById('login-email').value.trim()

  if (!email) {
    mostrarErrorLogin('Escribí tu email primero')
    return
  }

  const { error } = await db.auth.resetPasswordForEmail(email)

  if (error) {
    mostrarErrorLogin('Error al enviar el email')
    return
  }

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
  document.getElementById('pantalla-login').style.display = 'none'
  document.getElementById('pantalla-app').style.display   = 'block'

  const { data: perfil } = await db
    .from('perfiles')
    .select('nombre_completo, rol')
    .eq('id', usuario.id)
    .single()

  if (perfil) {
    document.getElementById('nombre-usuario').textContent = perfil.nombre_completo
  }

  mostrarSeccion('dashboard')
}

function mostrarSeccion(nombre) {
  document.querySelectorAll('.seccion').forEach(s => s.style.display = 'none')
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('activo'))
  document.getElementById('seccion-' + nombre).style.display = 'block'
  document.getElementById('nav-' + nombre).classList.add('activo')

  if (nombre === 'dashboard')  cargarDashboard()
  if (nombre === 'preventa')   cargarPedidos()
  if (nombre === 'cobranza')   cargarCobranza()
  if (nombre === 'logistica')  cargarEnvios()
  if (nombre === 'clientes')   cargarClientes()
  if (nombre === 'productos')  cargarProductos()
}

async function cargarDashboard() {
  const hoy = new Date().toISOString().split('T')[0]

  const { data: pedidos } = await db
    .from('pedidos')
    .select('id')
    .gte('created_at', hoy)

  document.getElementById('total-pedidos-hoy').textContent =
    pedidos ? pedidos.length : 0

  const { data: cobros } = await db
    .from('cobros')
    .select('monto')
    .gte('created_at', hoy)

  const totalCobrado = cobros ? cobros.reduce((sum, c) => sum + c.monto, 0) : 0
  document.getElementById('total-cobros-hoy').textContent =
    '$' + totalCobrado.toLocaleString('es-AR')

  const { data: pendientes } = await db
    .from('pedidos')
    .select('id')
    .eq('estado_cobro', 'pendiente')

  document.getElementById('total-pendientes').textContent =
    pendientes ? pendientes.length : 0

  const { data: envios } = await db
    .from('envios')
    .select('id')
    .eq('estado', 'en_camino')

  document.getElementById('total-envios').textContent =
    envios ? envios.length : 0
}

async function cargarPedidos() {
  const { data: pedidos } = await db
    .from('pedidos')
    .select(`
      id, numero, total, estado, estado_cobro,
      fecha_pedido,
      clientes ( razon_social ),
      perfiles ( nombre_completo )
    `)
    .order('created_at', { ascending: false })
    .limit(50)

  const html = pedidos && pedidos.length > 0
    ? `<table class="tabla">
        <thead>
          <tr>
            <th>#</th><th>Cliente</th><th>Vendedor</th>
            <th>Total</th><th>Estado</th><th>Cobro</th>
          </tr>
        </thead>
        <tbody>
          ${pedidos.map(p => `
            <tr>
              <td><b>#${p.numero}</b></td>
              <td>${p.clientes?.razon_social || '-'}</td>
              <td>${p.perfiles?.nombre_completo || '-'}</td>
              <td><b>$${Number(p.total).toLocaleString('es-AR')}</b></td>
              <td>${badgeEstado(p.estado)}</td>
              <td>${badgeCobro(p.estado_cobro)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<p style="color:#888;padding:20px">No hay pedidos todavía</p>'

  document.getElementById('lista-pedidos').innerHTML = html
}

async function cargarCobranza() {
  const { data: pendientes } = await db
    .from('pedidos')
    .select(`
      id, numero, total, monto_cobrado, fecha_pedido,
      clientes ( razon_social )
    `)
    .eq('estado_cobro', 'pendiente')
    .order('fecha_pedido', { ascending: true })

  const html = pendientes && pendientes.length > 0
    ? `<table class="tabla">
        <thead>
          <tr>
            <th>#</th><th>Cliente</th>
            <th>Total</th><th>Saldo pendiente</th>
          </tr>
        </thead>
        <tbody>
          ${pendientes.map(p => `
            <tr>
              <td><b>#${p.numero}</b></td>
              <td>${p.clientes?.razon_social || '-'}</td>
              <td>$${Number(p.total).toLocaleString('es-AR')}</td>
              <td><b style="color:#c00">
                $${(Number(p.total) - Number(p.monto_cobrado)).toLocaleString('es-AR')}
              </b></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<p style="color:#888;padding:20px">✅ No hay cobros pendientes</p>'

  document.getElementById('lista-cobranza').innerHTML = html
}

async function cargarEnvios() {
  const { data: envios } = await db
    .from('envios')
    .select(`
      id, numero, estado, vehiculo,
      fecha_salida, fecha_llegada,
      perfiles ( nombre_completo )
    `)
    .order('created_at', { ascending: false })
    .limit(20)

  const html = envios && envios.length > 0
    ? `<table class="tabla">
        <thead>
          <tr>
            <th>#</th><th>Repartidor</th><th>Vehículo</th>
            <th>Estado</th><th>Salida</th><th>Llegada</th>
          </tr>
        </thead>
        <tbody>
          ${envios.map(e => `
            <tr>
              <td><b>#${e.numero}</b></td>
              <td>${e.perfiles?.nombre_completo || '-'}</td>
              <td>${e.vehiculo || '-'}</td>
              <td>${badgeEnvio(e.estado)}</td>
              <td>${e.fecha_salida ? formatFecha(e.fecha_salida) : '-'}</td>
              <td>${e.fecha_llegada ? formatFecha(e.fecha_llegada) : '⏳ En camino'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<p style="color:#888;padding:20px">No hay envíos registrados</p>'

  document.getElementById('lista-envios').innerHTML = html
}

async function cargarClientes() {
  const { data: clientes } = await db
    .from('clientes')
    .select('id, codigo, razon_social, telefono, localidad, activo')
    .order('razon_social')

  const html = clientes && clientes.length > 0
    ? `<table class="tabla">
        <thead>
          <tr>
            <th>Código</th><th>Razón social</th>
            <th>Teléfono</th><th>Localidad</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${clientes.map(c => `
            <tr>
              <td>${c.codigo}</td>
              <td><b>${c.razon_social}</b></td>
              <td>${c.telefono || '-'}</td>
              <td>${c.localidad || '-'}</td>
              <td>
                <span class="badge ${c.activo ? 'badge-verde' : 'badge-rojo'}">
                  ${c.activo ? 'Activo' : 'Inactivo'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<p style="color:#888;padding:20px">No hay clientes cargados</p>'

  document.getElementById('lista-clientes').innerHTML = html
}

async function cargarProductos() {
  const { data: productos } = await db
    .from('productos')
    .select('id, codigo, descripcion, precio_1, unidad, activo')
    .order('descripcion')

  const html = productos && productos.length > 0
    ? `<table class="tabla">
        <thead>
          <tr>
            <th>Código</th><th>Descripción</th>
            <th>Precio</th><th>Unidad</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${productos.map(p => `
            <tr>
              <td>${p.codigo}</td>
              <td><b>${p.descripcion}</b></td>
              <td>$${Number(p.precio_1).toLocaleString('es-AR')}</td>
              <td>${p.unidad}</td>
              <td>
                <span class="badge ${p.activo ? 'badge-verde' : 'badge-rojo'}">
                  ${p.activo ? 'Activo' : 'Inactivo'}
                </span>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<p style="color:#888;padding:20px">No hay productos cargados</p>'

  document.getElementById('lista-productos').innerHTML = html
}

function nuevoPedido()   { alert('🚧 Próximamente') }
function nuevoEnvio()    { alert('🚧 Próximamente') }
function nuevoCliente()  { alert('🚧 Próximamente') }
function nuevoProducto() { alert('🚧 Próximamente') }

function formatFecha(fecha) {
  if (!fecha) return '-'
  return new Date(fecha).toLocaleDateString('es-AR')
}

function badgeEstado(estado) {
  const colores = {
    borrador: 'badge-gris', confirmado: 'badge-azul',
    en_camino: 'badge-amarillo', entregado: 'badge-verde', cancelado: 'badge-rojo'
  }
  return `<span class="badge ${colores[estado] || 'badge-gris'}">${estado}</span>`
}

function badgeCobro(estado) {
  const colores = {
    pendiente: 'badge-amarillo',
    cobrado_efectivo: 'badge-verde', cobrado_transferencia: 'badge-verde',
    cobrado_cheque: 'badge-verde', cobrado_tarjeta: 'badge-verde',
    incobrable: 'badge-rojo'
  }
  const labels = {
    pendiente: 'Pendiente', cobrado_efectivo: 'Efectivo',
    cobrado_transferencia: 'Transferencia', cobrado_cheque: 'Cheque',
    cobrado_tarjeta: 'Tarjeta', incobrable: 'Incobrable'
  }
  return `<span class="badge ${colores[estado] || 'badge-gris'}">${labels[estado] || estado}</span>`
}

function badgeEnvio(estado) {
  const colores = {
    preparando: 'badge-gris', en_camino: 'badge-amarillo', entregado: 'badge-verde'
  }
  return `<span class="badge ${colores[estado] || 'badge-gris'}">${estado}</span>`
}
