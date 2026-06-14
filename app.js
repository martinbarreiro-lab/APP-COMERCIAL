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

  // Configurar interfaz según el rol del usuario
  await configurarInterfazPorRol()

  mostrarSeccion('dashboard')
  iniciarSistemaAlertas()
}

// Oculta/muestra secciones según el rol
async function configurarInterfazPorRol() {
  const rol = await cargarRolUsuario()
  const esCliente = rol === 'cliente'

  // Secciones que el CLIENTE NO ve: clientes (otros), reportes, configuración
  const ocultarParaCliente = ['clientes', 'reportes', 'configuracion']

  if (esCliente) {
    // Ocultar del sidebar de escritorio
    ocultarParaCliente.forEach(sec => {
      const nav = document.getElementById('nav-' + sec)
      if (nav) nav.style.display = 'none'
    })
    // Ocultar de la hoja "Más" móvil los items que no corresponden
    document.querySelectorAll('.mobile-more-item').forEach(item => {
      const txt = item.textContent.toLowerCase()
      if (txt.includes('cliente') || txt.includes('reporte')) {
        item.style.display = 'none'
      }
    })
    // El título del dashboard del cliente será distinto (se maneja en cargarDashboard)
    document.body.classList.add('rol-cliente')
  } else {
    document.body.classList.remove('rol-cliente')
  }
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
  if (nombre === 'logistica') cargarLogistica()
  if (nombre === 'problemas') cargarProblemas()
  if (nombre === 'clientes')  cargarClientes()
  if (nombre === 'productos') cargarProductos()
  if (nombre === 'reportes')  cargarReportes()
}

// ── DASHBOARD ────────────────────────────────────
async function cargarDashboard() {
  const rol     = await cargarRolUsuario()
  const esAdmin = rol === 'admin'

  // El cliente tiene su propio inicio
  if (rol === 'cliente') {
    return cargarInicioCliente()
  }

  const hoy       = new Date()
  const hoyStr    = hoy.toISOString().split('T')[0]
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString()
  const inicioMesAnt = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1).toISOString()
  const finMesAnt    = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59).toISOString()
  const en7dias   = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0]

  // ── Queries en paralelo ─────────────────────────
  let qPedidosMes    = db.from('pedidos').select('id, total, etapa, estado_cobro, monto_cobrado, vendedor_id, created_at').gte('created_at', inicioMes).neq('estado', 'cancelado')
  let qPedidosMesAnt = db.from('pedidos').select('id, total, vendedor_id').gte('created_at', inicioMesAnt).lte('created_at', finMesAnt).neq('estado', 'cancelado')
  let qCobrosMes     = db.from('cobros').select('monto, medio_pago, vendedor_id').gte('created_at', inicioMes)
  let qTodosActivos  = db.from('pedidos').select('id, total, etapa').neq('estado', 'cancelado').not('etapa', 'eq', 'cobrado')
  let qDeudaTotal    = db.from('pedidos').select('id, total, monto_cobrado, clientes(razon_social)').eq('estado_cobro', 'pendiente')
  let qVencidos      = db.from('pedidos').select('id, numero, total, monto_cobrado, fecha_vencimiento_cobro, clientes(razon_social)').eq('estado_cobro', 'pendiente').lt('fecha_vencimiento_cobro', hoyStr)
  let qPorVencer     = db.from('pedidos').select('id, numero, total, monto_cobrado, fecha_vencimiento_cobro, clientes(razon_social)').eq('estado_cobro', 'pendiente').gte('fecha_vencimiento_cobro', hoyStr).lte('fecha_vencimiento_cobro', en7dias)
  let qAtascados     = db.from('pedidos').select('id, numero, clientes(razon_social), created_at').eq('etapa', 'facturado').lte('created_at', new Date(Date.now() - 3 * 86400000).toISOString())
  let qAlertas       = db.from('notificaciones_admin').select('id').eq('leida', false)
  let qVendedores    = esAdmin ? db.from('perfiles').select('id, nombre_completo').neq('rol', 'cliente') : null

  if (!esAdmin) {
    qPedidosMes    = qPedidosMes.eq('vendedor_id', usuarioActual.id)
    qPedidosMesAnt = qPedidosMesAnt.eq('vendedor_id', usuarioActual.id)
    qCobrosMes     = qCobrosMes.eq('vendedor_id', usuarioActual.id)
    qTodosActivos  = qTodosActivos.eq('vendedor_id', usuarioActual.id)
    qDeudaTotal    = qDeudaTotal.eq('vendedor_id', usuarioActual.id)
    qVencidos      = qVencidos.eq('vendedor_id', usuarioActual.id)
    qPorVencer     = qPorVencer.eq('vendedor_id', usuarioActual.id)
    qAtascados     = qAtascados.eq('vendedor_id', usuarioActual.id)
  }

  const [
    { data: pedidosMes },
    { data: pedidosMesAnt },
    { data: cobrosMes },
    { data: todosActivos },
    { data: deudaTotal },
    { data: vencidos },
    { data: porVencer },
    { data: atascados },
    { data: alertasPend },
    vendedoresRes
  ] = await Promise.all([
    qPedidosMes, qPedidosMesAnt, qCobrosMes, qTodosActivos,
    qDeudaTotal, qVencidos, qPorVencer, qAtascados, qAlertas,
    qVendedores ? qVendedores : Promise.resolve({ data: [] })
  ])

  // ── Métricas ────────────────────────────────────
  const facturadoMes    = pedidosMes?.reduce((s, p) => s + Number(p.total), 0) || 0
  const facturadoMesAnt = pedidosMesAnt?.reduce((s, p) => s + Number(p.total), 0) || 0
  const cobradoMes      = cobrosMes?.reduce((s, c) => s + Number(c.monto), 0) || 0
  const pedidosMesCount = pedidosMes?.length || 0
  const cobrosMesCount  = cobrosMes?.length || 0

  const deudaAcum = (deudaTotal || []).reduce((s, p) => s + (Number(p.total) - Number(p.monto_cobrado || 0)), 0)
  const clientesDeudores = new Set((deudaTotal || []).map(p => p.clientes?.razon_social).filter(Boolean)).size

  const ticketProm    = pedidosMesCount > 0 ? Math.round(facturadoMes / pedidosMesCount) : 0
  const ticketPromAnt = pedidosMesAnt?.length > 0 ? Math.round(facturadoMesAnt / pedidosMesAnt.length) : 0
  const ticketDelta   = ticketPromAnt > 0 ? Math.round(((ticketProm - ticketPromAnt) / ticketPromAnt) * 100) : null

  // ── Pipeline — todos los activos ────────────────
  const pipelineAll = {}
  for (const e of ['pedido','facturado','enviado','recibido','cobrado']) {
    const grupo = (todosActivos || []).filter(p => p.etapa === e)
    pipelineAll[e] = { count: grupo.length, monto: grupo.reduce((s, p) => s + Number(p.total), 0) }
  }
  // cobrado del mes (para mostrar en pipeline, no de activos)
  const cobradosPipeline = (pedidosMes || []).filter(p => p.etapa === 'cobrado')
  pipelineAll['cobrado'] = { count: cobradosPipeline.length, monto: cobradosPipeline.reduce((s,p) => s+Number(p.total),0) }

  // ── Medios de pago ──────────────────────────────
  const medios = {}
  for (const c of (cobrosMes || [])) {
    medios[c.medio_pago] = (medios[c.medio_pago] || 0) + Number(c.monto)
  }
  const maxMedio = Math.max(...Object.values(medios), 1)
  const mediosIconos = { efectivo:'💵', transferencia:'🏦', cheque:'📋', echeq:'📱' }

  // ── Ranking vendedores ──────────────────────────
  let rankingHTML = ''
  if (esAdmin && vendedoresRes.data?.length > 0) {
    const ranking = vendedoresRes.data.map(v => {
      const peds = (pedidosMes || []).filter(p => p.vendedor_id === v.id)
      const cobs = (cobrosMes || []).filter(c => c.vendedor_id === v.id)
      const fac  = peds.reduce((s,p) => s+Number(p.total), 0)
      const cob  = cobs.reduce((s,c) => s+Number(c.monto), 0)
      const pct  = fac > 0 ? Math.round((cob/fac)*100) : 0
      return { nombre: v.nombre_completo, pedidos: peds.length, facturado: fac, cobrado: cob, pct }
    }).filter(v => v.pedidos > 0).sort((a,b) => b.facturado - a.facturado)

    if (ranking.length > 0) {
      rankingHTML = `
        <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:16px;margin-bottom:20px">
          <div style="font-size:11px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:14px;display:flex;align-items:center;gap:6px"><i class="ti ti-users" aria-hidden="true"></i> Rendimiento por vendedor — este mes</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead>
              <tr style="color:var(--color-text-tertiary);text-align:left;border-bottom:0.5px solid var(--color-border-tertiary)">
                <th style="padding:6px 0;font-weight:500">Vendedor</th>
                <th style="padding:6px 0;font-weight:500;text-align:right">Pedidos</th>
                <th style="padding:6px 0;font-weight:500;text-align:right">Facturado</th>
                <th style="padding:6px 0;font-weight:500;text-align:right">Cobrado</th>
              </tr>
            </thead>
            <tbody>
              ${ranking.map((v, i) => {
                const badge = v.pct >= 50
                  ? `<span style="background:#e1f5ee;color:#085041;border-radius:6px;font-size:11px;padding:2px 8px;white-space:nowrap">${fmtM(v.cobrado)}</span>`
                  : `<span style="background:#faeeda;color:#633806;border-radius:6px;font-size:11px;padding:2px 8px;white-space:nowrap">${fmtM(v.cobrado)}</span>`
                return `
                  <tr style="border-top:0.5px solid var(--color-border-tertiary)">
                    <td style="padding:10px 0">
                      <div style="display:flex;align-items:center;gap:8px">
                        <span style="background:#e1f5ee;color:#085041;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:500;flex-shrink:0">${i+1}</span>
                        ${v.nombre}
                      </div>
                    </td>
                    <td style="text-align:right;padding:10px 0">${v.pedidos}</td>
                    <td style="text-align:right;padding:10px 0;font-weight:500">${fmtM(v.facturado)}</td>
                    <td style="text-align:right;padding:10px 0">${badge}</td>
                  </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>`
    }
  }

  // ── Alertas ─────────────────────────────────────
  const alertasHTML = renderDashAlertas(vencidos, porVencer, atascados, alertasPend)

  // ── Medios HTML ─────────────────────────────────
  const mediosHTML = Object.keys(medios).length > 0
    ? Object.entries(medios).sort((a,b) => b[1]-a[1]).map(([m, v]) => `
        <div style="padding:8px 0;border-bottom:0.5px solid var(--color-border-tertiary)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
            <span style="font-size:13px">${mediosIconos[m]||'•'} ${labelMedio(m)}</span>
            <span style="font-size:13px;font-weight:500">${fmtM(v)}</span>
          </div>
          <div style="height:4px;background:var(--color-border-tertiary);border-radius:2px">
            <div style="height:4px;background:#378add;border-radius:2px;width:${Math.round((v/maxMedio)*100)}%"></div>
          </div>
        </div>`).join('')
    : '<p style="font-size:13px;color:var(--color-text-tertiary)">Sin cobros este mes</p>'

  // ── Pipeline HTML ────────────────────────────────
  const etapasDef = [
    { id:'pedido',    label:'Pedido',    color:'#888780', icono:'ti-package' },
    { id:'facturado', label:'Facturado', color:'#378add', icono:'ti-file-invoice' },
    { id:'enviado',   label:'Enviado',   color:'#1d9e75', icono:'ti-truck' },
    { id:'recibido',  label:'Recibido',  color:'#ba7517', icono:'ti-hand-stop' },
    { id:'cobrado',   label:'Cobrado',   color:'#1d9e75', icono:'ti-circle-check' },
  ]
  const pipelineHTML = etapasDef.map((e, idx) => `
    <div style="flex:1;text-align:center;padding:16px 8px${idx < 4 ? ';border-right:0.5px solid var(--color-border-tertiary)' : ''}">
      <i class="ti ${e.icono}" style="font-size:20px;color:${pipelineAll[e.id].count > 0 ? e.color : 'var(--color-border-tertiary)'};display:block;margin-bottom:6px" aria-hidden="true"></i>
      <div style="font-size:24px;font-weight:500;color:${pipelineAll[e.id].count > 0 ? e.color : 'var(--color-text-tertiary)'}">
        ${pipelineAll[e.id].count}
      </div>
      <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:3px">${e.label}</div>
      ${pipelineAll[e.id].monto > 0 ? `<div style="font-size:11px;color:var(--color-text-secondary);margin-top:5px">${fmtM(pipelineAll[e.id].monto)}</div>` : ''}
    </div>`).join('')

  // ── Ticket delta HTML ────────────────────────────
  const ticketSubHTML = ticketDelta !== null
    ? `<span style="color:${ticketDelta >= 0 ? '#1d9e75' : '#e24b4a'};font-size:12px">
        ${ticketDelta >= 0 ? '↑' : '↓'} ${Math.abs(ticketDelta)}% vs mes ant.
      </span>`
    : 'sin datos anteriores'

  const nombreMes = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

  // ── Render ───────────────────────────────────────
  document.getElementById('dash-root').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="margin:0;font-size:18px;font-weight:500">Dashboard</h2>
      <span style="font-size:12px;color:var(--color-text-tertiary);text-transform:capitalize">${nombreMes}</span>
    </div>

    ${alertasHTML}

    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:16px">
      ${dashMetrica('ti-chart-bar', 'Facturado este mes', fmtM(facturadoMes), pedidosMesCount + ' pedidos', '#378add')}
      ${dashMetrica('ti-circle-check', 'Cobrado este mes', fmtM(cobradoMes), cobrosMesCount + ' cobros', '#1d9e75')}
      <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:16px;border-top:3px solid #e24b4a">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <i class="ti ti-hourglass" style="font-size:14px;color:#e24b4a" aria-hidden="true"></i>
          <span style="font-size:12px;color:var(--color-text-secondary)">Deuda total acumulada</span>
        </div>
        <div style="font-size:24px;font-weight:500;color:#e24b4a;line-height:1">${fmtM(deudaAcum)}</div>
        <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:5px">${clientesDeudores} cliente${clientesDeudores !== 1 ? 's' : ''}</div>
      </div>
      <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:16px;border-top:3px solid #ba7517">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <i class="ti ti-receipt" style="font-size:14px;color:#ba7517" aria-hidden="true"></i>
          <span style="font-size:12px;color:var(--color-text-secondary)">Ticket promedio</span>
        </div>
        <div style="font-size:24px;font-weight:500;line-height:1">${fmtM(ticketProm)}</div>
        <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:5px">${ticketSubHTML}</div>
      </div>
    </div>

    <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:16px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:14px;display:flex;align-items:center;gap:6px"><i class="ti ti-git-branch" aria-hidden="true"></i> Pipeline — todos los pedidos activos</div>
      <div style="display:flex;margin:0 -16px -14px">
        ${pipelineHTML}
      </div>
    </div>

    <div style="display:grid;grid-template-columns:${esAdmin ? '1fr 2fr' : '1fr'};gap:12px;margin-bottom:16px">
      <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:16px">
        <div style="font-size:11px;font-weight:500;color:var(--color-text-secondary);text-transform:uppercase;letter-spacing:.04em;margin-bottom:14px;display:flex;align-items:center;gap:6px"><i class="ti ti-cash" aria-hidden="true"></i> Cobros por medio — este mes</div>
        ${mediosHTML}
      </div>
      ${esAdmin ? rankingHTML.replace('style="margin-bottom:20px"', 'style="margin-bottom:0"') : ''}
    </div>

    ${!esAdmin ? rankingHTML : ''}
  `
}

function dashMetrica(icono, label, valor, sub, color) {
  return `
    <div style="background:var(--color-background-primary);border:0.5px solid var(--color-border-tertiary);border-radius:12px;padding:16px;border-top:3px solid ${color}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <i class="ti ${icono}" style="font-size:14px;color:${color}" aria-hidden="true"></i>
        <span style="font-size:12px;color:var(--color-text-secondary)">${label}</span>
      </div>
      <div style="font-size:24px;font-weight:500;color:var(--color-text-primary);line-height:1">${valor}</div>
      <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:5px">${sub}</div>
    </div>`
}

// ── INICIO DEL CLIENTE ───────────────────────────
async function cargarInicioCliente() {
  const clienteId = clienteIdUsuario
  const cont = document.getElementById('dash-root')
  if (!clienteId) {
    cont.innerHTML = '<p class="vacio">No se encontró tu cuenta de cliente. Contactá a la empresa.</p>'
    return
  }
  cont.innerHTML = '<p style="color:var(--color-text-tertiary);font-size:13px;padding:20px;text-align:center">Cargando...</p>'

  // Nombre del cliente
  const { data: cli } = await db.from('clientes').select('razon_social, saldo_pendiente').eq('id', clienteId).single()

  // Pedidos del cliente (activos)
  const { data: pedidos } = await db.from('pedidos')
    .select('id, numero, total, etapa, estado, estado_cobro, fecha_pedido, created_at, fecha_vencimiento_cobro')
    .eq('cliente_id', clienteId).not('etapa','eq','cancelado')
    .order('created_at', { ascending: false }).limit(30)

  const todos = pedidos || []
  // Pedidos por recibir (enviados, no recibidos aún)
  const porRecibir = todos.filter(p => p.etapa === 'enviado')
  // Pedidos en curso (no cobrados/finalizados)
  const enCurso = todos.filter(p => p.etapa !== 'cobrado' && p.estado !== 'cancelado').slice(0, 6)
  // Deuda
  const deuda = Number(cli?.saldo_pendiente || 0)
  // Próximo vencimiento
  const conVenc = todos.filter(p => p.fecha_vencimiento_cobro && (p.estado_cobro === 'pendiente' || !p.estado_cobro))
    .sort((a,b) => new Date(a.fecha_vencimiento_cobro) - new Date(b.fecha_vencimiento_cobro))
  const proxVenc = conVenc[0]?.fecha_vencimiento_cobro

  cont.innerHTML = `
    <div style="margin-bottom:6px">
      <div style="font-size:18px;font-weight:600;color:var(--color-marca-oscuro)">Hola, ${cli?.razon_social || 'Cliente'}</div>
      <div style="font-size:12px;color:var(--color-text-tertiary)">Bienvenido</div>
    </div>

    <button onclick="navMovil('pedidos'); setTimeout(()=>nuevoPedido(),100)" class="btn-cliente-pedir">
      <i class="ti ti-plus" aria-hidden="true"></i> Hacer un pedido
    </button>

    ${porRecibir.length > 0 ? `
      <div class="cli-bloque-t">PEDIDOS POR RECIBIR</div>
      ${porRecibir.map(p => `
        <div class="cli-alert-recibir">
          <div class="cli-alert-top"><i class="ti ti-truck" aria-hidden="true"></i> Pedido #${p.numero} llegó — confirmá la recepción</div>
          <button onclick="navMovil('logistica')" class="cli-btn-confirmar"><i class="ti ti-circle-check" aria-hidden="true"></i> Ir a confirmar recepción</button>
        </div>`).join('')}` : ''}

    <div class="cli-bloque-t">MI CUENTA</div>
    <div class="cli-deuda-card" onclick="navMovil('cobranza')">
      <div>
        <div style="font-size:10px;color:var(--color-text-tertiary)">Saldo pendiente</div>
        <div style="font-size:19px;font-weight:700;color:${deuda > 0 ? '#e24b4a' : '#1d9e75'}">${fmtM(deuda)}</div>
        ${proxVenc ? `<div style="font-size:10px;color:#ba7517;margin-top:3px">Vence el ${formatFecha(proxVenc)}</div>` : ''}
      </div>
      <i class="ti ti-chevron-right" style="color:#ccc;font-size:20px" aria-hidden="true"></i>
    </div>

    <div class="cli-bloque-t">MIS PEDIDOS EN CURSO</div>
    ${enCurso.length === 0 ? '<p class="vacio">No tenés pedidos en curso</p>' : enCurso.map(p => `
      <div class="cli-ped-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:13px;font-weight:600">#${p.numero} · ${formatFecha(p.fecha_pedido||p.created_at)}</span>
          <span style="font-size:13px;font-weight:600;color:var(--color-marca-oscuro)">${fmtM(p.total)}</span>
        </div>
        ${renderTrackCliente(p)}
      </div>`).join('')}`
}

// Estado simplificado para el cliente
function estadoClienteSimple(p) {
  // pendiente_aprobacion -> Pendiente; confirmado/facturado -> Aceptado; enviado -> En camino; recibido/cobrado -> Entregado
  if (p.estado === 'pendiente_aprobacion') return 0  // Pendiente
  if (p.etapa === 'enviado') return 2                 // En camino
  if (p.etapa === 'recibido' || p.etapa === 'cobrado') return 3 // Entregado
  return 1                                            // Aceptado (confirmado/facturado)
}

function renderTrackCliente(p) {
  const paso = estadoClienteSimple(p)
  const pasos = ['Pedido', 'Aceptado', 'En camino', 'Entregado']
  // El "Pendiente" se muestra distinto
  if (paso === 0) {
    return `<div style="font-size:11px;color:#633806;background:#faeeda;border-radius:8px;padding:7px 10px">🕐 Pendiente — esperando que la empresa lo acepte</div>`
  }
  return `<div class="cli-track">
    ${pasos.map((label, i) => `
      <div class="cli-track-paso">
        ${i > 0 ? `<div class="cli-track-linea ${i <= paso ? 'ok' : ''}"></div>` : ''}
        <div class="cli-track-dot ${i < paso ? 'ok' : (i === paso ? 'now' : '')}">${i < paso ? '✓' : (i+1)}</div>
        <div class="cli-track-label ${i === paso ? 'now' : ''}">${label}</div>
      </div>`).join('')}
  </div>`
}

function renderDashAlertas(vencidos, porVencer, atascados, alertasPend) {
  const items = []

  if (alertasPend?.length > 0) {
    items.push({
      color:'#e24b4a', bg:'#fcebeb', icono:'ti-alert-triangle',
      texto:`<b>${alertasPend.length} problema${alertasPend.length!==1?'s':''} de recepción sin responder</b>`,
      onclick:`onclick="mostrarSeccion('problemas')"`
    })
  }
  if (vencidos?.length > 0) {
    const total = vencidos.reduce((s,p) => s+(Number(p.total)-Number(p.monto_cobrado||0)), 0)
    items.push({
      color:'#e24b4a', bg:'#fcebeb', icono:'ti-calendar-x',
      texto:`<b>${vencidos.length} cobro${vencidos.length!==1?'s':''} vencido${vencidos.length!==1?'s':''} — ${fmtM(total)}</b><br>
        <span style="font-size:12px">${vencidos.slice(0,3).map(p=>`#${p.numero} · ${p.clientes?.razon_social}`).join(' · ')}${vencidos.length>3?' y más...':''}</span>`,
      onclick:`onclick="mostrarSeccion('cobranza')"`
    })
  }
  if (porVencer?.length > 0) {
    const total = porVencer.reduce((s,p) => s+(Number(p.total)-Number(p.monto_cobrado||0)), 0)
    items.push({
      color:'#ba7517', bg:'#faeeda', icono:'ti-clock',
      texto:`<b>${porVencer.length} cobro${porVencer.length!==1?'s':''} vencen en 7 días — ${fmtM(total)}</b><br>
        <span style="font-size:12px">${porVencer.slice(0,3).map(p=>`#${p.numero} · ${p.clientes?.razon_social} · ${formatFecha(p.fecha_vencimiento_cobro)}`).join('<br>')}</span>`,
      onclick:`onclick="mostrarSeccion('cobranza')"`
    })
  }
  if (atascados?.length > 0) {
    items.push({
      color:'#378add', bg:'#e3f2fd', icono:'ti-alert-triangle',
      texto:`<b>${atascados.length} pedido${atascados.length!==1?'s':''} facturado${atascados.length!==1?'s':''} sin enviar hace +3 días</b><br>
        <span style="font-size:12px">${atascados.slice(0,3).map(p=>`#${p.numero} · ${p.clientes?.razon_social}`).join(' · ')}</span>`,
      onclick:`onclick="mostrarSeccion('logistica')"`
    })
  }

  if (items.length === 0) return `
    <div style="background:#e1f5ee;border-radius:10px;padding:10px 14px;margin-bottom:14px;display:flex;align-items:center;gap:8px;font-size:13px;color:#085041">
      <i class="ti ti-circle-check" style="font-size:15px" aria-hidden="true"></i>
      Todo al día — sin alertas urgentes
    </div>`

  return items.map(a => `
    <div ${a.onclick} style="background:${a.bg};border:1px solid ${a.color}40;border-left:4px solid ${a.color};border-radius:10px;padding:12px 14px;margin-bottom:10px;display:flex;align-items:flex-start;gap:10px;font-size:13px;color:${a.color};cursor:pointer">
      <i class="ti ${a.icono}" style="font-size:15px;margin-top:1px;flex-shrink:0" aria-hidden="true"></i>
      <div>${a.texto}</div>
    </div>`).join('')
}

function fmtM(n) {
  return '$' + Number(n||0).toLocaleString('es-AR', { minimumFractionDigits:0, maximumFractionDigits:0 })
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
        <div class="cliente-tel"><i class="ti ti-phone" aria-hidden="true"></i> ${c.telefono || 'Sin teléfono'}
          ${waLink(c.telefono) ? `<a href="${waLink(c.telefono)}" onclick="event.stopPropagation()" target="_blank" class="btn-whatsapp-texto"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i> WhatsApp</a>` : ''}
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
      <div class="ficha-fila"><span>Teléfono</span><span>${c.telefono || '-'} ${waLink(c.telefono) ? `<a href="${waLink(c.telefono)}" target="_blank" class="btn-whatsapp"><i class="ti ti-brand-whatsapp" aria-hidden="true"></i></a>` : ''}</span></div>
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
function nuevoEnvio()    { alert('🚧 Próximamente') }
function nuevoProducto() { alert('🚧 Próximamente') }

// ── HELPERS ──────────────────────────────────────
function formatFecha(f) { if (!f) return '-'; return new Date(f).toLocaleDateString('es-AR') }
function formatFechaHora(f) { if (!f) return '-'; return new Date(f).toLocaleString('es-AR', { dateStyle:'short', timeStyle:'short' }) }

// Arma el número correcto de WhatsApp para Argentina (formato 549 + área + número)
function waLink(telefono) {
  if (!telefono) return null
  let n = String(telefono).replace(/\D/g, '')   // solo dígitos
  if (!n) return null
  // Quitar 0 inicial (código de área largo) y 15 (celular local)
  if (n.startsWith('54')) n = n.slice(2)          // quitar país si ya viene
  if (n.startsWith('0'))  n = n.slice(1)          // quitar 0 inicial
  // Si tiene un 15 después del código de área (ej: 341 15 1234567), quitarlo
  n = n.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2')
  // Si quedó muy corto, no es válido
  if (n.length < 8) return null
  return `https://wa.me/549${n}`
}
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
  const i = { pedido_creado:'📦', documento_subido:'📄', cobro_registrado:'💰', estado_cambiado:'🔄', pedido_cerrado:'✅', recepcion_ok:'✅', recepcion_problema:'⚠️' }
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
let clienteIdUsuario = null   // cliente_id del usuario si es un cliente

async function cargarRolUsuario() {
  if (rolUsuarioActual) return rolUsuarioActual
  const { data } = await db.from('perfiles').select('rol, cliente_id').eq('id', usuarioActual.id).single()
  rolUsuarioActual = data?.rol || 'vendedor'
  clienteIdUsuario = data?.cliente_id || null
  return rolUsuarioActual
}

// Devuelve el cliente_id si el usuario es cliente, sino null (admin/vendedor ven todo)
async function getClienteIdFiltro() {
  await cargarRolUsuario()
  return rolUsuarioActual === 'cliente' ? clienteIdUsuario : null
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

  const rol = await cargarRolUsuario()
  const clienteFiltro = await getClienteIdFiltro()

  let query = db.from('pedidos')
    .select('id, numero, total, estado, etapa, estado_cobro, alerta_vencimiento, fecha_vencimiento_cobro, fecha_pedido, created_at, updated_at, clientes(razon_social)')
    .not('etapa', 'eq', 'cancelado')
    .order('created_at', { ascending: false })
    .limit(200)

  // Filtrado por rol
  if (clienteFiltro) {
    query = query.eq('cliente_id', clienteFiltro)
  } else if (rol === 'vendedor') {
    query = query.eq('vendedor_id', usuarioActual.id)
  }

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
let _recibidoPedidoId = null
let _recibidoEstado   = null

function marcarRecibido(pedidoId) {
  _recibidoPedidoId = pedidoId
  _recibidoEstado   = null
  // Reset modal
  document.getElementById('mr-btn-ok').style.border        = '2px solid #e0e0e0'
  document.getElementById('mr-btn-problema').style.border  = '2px solid #e0e0e0'
  document.getElementById('mr-campo-problema').style.display = 'none'
  document.getElementById('mr-descripcion').value = ''
  document.getElementById('mr-foto').value = ''
  document.getElementById('mr-error').style.display = 'none'
  document.getElementById('mr-btn-confirmar').disabled = true
  const modal = document.getElementById('modal-recibido')
  modal.style.display = 'flex'
  modal.style.alignItems = 'center'
  modal.style.justifyContent = 'center'
}

function seleccionarEstadoRecepcion(estado) {
  _recibidoEstado = estado
  const btnOk     = document.getElementById('mr-btn-ok')
  const btnProb   = document.getElementById('mr-btn-problema')
  const campoProb = document.getElementById('mr-campo-problema')
  const btnConf   = document.getElementById('mr-btn-confirmar')

  if (estado === 'ok') {
    btnOk.style.border    = '2px solid #1d9e75'
    btnOk.style.background = '#e8f5e9'
    btnProb.style.border  = '2px solid #e0e0e0'
    btnProb.style.background = 'white'
    campoProb.style.display  = 'none'
    btnConf.disabled = false
    btnConf.textContent = '✅ Confirmar — Todo en orden'
  } else {
    btnProb.style.border  = '2px solid #ba7517'
    btnProb.style.background = '#faeeda'
    btnOk.style.border    = '2px solid #e0e0e0'
    btnOk.style.background = 'white'
    campoProb.style.display = 'block'
    btnConf.disabled = false
    btnConf.textContent = '⚠️ Confirmar con problema'
  }
}

function cerrarModalRecibido() {
  document.getElementById('modal-recibido').style.display = 'none'
  _recibidoPedidoId = null
  _recibidoEstado   = null
}

async function confirmarRecepcion() {
  if (!_recibidoPedidoId) {
    alert('Error: no hay pedido seleccionado. Cerrá y reintentá.')
    return
  }
  if (!_recibidoEstado) {
    alert('Seleccioná si llegó todo en orden o si hubo un problema.')
    return
  }

  const descripcion  = document.getElementById('mr-descripcion').value.trim()
  const foto         = document.getElementById('mr-foto').files[0]

  if (_recibidoEstado === 'problema' && !descripcion) {
    document.getElementById('mr-error').textContent = 'Describí qué pasó con el pedido'
    document.getElementById('mr-error').style.display = 'block'
    return
  }

  const todoOk       = _recibidoEstado === 'ok'
  const pedidoIdCopy = _recibidoPedidoId

  // Cerrar modal de inmediato
  cerrarModalRecibido()

  // Subir foto si hay
  let fotoUrl = null
  if (foto) {
    const ext  = foto.name.split('.').pop()
    const path = `recepcion/${pedidoIdCopy}_${Date.now()}.${ext}`
    const { error: upErr } = await db.storage.from('comprobantes').upload(path, foto, { upsert: true })
    if (!upErr) {
      const { data: ud } = db.storage.from('comprobantes').getPublicUrl(path)
      fotoUrl = ud.publicUrl
    }
  }

  // Actualizar etapa del pedido
  const { error: updErr } = await db.from('pedidos')
    .update({ etapa: 'recibido', updated_at: new Date().toISOString() })
    .eq('id', pedidoIdCopy)

  if (updErr) {
    console.error('Error update pedido:', updErr)
    alert('Error al guardar: ' + (updErr.message || JSON.stringify(updErr)))
    return
  }

  // Registrar en historial con todos los datos
  const detalleHistorial = todoOk
    ? `✅ Recepción confirmada — Todo en orden${fotoUrl ? ` | foto: ${fotoUrl}` : ''}`
    : `⚠️ Problema en recepción: ${descripcion}${fotoUrl ? ` | foto: ${fotoUrl}` : ''}`

  await db.from('historial_pedido').insert({
    pedido_id:  pedidoIdCopy,
    usuario_id: usuarioActual?.id,
    accion:     todoOk ? 'recepcion_ok' : 'recepcion_problema',
    detalle:    detalleHistorial
  }).catch(() => {})

  // Si hubo problema → notificar admin y vendedor
  if (!todoOk) {
    await db.from('notificaciones_admin').insert({
      tipo:      'problema_recepcion',
      mensaje:   `⚠️ Problema en recepción: ${descripcion}`,
      pedido_id: pedidoIdCopy,
      leida:     false
    }).catch(() => {})

    const { data: ped } = await db.from('pedidos')
      .select('vendedor_id, numero').eq('id', pedidoIdCopy).single()
    if (ped?.vendedor_id) {
      await db.from('notificaciones').insert({
        usuario_id: ped.vendedor_id,
        tipo:       'problema_recepcion',
        titulo:     `⚠️ Problema en Pedido #${ped.numero}`,
        mensaje:    `El cliente reportó un problema al recibir: ${descripcion}`,
        leida:      false
      }).catch(() => {})
    }
  }

  // Verificar si el envío quedó completamente entregado
  try {
    const { data: vinculos } = await db.from('envio_pedidos')
      .select('envio_id').eq('pedido_id', pedidoIdCopy)

    for (const v of (vinculos || [])) {
      const { data: pedidosEnvio } = await db.from('envio_pedidos')
        .select('pedidos(etapa)').eq('envio_id', v.envio_id)

      const todosRecibidos = pedidosEnvio?.length > 0 &&
        pedidosEnvio.every(pe => pe.pedidos?.etapa === 'recibido')

      if (todosRecibidos) {
        await marcarEnvioCompletado(v.envio_id)
      }

      // Recargar el detalle del envío que estaba abierto
      const detalleEl = document.getElementById(`detalle-envio-${v.envio_id}`)
      if (detalleEl && detalleEl.style.display !== 'none') {
        await cargarPedidosDeEnvio(v.envio_id)
      }
    }
  } catch (e) {
    console.error('Error actualizando envío:', e)
  }

  // Recargar stats y lista completa
  await renderStatsLogistica()
  await renderEnviosActivos()
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
    // Asegurar que tenemos el cliente_id (puede no estar cargado aún)
    let cid = clienteIdUsuario
    if (!cid) {
      const { data: perfil } = await db.from('perfiles').select('cliente_id').eq('id', usuarioActual.id).single()
      cid = perfil?.cliente_id || null
      clienteIdUsuario = cid
    }
    if (cid) {
      const { data: cli } = await db.from('clientes').select('*').eq('id', cid).single()
      if (cli) pedidoActual.cliente = cli
    }
    if (!pedidoActual.cliente) {
      alert('No se encontró tu cuenta de cliente. Avisá a la empresa para que la configure.')
      return
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

      <div class="form-seccion">FECHA Y ENTREGA</div>
      <div class="campo">
        <label>Fecha del pedido</label>
        <input type="date" id="pedido-fecha" value="${new Date().toISOString().split('T')[0]}" max="${new Date().toISOString().split('T')[0]}">
        <small style="color:var(--color-text-tertiary);font-size:11px;display:block;margin-top:4px">Cambiala si estás cargando un pedido de una fecha anterior</small>
      </div>
      <div class="campo">
        <label>Fecha de entrega</label>
        <input type="date" id="pedido-fecha-entrega">
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

  // Fecha del pedido (permite cargar pedidos anteriores). Por defecto hoy.
  const fechaPedidoInput = document.getElementById('pedido-fecha')?.value
  const hoyStr = new Date().toISOString().split('T')[0]
  const fechaPedidoStr = fechaPedidoInput || hoyStr
  // Si es una fecha pasada, usar mediodía de ese día; si es hoy, usar el momento actual
  const fechaPedidoISO = fechaPedidoStr === hoyStr
    ? new Date().toISOString()
    : new Date(fechaPedidoStr + 'T12:00:00').toISOString()

  if (Object.keys(pedidoActual.items).length === 0) {
    alert('No hay productos en el pedido'); return
  }

  // Estado según quién crea
  const estado = rol === 'cliente' ? 'pendiente_aprobacion' : 'confirmado'

  // Calcular vencimiento desde la fecha del pedido
  const diasVenc = cliente.dias_vencimiento || 7
  const baseVenc = fecha ? new Date(fecha) : new Date(fechaPedidoStr + 'T12:00:00')
  const fechaVenc = new Date(baseVenc.getTime() + diasVenc * 86400000).toISOString().split('T')[0]

  // Crear pedido
  const { data: pedido, error } = await db.from('pedidos').insert({
    cliente_id:              cliente.id,
    vendedor_id:             rol === 'cliente' ? null : usuarioActual.id,
    estado,
    fecha_pedido:            fechaPedidoStr,
    created_at:              fechaPedidoISO,
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

  let pedidoFinal = pedido
  if (error) {
    // Si falló (quizás created_at es de solo lectura), reintentar sin forzar created_at
    console.warn('Insert con created_at falló, reintentando sin él:', error.message)
    const r2 = await db.from('pedidos').insert({
      cliente_id:              cliente.id,
      vendedor_id:             rol === 'cliente' ? null : usuarioActual.id,
      estado,
      fecha_pedido:            fechaPedidoStr,
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
    if (r2.error) { alert('Error al guardar: ' + r2.error.message); return }
    pedidoFinal = r2.data
  }
  const pedido_ok = pedidoFinal

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
      pedido_id:       pedido_ok.id,
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
  await registrarHistorial(pedido_ok.id, 'pedido_creado',
    `Pedido creado por ${rol} — $${Number(t.total).toLocaleString('es-AR')}`)

  // Si lo creó un cliente, notificar a vendedor/empresa para que lo acepte
  if (rol === 'cliente') {
    await db.from('notificaciones_admin').insert({
      tipo: 'pedido_nuevo',
      mensaje: `Nuevo pedido #${pedido_ok.numero} de ${cliente.razon_social} para aceptar — $${Number(t.total).toLocaleString('es-AR')}`,
      pedido_id: pedido_ok.id,
      leida: false
    })
  }

  // Borrar borrador si había
  if (pedidoActual.borrador_id) {
    await db.from('pedidos').delete().eq('id', pedidoActual.borrador_id)
  }

  pedidoActual = { cliente: null, items: {}, borrador_id: null }

  if (rol === 'cliente') {
    alert('✅ Pedido enviado. La empresa lo revisará pronto.')
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

  // Notificar al cliente que su pedido fue aceptado
  const { data: p } = await db.from('pedidos').select('cliente_id, numero').eq('id', pedidoId).single()
  if (p?.cliente_id) {
    await db.from('notificaciones').insert({
      usuario_id: p.cliente_id,
      tipo: 'pedido_aceptado',
      titulo: '¡Pedido aceptado!',
      mensaje: `Tu pedido #${p.numero} fue aceptado. Lo estamos preparando.`,
      leida: false
    })
  }

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

  const clienteFiltro = await getClienteIdFiltro()

  // Query pedidos con cobros pendientes o cobrados
  let query = db.from('pedidos')
    .select(`id, numero, total, monto_cobrado, estado_cobro, etapa,
             fecha_vencimiento_cobro, fecha_pedido, vendedor_id,
             clientes(id, razon_social, telefono)`)
    .not('etapa', 'eq', 'cancelado')
    .order('fecha_vencimiento_cobro', { ascending: true, nullsFirst: false })

  // Filtrado por rol: cliente ve solo lo suyo, vendedor lo de sus clientes, admin todo
  if (clienteFiltro) {
    query = query.eq('cliente_id', clienteFiltro)
  } else if (rol === 'vendedor') {
    query = query.eq('vendedor_id', usuarioActual.id)
  }
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
          ${tel && rolUsuarioActual !== 'cliente' ? `<a href="${waLink(tel)}" target="_blank" class="btn-whatsapp" onclick="event.stopPropagation()">
            <i class="ti ti-brand-whatsapp" aria-hidden="true"></i>
          </a>` : ''}
          ${!esCobrado ? (rolUsuarioActual === 'cliente' ? `
            <button onclick="event.stopPropagation(); abrirInformarPago('${p.id}', '${(p.clientes?.razon_social || '').replace(/'/g,"\\'")}', ${pendiente})" class="btn-cobrar">
              <i class="ti ti-upload" aria-hidden="true"></i> Informar pago
            </button>` : `
            <button onclick="event.stopPropagation(); abrirModalCobro('${p.id}', '${(p.clientes?.razon_social || '').replace(/'/g,"\\'")}', ${pendiente})" class="btn-cobrar">
              <i class="ti ti-cash" aria-hidden="true"></i> Cobrar
            </button>`) : `<button onclick="descargarPDF('${p.id}')" class="btn-secundario" style="font-size:12px;padding:6px 12px">
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
    ...clientes.map(c => `<div onclick="seleccionarCobCliente('${c.id}','${c.razon_social.replace(/'/g,"\\'")}')" class="cob-dropdown-item">${c.razon_social}</div>`)
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
    ..._cobVendedoresCache.map(v => `<div onclick="seleccionarCobVendedor('${v.id}','${v.nombre_completo.replace(/'/g,"\\'")}')" class="cob-dropdown-item">${v.nombre_completo}</div>`)
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


// ================================================
// LA CABAÑA — Módulo de Logística
// ================================================

let _envioActual = { pedidos: [] }

// ── CARGAR LOGÍSTICA ─────────────────────────────
async function cargarLogistica() {
  const rol = await cargarRolUsuario()
  const esCliente = rol === 'cliente'

  // El cliente NO ve stats internas ni "pedidos para enviar" (eso es gestión)
  const statsEl = document.getElementById('log-stats')
  const enviarEl = document.getElementById('log-pedidos-para-enviar')
  if (esCliente) {
    if (statsEl) statsEl.style.display = 'none'
    if (enviarEl) enviarEl.style.display = 'none'
    await renderEnviosActivos()
  } else {
    if (statsEl) statsEl.style.display = ''
    if (enviarEl) enviarEl.style.display = ''
    await Promise.all([
      renderStatsLogistica(),
      renderPedidosParaEnviar(),
      renderEnviosActivos()
    ])
  }
}

// ── STATS ────────────────────────────────────────
async function renderStatsLogistica() {
  const hoy = new Date().toISOString().split('T')[0]

  const [{ data: enCamino }, { data: entregadosHoy }, { data: sinAsignar }] = await Promise.all([
    db.from('envios').select('id').eq('estado', 'en_camino'),
    db.from('pedidos').select('id').eq('etapa', 'recibido').gte('updated_at', hoy),
    db.from('pedidos').select('id').eq('etapa', 'facturado')
  ])

  document.getElementById('log-stats').innerHTML = `
    <div class="cob-stats-grid">
      <div class="cob-stat-card">
        <div class="cob-stat-label">En camino</div>
        <div class="cob-stat-num">${enCamino?.length || 0}</div>
        <div class="cob-stat-sub">envíos activos</div>
      </div>
      <div class="cob-stat-card">
        <div class="cob-stat-label">Entregados hoy</div>
        <div class="cob-stat-num">${entregadosHoy.length}</div>
        <div class="cob-stat-sub">pedidos</div>
      </div>
      <div class="cob-stat-card ${sinAsignar?.length > 0 ? 'rojo' : ''}">
        <div class="cob-stat-label">Sin asignar</div>
        <div class="cob-stat-num ${sinAsignar?.length > 0 ? 'rojo' : ''}">${sinAsignar?.length || 0}</div>
        <div class="cob-stat-sub ${sinAsignar?.length > 0 ? 'rojo' : ''}">pedidos facturados</div>
      </div>
    </div>`
}

// ── PEDIDOS LISTOS PARA ENVIAR ───────────────────
async function renderPedidosParaEnviar() {
  const { data: pedidos } = await db.from('pedidos')
    .select('id, numero, total, etapa, clientes(razon_social)')
    .eq('etapa', 'facturado')
    .order('created_at', { ascending: true })

  const el = document.getElementById('log-pedidos-para-enviar')
  if (!pedidos || pedidos.length === 0) {
    el.innerHTML = '<p class="vacio">No hay pedidos facturados pendientes de envío</p>'
    return
  }

  el.innerHTML = pedidos.map(p => {
    const enEnvio = _envioActual.pedidos.includes(p.id)
    return `
      <div class="log-pedido-card ${enEnvio ? 'seleccionado' : ''}" id="log-card-${p.id}">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="font-size:14px;font-weight:500">#${p.numero} · ${p.clientes?.razon_social || '-'}</span>
            <span class="badge badge-azul">Facturado</span>
          </div>
          <div style="font-size:13px;color:var(--color-text-secondary)">
            $${Number(p.total).toLocaleString('es-AR')}
          </div>
        </div>
        ${enEnvio
          ? `<button onclick="quitarDeEnvio('${p.id}')" class="log-btn-quitar">
              <i class="ti ti-minus" aria-hidden="true"></i> Quitar
             </button>`
          : `<button onclick="agregarAEnvio('${p.id}')" class="log-btn-agregar">
              <i class="ti ti-plus" aria-hidden="true"></i> Agregar
             </button>`
        }
      </div>`
  }).join('')

  actualizarBotonesEnvio()
}

// ── GESTIÓN DEL NUEVO ENVÍO ──────────────────────
function agregarAEnvio(pedidoId) {
  if (!_envioActual.pedidos.includes(pedidoId)) {
    _envioActual.pedidos.push(pedidoId)
  }
  renderPedidosParaEnviar()
}

function quitarDeEnvio(pedidoId) {
  _envioActual.pedidos = _envioActual.pedidos.filter(id => id !== pedidoId)
  renderPedidosParaEnviar()
}

function actualizarBotonesEnvio() {
  const barra = document.getElementById('log-barra-envio')
  const cant  = _envioActual.pedidos.length
  if (!barra) return

  barra.style.display = cant > 0 ? 'flex' : 'none'
  barra.innerHTML = `
    <span style="font-size:14px;font-weight:500">
      <i class="ti ti-truck" style="margin-right:6px" aria-hidden="true"></i>
      ${cant} pedido${cant !== 1 ? 's' : ''} seleccionado${cant !== 1 ? 's' : ''}
    </span>
    <div style="display:flex;gap:8px">
      <button onclick="limpiarEnvioActual()" class="btn-cancelar">Cancelar</button>
      <button onclick="confirmarNuevoEnvio()" class="btn-enviado">
        <i class="ti ti-send" aria-hidden="true"></i> Confirmar salida
      </button>
    </div>`
}

function limpiarEnvioActual() {
  _envioActual = { pedidos: [] }
  renderPedidosParaEnviar()
}

async function confirmarNuevoEnvio() {
  if (_envioActual.pedidos.length === 0) {
    alert('Agregá al menos un pedido al envío')
    return
  }

  const obs = prompt('Observaciones del envío (opcional):') || null

  // Calcular totales del envío
  const { data: pedidosData } = await db.from('pedidos')
    .select('total').in('id', _envioActual.pedidos)
  const totalMonto = pedidosData?.reduce((s, p) => s + Number(p.total), 0) || 0

  // Crear envío
  const { data: envio, error } = await db.from('envios').insert({
    estado:         'en_camino',
    fecha_salida:   new Date().toISOString(),
    observaciones:  obs,
    creado_por:     usuarioActual.id,
    total_pedidos:  _envioActual.pedidos.length,
    total_monto:    totalMonto
  }).select().single()

  if (error) {
    console.error('Error envio:', error)
    alert('Error al crear envío: ' + error.message + '\n\nCódigo: ' + error.code)
    return
  }
  if (!envio) { alert('No se pudo crear el envío. Verificá que el SQL fue ejecutado.'); return }

  // Asociar pedidos al envío
  const items = _envioActual.pedidos.map(pid => ({
    envio_id:   envio.id,
    pedido_id:  pid,
    estado:     'pendiente'
  }))
  const { error: itemsErr } = await db.from('envio_pedidos').insert(items)
  if (itemsErr) {
    console.error('Error envio_pedidos:', itemsErr)
    alert('Error al asociar pedidos: ' + itemsErr.message)
    return
  }

  // Actualizar etapa de cada pedido a "enviado" y notificar
  for (const pid of _envioActual.pedidos) {
    await db.from('pedidos').update({
      etapa:         'enviado',
      fecha_enviado: new Date().toISOString(),
      enviado_por:   usuarioActual.id
    }).eq('id', pid)

    await registrarHistorial(pid, 'estado_cambiado',
      `Pedido incluido en Envío #${envio.id.slice(-4).toUpperCase()} — Salida ${new Date().toLocaleString('es-AR')}`)

    // Notificación al cliente
    await notificarClienteEnvio(pid)
  }

  _envioActual = { pedidos: [] }
  alert(`✅ Envío confirmado. Se notificó a ${items.length} cliente${items.length !== 1 ? 's' : ''}.`)
  await cargarLogistica()
}

async function notificarClienteEnvio(pedidoId) {
  const { data: p } = await db.from('pedidos')
    .select('cliente_id, numero').eq('id', pedidoId).single()
  if (!p?.cliente_id) return

  await db.from('notificaciones').insert({
    usuario_id: p.cliente_id,
    tipo:       'envio',
    titulo:     '🚚 Tu pedido está en camino',
    mensaje:    `Tu pedido #${p.numero} salió para entrega. ¡Pronto lo tenés!`,
    leida:      false
  }).catch(() => {}) // Silenciar si la tabla no existe
}

// ── ENVÍOS ACTIVOS ───────────────────────────────
async function renderEnviosActivos() {
  const clienteFiltro = await getClienteIdFiltro()
  const rol = await cargarRolUsuario()

  let envios = []

  if (clienteFiltro || rol === 'vendedor') {
    // Cliente/vendedor: traer solo envíos que contienen sus pedidos
    // 1) sus pedidos
    let qPed = db.from('pedidos').select('id')
    if (clienteFiltro) qPed = qPed.eq('cliente_id', clienteFiltro)
    else qPed = qPed.eq('vendedor_id', usuarioActual.id)
    const { data: misPedidos } = await qPed
    const misIds = (misPedidos || []).map(p => p.id)

    if (misIds.length > 0) {
      // 2) envío_pedidos que referencian esos pedidos
      const { data: vinculos } = await db.from('envio_pedidos')
        .select('envio_id').in('pedido_id', misIds)
      const envioIds = [...new Set((vinculos || []).map(v => v.envio_id))]
      if (envioIds.length > 0) {
        const { data } = await db.from('envios').select('*')
          .in('id', envioIds).order('fecha_salida', { ascending: false }).limit(20)
        envios = data || []
      }
    }
  } else {
    // Admin/empresa: todos
    const { data } = await db.from('envios').select('*')
      .order('fecha_salida', { ascending: false }).limit(20)
    envios = data || []
  }

  const el = document.getElementById('log-envios-activos')
  if (!envios || envios.length === 0) {
    el.innerHTML = '<p class="vacio">No hay envíos registrados</p>'
    return
  }

  // Separar activos e histórico
  const activos   = envios.filter(e => e.estado === 'en_camino')
  const cerrados  = envios.filter(e => e.estado !== 'en_camino')

  let html = ''

  if (activos.length > 0) {
    html += activos.map(e => renderEnvioCard(e, true)).join('')
  }

  if (cerrados.length > 0) {
    html += `<div class="cob-seccion-titulo" style="margin-top:20px">
      <i class="ti ti-history" aria-hidden="true"></i> Historial
      <span class="cob-seccion-count">${cerrados.length}</span>
    </div>`
    html += cerrados.map(e => renderEnvioCard(e, false)).join('')
  }

  el.innerHTML = html

  // Cargar preview de pedidos automáticamente
  for (const e of envios) {
    cargarPedidosPreview(e.id)
  }
}

async function marcarEnvioCompletado(envioId) {
  const { error } = await db.from('envios').update({ estado: 'entregado' }).eq('id', envioId)
  if (error) console.warn('No se pudo actualizar estado del envío:', error.message)
}

async function cargarPedidosPreview(envioId) {
  const { data: items } = await db.from('envio_pedidos')
    .select('pedidos(id, numero, etapa, clientes(razon_social))')
    .eq('envio_id', envioId)
  const el = document.getElementById(`pedidos-preview-${envioId}`)
  if (!el || !items) return

  const total     = items.length
  const entregados = items.filter(i => i.pedidos?.etapa === 'recibido').length
  const todosOk   = total > 0 && entregados === total

  // Actualizar badge del envío en base al estado real de los pedidos
  const badgeEl = document.getElementById(`badge-envio-${envioId}`)
  const cardEl  = document.getElementById(`log-envio-${envioId}`)
  if (badgeEl) {
    if (todosOk) {
      badgeEl.textContent = 'Entregado'
      badgeEl.className = 'badge badge-verde'
      if (cardEl) cardEl.style.borderLeftColor = '#1d9e75'
      // Actualizar en DB — probar 'entregado', si falla el estado se queda visual
      marcarEnvioCompletado(envioId)
    } else if (entregados > 0) {
      badgeEl.textContent = `${entregados}/${total} entregados`
      badgeEl.className = 'badge badge-amarillo'
    }
  }

  el.innerHTML = items.map(item => {
    const p = item.pedidos
    const pedidoId  = p?.id || ''
    const entregado = p?.etapa === 'recibido'
    return `<span class="log-pedido-pill ${entregado ? 'entregado' : ''}"
      style="cursor:pointer"
      onclick="event.stopPropagation(); abrirPedidoDesdeLogistica('${pedidoId}')"
      title="Ver detalle del pedido">
      <i class="ti ti-package" style="font-size:11px" aria-hidden="true"></i>
      Pedido #${p?.numero} · ${p?.clientes?.razon_social || '-'}
      ${entregado ? '<i class="ti ti-check" style="font-size:11px;color:#0f6e56" aria-hidden="true"></i>' : '<i class="ti ti-arrow-right" style="font-size:10px;opacity:0.5" aria-hidden="true"></i>'}
    </span>`
  }).join('')
}

function abrirPedidoDesdeLogistica(pedidoId) {
  if (!pedidoId) return
  mostrarSeccion('pedidos')
  // Pequeño delay para que la sección cargue antes de abrir el detalle
  setTimeout(() => abrirPedido(pedidoId), 150)
}

function renderEnvioCard(envio, activo) {
  const num = envio.numero || envio.id.slice(-4).toUpperCase()
  return `
    <div class="log-envio-card" id="log-envio-${envio.id}"
      onclick="toggleEnvioDetalle('${envio.id}')"
      style="border-left:3px solid ${activo ? '#1d9e75' : '#888780'};cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <i class="ti ti-truck" style="font-size:15px;color:${activo ? '#1d9e75' : '#888780'}" aria-hidden="true"></i>
            <span style="font-size:15px;font-weight:500">Envío #${num}</span>
            <span class="badge ${activo ? 'badge-verde' : 'badge-gris'}" id="badge-envio-${envio.id}">${activo ? 'En camino' : 'Completado'}</span>
          </div>
          <div style="display:flex;gap:14px;font-size:12px;color:var(--color-text-secondary)">
            <span><i class="ti ti-calendar" style="font-size:12px" aria-hidden="true"></i> Salida: ${formatFechaHora(envio.fecha_salida)}</span>
            ${envio.total_pedidos ? `<span><i class="ti ti-package" style="font-size:12px" aria-hidden="true"></i> ${envio.total_pedidos} pedido${envio.total_pedidos !== 1 ? 's' : ''}</span>` : ''}
            ${envio.total_monto ? `<span><i class="ti ti-cash" style="font-size:12px" aria-hidden="true"></i> $${Number(envio.total_monto).toLocaleString('es-AR')}</span>` : ''}
          </div>
          ${envio.observaciones ? `<div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px">📝 ${envio.observaciones}</div>` : ''}
        </div>
        <div id="btn-detalle-${envio.id}"
          style="background:none;border:0.5px solid var(--color-border-tertiary);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--color-text-secondary);display:flex;align-items:center;gap:4px;pointer-events:none">
          <span id="txt-detalle-${envio.id}">Ver pedidos</span>
          <i class="ti ti-chevron-down" id="chevron-${envio.id}" style="transition:transform 0.2s" aria-hidden="true"></i>
        </div>
      </div>

      <div id="pedidos-preview-${envio.id}" class="log-pedidos-preview"></div>

      <div id="detalle-envio-${envio.id}" onclick="event.stopPropagation()" style="display:none;margin-top:10px;padding-top:10px;border-top:0.5px solid var(--color-border-tertiary)">
        <div id="pedidos-envio-${envio.id}">
          <span style="color:var(--color-text-tertiary);font-size:13px">Cargando...</span>
        </div>
      </div>
    </div>`
}

async function toggleEnvioDetalle(envioId) {
  const el      = document.getElementById(`detalle-envio-${envioId}`)
  const chevron = document.getElementById(`chevron-${envioId}`)
  const txt     = document.getElementById(`txt-detalle-${envioId}`)
  if (!el) return

  const visible = el.style.display !== 'none'
  el.style.display = visible ? 'none' : 'block'
  if (chevron) chevron.style.transform = visible ? '' : 'rotate(180deg)'
  if (txt) txt.textContent = visible ? 'Ver pedidos' : 'Ocultar'

  if (!visible) {
    await cargarPedidosDeEnvio(envioId)
  }
}

async function cargarPedidosDeEnvio(envioId) {
  const { data: items, error } = await db.from('envio_pedidos')
    .select('envio_id, pedido_id, estado, pedidos(id, numero, etapa, clientes(razon_social, telefono))')
    .eq('envio_id', envioId)

  const el = document.getElementById(`pedidos-envio-${envioId}`)
  if (!el) return

  if (error) {
    el.innerHTML = '<p class="vacio">Error al cargar pedidos</p>'
    return
  }
  if (!items || items.length === 0) {
    el.innerHTML = '<p class="vacio">Sin pedidos</p>'
    return
  }

  // Traer historial de recepción para cada pedido en paralelo
  const pedidoIds = items.map(i => i.pedidos?.id).filter(Boolean)
  const historialesMap = {}
  if (pedidoIds.length > 0) {
    const { data: historiales } = await db.from('historial_pedido')
      .select('pedido_id, accion, detalle, created_at')
      .in('pedido_id', pedidoIds)
      .in('accion', ['recepcion_ok', 'recepcion_problema'])
      .order('created_at', { ascending: false })
    for (const h of (historiales || [])) {
      if (!historialesMap[h.pedido_id]) historialesMap[h.pedido_id] = h
    }
  }

  el.innerHTML = items.map(item => {
    const p         = item.pedidos
    const pedidoId  = p?.id || item.pedido_id || ''
    const entregado = p?.etapa === 'recibido'
    const tel       = p?.clientes?.telefono?.replace(/\D/g, '') || ''
    const recepcion = historialesMap[pedidoId]
    const hayProblema = recepcion?.accion === 'recepcion_problema'

    // Extraer URL de foto del detalle del historial
    let fotoUrl = null
    if (recepcion?.detalle) {
      const match = recepcion.detalle.match(/foto:\s*(https?:\/\/\S+)/)
      if (match) fotoUrl = match[1]
    }

    // Extraer descripción del problema
    let descripcionProblema = ''
    if (hayProblema && recepcion?.detalle) {
      const m = recepcion.detalle.match(/⚠️ Problema en recepción:\s*(.+?)(?:\s*\||\s*$)/)
      if (m) descripcionProblema = m[1]
    }

    return `
      <div style="background:var(--color-background-secondary);padding:12px;border-radius:8px;margin-bottom:8px;border-left:3px solid ${entregado ? (hayProblema ? '#ef9f27' : '#1d9e75') : 'transparent'}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:13px;font-weight:500">#${p?.numero} · ${p?.clientes?.razon_social || '-'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            ${tel ? `<a href="${waLink(tel)}" target="_blank" onclick="event.stopPropagation()"
              style="width:32px;height:32px;border-radius:8px;border:0.5px solid #9fe1cb;background:#e1f5ee;color:#085041;display:flex;align-items:center;justify-content:center;text-decoration:none;">
              <i class="ti ti-brand-whatsapp" aria-hidden="true"></i>
            </a>` : ''}
            ${entregado
              ? hayProblema
                ? `<span class="badge badge-amarillo"><i class="ti ti-alert-triangle" aria-hidden="true"></i> Entregado c/problema</span>`
                : `<span class="badge badge-verde"><i class="ti ti-check" aria-hidden="true"></i> Entregado</span>`
              : `<span class="badge badge-amarillo">En camino</span>`
            }
          </div>
        </div>

        ${entregado && hayProblema ? `
          <div style="margin-top:10px;padding:10px;background:#faeeda;border-radius:8px;border:0.5px solid #ef9f27">
            <div style="font-size:12px;font-weight:600;color:#633806;margin-bottom:4px">
              <i class="ti ti-alert-triangle" aria-hidden="true"></i> Problema reportado:
            </div>
            <div style="font-size:12px;color:#633806">${descripcionProblema || 'Sin detalle'}</div>
            ${fotoUrl ? `<a href="${fotoUrl}" target="_blank" style="display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:12px;color:#185fa5;text-decoration:none;">
              <i class="ti ti-photo" aria-hidden="true"></i> Ver foto de recepción
            </a>` : ''}
          </div>` : ''}

        ${entregado && !hayProblema && recepcion ? `
          <div style="margin-top:8px;font-size:11px;color:var(--color-text-tertiary);display:flex;align-items:center;gap:4px">
            <i class="ti ti-circle-check" style="color:#1d9e75" aria-hidden="true"></i>
            Todo en orden · ${formatFechaHora(recepcion.created_at)}
            ${fotoUrl ? `· <a href="${fotoUrl}" target="_blank" style="color:#185fa5;text-decoration:none;"><i class="ti ti-photo" aria-hidden="true"></i> foto</a>` : ''}
          </div>` : ''}

        ${!entregado && pedidoId ? `
          <button onclick="event.stopPropagation(); marcarRecibido('${pedidoId}')"
            style="margin-top:10px;width:100%;background:#185fa5;color:white;border:none;padding:10px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">
            <i class="ti ti-circle-check" style="font-size:15px" aria-hidden="true"></i>
            Confirmar entrega del Pedido #${p?.numero}
          </button>` : ''}
      </div>`
  }).join('')
}

async function cerrarEnvio(envioId) {
  const ok = confirm('¿Cerrar este envío? Se marcará como completado.')
  if (!ok) return
  await marcarEnvioCompletado(envioId)
  await cargarLogistica()
}


// ================================================
// SISTEMA DE ALERTAS — Problemas de recepción
// ================================================

let _alertasInterval = null

async function iniciarSistemaAlertas() {
  await cargarAlertas()
  // Polling cada 60s para nuevas alertas
  if (_alertasInterval) clearInterval(_alertasInterval)
  _alertasInterval = setInterval(cargarAlertas, 60000)
}

async function cargarAlertas() {
  const rol    = await cargarRolUsuario()
  const esAdmin = rol === 'admin'

  let alertas = []

  if (esAdmin) {
    // Admin ve todas las alertas de notificaciones_admin no respondidas
    const { data } = await db.from('notificaciones_admin')
      .select('*, pedidos(numero, clientes(razon_social))')
      .eq('leida', false)
      .order('created_at', { ascending: false })
    alertas = data || []
  } else {
    // Vendedor ve sus propias notificaciones no leídas de problema
    const { data } = await db.from('notificaciones')
      .select('*, pedidos(numero, clientes(razon_social))')
      .eq('usuario_id', usuarioActual.id)
      .eq('leida', false)
      .eq('tipo', 'problema_recepcion')
      .order('created_at', { ascending: false })
    alertas = data || []
  }

  actualizarCampana(alertas.length)
  actualizarBadgeProblemas(alertas.length)
  return alertas
}

function actualizarCampana(count) {
  const badge = document.getElementById('campana-badge')
  const btn   = document.getElementById('btn-campana')
  if (!badge || !btn) return
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count
    badge.style.display = 'flex'
    btn.style.animation = 'shake 0.5s ease'
    setTimeout(() => { if (btn) btn.style.animation = '' }, 500)
  } else {
    badge.style.display = 'none'
  }
}

async function togglePanelAlertas() {
  mostrarSeccion('problemas')
}

async function renderPanelAlertas() {
  const panel = document.getElementById('panel-alertas-contenido')
  if (!panel) return
  panel.innerHTML = '<p style="color:var(--color-text-tertiary);font-size:13px;padding:8px">Cargando...</p>'

  const rol     = await cargarRolUsuario()
  const esAdmin = rol === 'admin'
  const alertas = await cargarAlertas()

  if (alertas.length === 0) {
    panel.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--color-text-tertiary)">
      <i class="ti ti-bell-off" style="font-size:32px;display:block;margin-bottom:8px" aria-hidden="true"></i>
      Sin alertas pendientes
    </div>`
    return
  }

  panel.innerHTML = alertas.map(a => {
    const pedidoNum = a.pedidos?.numero || a.pedido_id?.slice(-4) || '?'
    const cliente   = a.pedidos?.clientes?.razon_social || ''
    const mensaje   = a.mensaje || a.titulo || ''
    const pedidoId  = a.pedido_id || ''
    const alertaId  = a.id
    const tabla     = esAdmin ? 'notificaciones_admin' : 'notificaciones'

    return `
      <div id="alerta-${alertaId}" style="padding:14px;border-bottom:0.5px solid var(--color-border-tertiary)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
          <div>
            <div style="font-size:13px;font-weight:600;color:#633806">⚠️ Pedido #${pedidoNum}${cliente ? ' · ' + cliente : ''}</div>
            <div style="font-size:12px;color:var(--color-text-secondary);margin-top:3px">${mensaje}</div>
            <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:3px">${formatFechaHora(a.created_at)}</div>
          </div>
          <button onclick="verPedidoDesdeAlerta('${pedidoId}')"
            style="white-space:nowrap;background:none;border:0.5px solid var(--color-border-tertiary);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;color:var(--color-text-secondary)">
            Ver pedido
          </button>
        </div>

        <!-- Acciones -->
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          <button onclick="accionAlerta('${alertaId}','${pedidoId}','${tabla}','credito')"
            style="background:#e1f5ee;color:#085041;border:0.5px solid #9fe1cb;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px">
            <i class="ti ti-coins" aria-hidden="true"></i> Generar crédito
          </button>
          <button onclick="accionAlerta('${alertaId}','${pedidoId}','${tabla}','reenvio')"
            style="background:#e8f0fe;color:#1a56db;border:0.5px solid #a4cafe;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px">
            <i class="ti ti-truck" aria-hidden="true"></i> Reenviar producto
          </button>
          <button onclick="accionAlerta('${alertaId}','${pedidoId}','${tabla}','sin_accion')"
            style="background:#f3f4f6;color:#6b7280;border:0.5px solid #d1d5db;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:4px">
            <i class="ti ti-check" aria-hidden="true"></i> Sin acción necesaria
          </button>
        </div>

        <!-- Respuesta con comentario -->
        <div style="display:flex;gap:6px">
          <input id="resp-${alertaId}" type="text" placeholder="Agregar comentario..."
            style="flex:1;padding:7px 10px;border:0.5px solid var(--color-border-tertiary);border-radius:6px;font-size:12px"
            onkeydown="if(event.key==='Enter') responderAlerta('${alertaId}','${pedidoId}','${tabla}')">
          <button onclick="responderAlerta('${alertaId}','${pedidoId}','${tabla}')"
            style="background:#185fa5;color:white;border:none;border-radius:6px;padding:7px 12px;font-size:12px;cursor:pointer">
            Enviar
          </button>
        </div>
      </div>`
  }).join('')
}

async function accionAlerta(alertaId, pedidoId, tabla, accion) {
  const labels = {
    credito:    '💰 Crédito generado para el cliente',
    reenvio:    '🚚 Se programó reenvío del producto',
    sin_accion: '✅ Revisado — sin acción necesaria'
  }
  const label = labels[accion] || accion

  // Registrar en historial del pedido
  if (pedidoId) {
    await db.from('historial_pedido').insert({
      pedido_id:  pedidoId,
      usuario_id: usuarioActual?.id,
      accion:     'resolucion_problema',
      detalle:    label
    }).catch(() => {})
  }

  // Marcar alerta como leída/resuelta
  await db.from(tabla).update({ leida: true, respuesta: label }).eq('id', alertaId).catch(() => {})

  // Quitar del panel
  const el = document.getElementById(`alerta-${alertaId}`)
  if (el) {
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.3s'
    setTimeout(() => { el.remove(); renderPanelAlertas() }, 300)
  }

  await cargarAlertas()
}

async function responderAlerta(alertaId, pedidoId, tabla) {
  const input = document.getElementById(`resp-${alertaId}`)
  const comentario = input?.value.trim()
  if (!comentario) return

  // Guardar en historial
  if (pedidoId) {
    await db.from('historial_pedido').insert({
      pedido_id:  pedidoId,
      usuario_id: usuarioActual?.id,
      accion:     'resolucion_problema',
      detalle:    `💬 Respuesta: ${comentario}`
    }).catch(() => {})
  }

  // Marcar como leída con la respuesta
  await db.from(tabla).update({ leida: true, respuesta: comentario }).eq('id', alertaId).catch(() => {})

  const el = document.getElementById(`alerta-${alertaId}`)
  if (el) {
    el.style.opacity = '0'
    el.style.transition = 'opacity 0.3s'
    setTimeout(() => { el.remove(); renderPanelAlertas() }, 300)
  }

  await cargarAlertas()
}

function verPedidoDesdeAlerta(pedidoId) {
  if (!pedidoId) return
  document.getElementById('panel-alertas').style.display = 'none'
  mostrarSeccion('pedidos')
  setTimeout(() => abrirPedido(pedidoId), 150)
}

// Cerrar panel al hacer click afuera
document.addEventListener('click', (e) => {
  const panel = document.getElementById('panel-alertas')
  const btn   = document.getElementById('btn-campana')
  if (panel && btn && !panel.contains(e.target) && !btn.contains(e.target)) {
    panel.style.display = 'none'
  }
})


// ================================================
// SECCIÓN PROBLEMAS DE RECEPCIÓN
// ================================================

let _tabProblemasActual = 'pendientes'

async function cargarProblemas() {
  _tabProblemasActual = 'pendientes'
  resetTabsProblemas()
  await Promise.all([
    cargarPendientes(),
    cargarResueltos()
  ])
}

function switchTabProblemas(tab) {
  _tabProblemasActual = tab
  resetTabsProblemas()
  document.getElementById('problemas-pendientes-lista').style.display = tab === 'pendientes' ? 'block' : 'none'
  document.getElementById('problemas-resueltos-lista').style.display  = tab === 'resueltos'  ? 'block' : 'none'
}

function resetTabsProblemas() {
  const activo   = 'padding:10px 20px;border:none;background:none;font-size:13px;font-weight:600;cursor:pointer;color:#185fa5;border-bottom:2px solid #185fa5;margin-bottom:-2px'
  const inactivo = 'padding:10px 20px;border:none;background:none;font-size:13px;font-weight:500;cursor:pointer;color:var(--color-text-secondary)'
  document.getElementById('tab-pendientes').style.cssText = _tabProblemasActual === 'pendientes' ? activo : inactivo
  document.getElementById('tab-resueltos').style.cssText  = _tabProblemasActual === 'resueltos'  ? activo : inactivo
  document.getElementById('problemas-pendientes-lista').style.display = _tabProblemasActual === 'pendientes' ? 'block' : 'none'
  document.getElementById('problemas-resueltos-lista').style.display  = _tabProblemasActual === 'resueltos'  ? 'block' : 'none'
}

async function cargarPendientes() {
  const el = document.getElementById('problemas-pendientes-lista')
  el.innerHTML = '<p style="color:var(--color-text-tertiary);font-size:13px">Cargando...</p>'

  const clienteFiltro = await getClienteIdFiltro()
  const rolP = await cargarRolUsuario()

  // Buscar en notificaciones_admin (con o sin campo tipo)
  const { data: notifAdmin } = await db.from('notificaciones_admin')
    .select('*, pedidos(id, numero, cliente_id, vendedor_id, clientes(razon_social, telefono))')
    .eq('leida', false)
    .order('created_at', { ascending: false })

  // Filtrar solo las de problema_recepcion — compatibles con registros viejos sin tipo
  let notifsFiltradas = (notifAdmin || []).filter(n =>
    !n.tipo || n.tipo === 'problema_recepcion' ||
    (n.mensaje && n.mensaje.toLowerCase().includes('problema'))
  )

  // Filtrado por rol: cliente solo sus pedidos, vendedor los de sus clientes
  if (clienteFiltro) {
    notifsFiltradas = notifsFiltradas.filter(n => n.pedidos?.cliente_id === clienteFiltro)
  } else if (rolP === 'vendedor') {
    notifsFiltradas = notifsFiltradas.filter(n => n.pedidos?.vendedor_id === usuarioActual.id)
  }

  // Si no hay nada en notificaciones_admin, buscar directamente en historial_pedido
  let notifs = notifsFiltradas
  if (notifs.length === 0) {
    const { data: histProblemas } = await db.from('historial_pedido')
      .select('*, pedidos(id, numero, clientes(razon_social, telefono))')
      .eq('accion', 'recepcion_problema')
      .order('created_at', { ascending: false })

    // Convertir historial a formato de notif para reutilizar el render
    // Solo mostrar los que NO tienen resolución
    const pedidosConResolucion = new Set()
    const { data: resoluciones } = await db.from('historial_pedido')
      .select('pedido_id').eq('accion', 'resolucion_problema')
    for (const r of (resoluciones || [])) pedidosConResolucion.add(r.pedido_id)

    notifs = (histProblemas || [])
      .filter(h => !pedidosConResolucion.has(h.pedido_id))
      .map(h => ({
        id:        h.id,
        pedido_id: h.pedido_id,
        mensaje:   h.detalle,
        created_at: h.created_at,
        pedidos:   h.pedidos,
        _fromHistorial: true
      }))
  }

  if (!notifs || notifs.length === 0) {
    el.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--color-text-tertiary)">
        <i class="ti ti-circle-check" style="font-size:48px;display:block;margin-bottom:12px;color:#1d9e75" aria-hidden="true"></i>
        <div style="font-size:15px;font-weight:500;color:#085041">Sin problemas pendientes</div>
        <div style="font-size:13px;margin-top:4px">Todas las recepciones están resueltas</div>
      </div>`
    actualizarBadgeProblemas(0)
    return
  }

  // Traer historial de recepción de cada pedido para obtener descripción y foto
  const pedidoIds = notifs.map(n => n.pedido_id).filter(Boolean)
  const historialesMap = {}
  if (pedidoIds.length > 0) {
    const { data: historiales } = await db.from('historial_pedido')
      .select('pedido_id, detalle, created_at, perfiles(nombre_completo)')
      .in('pedido_id', pedidoIds)
      .eq('accion', 'recepcion_problema')
      .order('created_at', { ascending: false })
    for (const h of (historiales || [])) {
      if (!historialesMap[h.pedido_id]) historialesMap[h.pedido_id] = h
    }
  }

  actualizarBadgeProblemas(notifs.length)

  el.innerHTML = notifs.map(n => {
    const pedido    = n.pedidos
    const pedidoId  = n.pedido_id || ''
    const notifId   = n.id
    const historial = historialesMap[pedidoId]
    const detalle   = historial?.detalle || n.mensaje || ''
    const quien     = historial?.perfiles?.nombre_completo || 'Cliente'
    const fecha     = formatFechaHora(n.created_at)

    // Extraer descripción del problema
    let descripcion = ''
    const mDesc = detalle.match(/Problema en recepción:\s*(.+?)(?:\s*\|\s*foto:|$)/)
    if (mDesc) descripcion = mDesc[1].trim()
    else descripcion = n.mensaje?.replace('⚠️ Problema en recepción: ', '') || ''

    // Extraer URL de foto
    let fotoUrl = null
    const mFoto = detalle.match(/foto:\s*(https?:\/\/\S+)/)
    if (mFoto) fotoUrl = mFoto[1].trim()

    const tel = pedido?.clientes?.telefono?.replace(/\D/g, '') || ''

    return `
      <div class="problema-card" id="prob-${notifId}">

        <!-- Cabecera -->
        <div class="problema-header">
          <div>
            <div class="problema-titulo">
              <span class="badge badge-rojo" style="font-size:11px">⚠️ Pendiente</span>
              <span style="font-weight:600">Pedido #${pedido?.numero || '?'}</span>
              <span style="color:var(--color-text-secondary)">·</span>
              <span>${pedido?.clientes?.razon_social || '-'}</span>
            </div>
            <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px">
              Reportado por <b>${quien}</b> · ${fecha}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            ${tel ? `<a href="${waLink(tel)}" target="_blank"
              style="width:32px;height:32px;border-radius:8px;border:0.5px solid #9fe1cb;background:#e1f5ee;color:#085041;display:flex;align-items:center;justify-content:center;text-decoration:none">
              <i class="ti ti-brand-whatsapp" aria-hidden="true"></i>
            </a>` : ''}
            <button onclick="verPedidoDesdeAlerta('${pedidoId}')"
              style="background:none;border:0.5px solid var(--color-border-tertiary);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--color-text-secondary);display:flex;align-items:center;gap:4px">
              <i class="ti ti-external-link" aria-hidden="true"></i> Ver pedido
            </button>
          </div>
        </div>

        <!-- Descripción del problema -->
        <div class="problema-descripcion">
          <div style="font-size:12px;font-weight:600;color:#a32d2d;margin-bottom:6px;display:flex;align-items:center;gap:6px">
            <i class="ti ti-message-report" aria-hidden="true"></i> Descripción del problema
          </div>
          <p style="font-size:13px;margin:0;color:var(--color-text-primary);line-height:1.5">${descripcion || 'Sin descripción adicional'}</p>
        </div>

        <!-- Foto/archivo adjunto -->
        ${fotoUrl ? `
          <div style="margin-bottom:16px">
            <div style="font-size:12px;font-weight:600;color:var(--color-text-secondary);margin-bottom:8px;display:flex;align-items:center;gap:6px">
              <i class="ti ti-photo" aria-hidden="true"></i> Foto adjunta
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button onclick="abrirFotoProblema('${fotoUrl}')"
                style="background:#185fa5;color:white;border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px">
                <i class="ti ti-photo-search" aria-hidden="true"></i> Ver foto
              </button>
              <a href="${fotoUrl}" target="_blank" download
                style="background:var(--color-background-secondary);color:var(--color-text-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:8px;padding:8px 16px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;text-decoration:none">
                <i class="ti ti-download" aria-hidden="true"></i> Descargar
              </a>
            </div>
          </div>` : `
          <div style="margin-bottom:16px;padding:10px 14px;background:var(--color-background-secondary);border-radius:8px;font-size:12px;color:var(--color-text-tertiary);display:flex;align-items:center;gap:6px">
            <i class="ti ti-photo-off" aria-hidden="true"></i> Sin foto adjunta
          </div>`}

        <!-- Acciones de resolución -->
        <div style="border-top:0.5px solid var(--color-border-tertiary);padding-top:14px">
          <div style="font-size:12px;font-weight:600;color:var(--color-text-secondary);margin-bottom:10px">
            <i class="ti ti-tool" aria-hidden="true"></i> Acción a tomar
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            <button onclick="resolverProblema('${notifId}','${pedidoId}','credito')"
              style="background:#e1f5ee;color:#085041;border:0.5px solid #9fe1cb;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px">
              <i class="ti ti-coins" aria-hidden="true"></i> Generar crédito
            </button>
            <button onclick="resolverProblema('${notifId}','${pedidoId}','reenvio')"
              style="background:#e8f0fe;color:#1a56db;border:0.5px solid #a4cafe;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px">
              <i class="ti ti-truck" aria-hidden="true"></i> Reenviar producto
            </button>
            <button onclick="resolverProblema('${notifId}','${pedidoId}','sin_accion')"
              style="background:#f3f4f6;color:#6b7280;border:0.5px solid #d1d5db;border-radius:8px;padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px">
              <i class="ti ti-check" aria-hidden="true"></i> Sin acción necesaria
            </button>
          </div>
          <div style="display:flex;gap:8px">
            <input id="comentario-${notifId}" type="text" placeholder="Agregar comentario de resolución (opcional)..."
              style="flex:1;padding:9px 12px;border:0.5px solid var(--color-border-tertiary);border-radius:8px;font-size:13px"
              onkeydown="if(event.key==='Enter') resolverProblemaConComentario('${notifId}','${pedidoId}')">
            <button onclick="resolverProblemaConComentario('${notifId}','${pedidoId}')"
              style="background:#185fa5;color:white;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:500;cursor:pointer">
              Resolver
            </button>
          </div>
        </div>
      </div>`
  }).join('')
}

async function cargarResueltos() {
  const el = document.getElementById('problemas-resueltos-lista')
  el.innerHTML = '<p style="color:var(--color-text-tertiary);font-size:13px">Cargando...</p>'

  const { data: notifAdmin } = await db.from('notificaciones_admin')
    .select('*, pedidos(id, numero, clientes(razon_social))')
    .eq('leida', true)
    .order('created_at', { ascending: false })
    .limit(50)

  const notifs = (notifAdmin || []).filter(n =>
    !n.tipo || n.tipo === 'problema_recepcion' ||
    (n.mensaje && n.mensaje.toLowerCase().includes('problema'))
  )

  if (!notifs || notifs.length === 0) {
    el.innerHTML = '<p style="color:var(--color-text-tertiary);font-size:13px;padding:20px 0">Sin problemas resueltos aún</p>'
    return
  }

  // Traer historial de recepción Y resolución
  const pedidoIds = notifs.map(n => n.pedido_id).filter(Boolean)
  const historialesMap = {}
  const resolucionesMap = {}

  if (pedidoIds.length > 0) {
    const { data: hist } = await db.from('historial_pedido')
      .select('pedido_id, accion, detalle, created_at, perfiles(nombre_completo)')
      .in('pedido_id', pedidoIds)
      .in('accion', ['recepcion_problema', 'resolucion_problema'])
      .order('created_at', { ascending: false })

    for (const h of (hist || [])) {
      if (h.accion === 'recepcion_problema' && !historialesMap[h.pedido_id]) historialesMap[h.pedido_id] = h
      if (h.accion === 'resolucion_problema' && !resolucionesMap[h.pedido_id]) resolucionesMap[h.pedido_id] = h
    }
  }

  el.innerHTML = notifs.map(n => {
    const pedido    = n.pedidos
    const pedidoId  = n.pedido_id || ''
    const historial = historialesMap[pedidoId]
    const resolucion = resolucionesMap[pedidoId]
    const detalle   = historial?.detalle || ''

    let descripcion = ''
    const mDesc = detalle.match(/Problema en recepción:\s*(.+?)(?:\s*\|\s*foto:|$)/)
    if (mDesc) descripcion = mDesc[1].trim()
    else descripcion = n.mensaje?.replace('⚠️ Problema en recepción: ', '') || ''

    let fotoUrl = null
    const mFoto = detalle.match(/foto:\s*(https?:\/\/\S+)/)
    if (mFoto) fotoUrl = mFoto[1].trim()

    // Acción tomada
    const accionLabel = resolucion?.detalle || n.respuesta || 'Resuelto'
    const quien       = resolucion?.perfiles?.nombre_completo || 'Admin'

    return `
      <div class="problema-card" style="opacity:0.85">
        <div class="problema-header">
          <div>
            <div class="problema-titulo">
              <span class="badge badge-verde" style="font-size:11px">✅ Resuelto</span>
              <span style="font-weight:600">Pedido #${pedido?.numero || '?'}</span>
              <span style="color:var(--color-text-secondary)">·</span>
              <span>${pedido?.clientes?.razon_social || '-'}</span>
            </div>
            <div style="font-size:12px;color:var(--color-text-tertiary);margin-top:4px">
              Reportado: ${formatFechaHora(n.created_at)}
            </div>
          </div>
          <button onclick="verPedidoDesdeAlerta('${pedidoId}')"
            style="background:none;border:0.5px solid var(--color-border-tertiary);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--color-text-secondary);display:flex;align-items:center;gap:4px">
            <i class="ti ti-external-link" aria-hidden="true"></i> Ver pedido
          </button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div class="problema-descripcion" style="margin-bottom:0">
            <div style="font-size:11px;font-weight:600;color:var(--color-text-tertiary);margin-bottom:4px">PROBLEMA REPORTADO</div>
            <p style="font-size:13px;margin:0;line-height:1.5">${descripcion || '-'}</p>
          </div>
          <div style="background:#e1f5ee;border-radius:8px;padding:12px">
            <div style="font-size:11px;font-weight:600;color:#085041;margin-bottom:4px">ACCIÓN TOMADA</div>
            <p style="font-size:13px;margin:0;color:#085041;line-height:1.5">${accionLabel}</p>
            ${quien ? `<div style="font-size:11px;color:#1d9e75;margin-top:6px">por ${quien}</div>` : ''}
          </div>
        </div>

        ${fotoUrl ? `
          <button onclick="abrirFotoProblema('${fotoUrl}')"
            style="background:none;border:0.5px solid var(--color-border-tertiary);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;color:var(--color-text-secondary);display:flex;align-items:center;gap:4px">
            <i class="ti ti-photo" aria-hidden="true"></i> Ver foto adjunta
          </button>` : ''}
      </div>`
  }).join('')
}

async function resolverProblema(notifId, pedidoId, accion) {
  const comentario = document.getElementById(`comentario-${notifId}`)?.value.trim() || ''
  const labels = {
    credito:    '💰 Crédito generado para el cliente',
    reenvio:    '🚚 Se programó reenvío del producto',
    sin_accion: '✅ Revisado — sin acción necesaria'
  }
  const label = labels[accion] + (comentario ? ` — ${comentario}` : '')
  await _guardarResolucion(notifId, pedidoId, label)
}

async function resolverProblemaConComentario(notifId, pedidoId) {
  const comentario = document.getElementById(`comentario-${notifId}`)?.value.trim()
  if (!comentario) { alert('Escribí un comentario o elegí una acción rápida'); return }
  await _guardarResolucion(notifId, pedidoId, `💬 ${comentario}`)
}

async function _guardarResolucion(notifId, pedidoId, label) {
  const card = document.getElementById(`prob-${notifId}`)
  if (card) { card.style.opacity = '0.4'; card.style.pointerEvents = 'none' }

  const tareas = [
    // Registrar en historial del pedido siempre
    pedidoId ? db.from('historial_pedido').insert({
      pedido_id:  pedidoId,
      usuario_id: usuarioActual?.id,
      accion:     'resolucion_problema',
      detalle:    label
    }).catch(() => {}) : Promise.resolve()
  ]

  // Solo marcar notif_admin si el id existe y no viene del historial
  if (notifId && !String(notifId).startsWith('hist_')) {
    tareas.push(
      db.from('notificaciones_admin')
        .update({ leida: true, respuesta: label })
        .eq('id', notifId)
        .catch(() => {})
    )
  }

  await Promise.all(tareas)
  await Promise.all([cargarPendientes(), cargarResueltos(), cargarAlertas()])
}

function abrirFotoProblema(url) {
  // Crear lightbox simple
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out'
  overlay.onclick = () => overlay.remove()

  const isImage = url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i)

  overlay.innerHTML = isImage
    ? `<div style="position:relative;max-width:90vw;max-height:90vh">
        <img src="${url}" style="max-width:90vw;max-height:85vh;border-radius:8px;object-fit:contain;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
        <a href="${url}" target="_blank" download onclick="event.stopPropagation()"
          style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,0.6);color:white;border-radius:8px;padding:6px 12px;font-size:12px;text-decoration:none;display:flex;align-items:center;gap:4px">
          <i class="ti ti-download"></i> Descargar
        </a>
        <div style="text-align:center;color:rgba(255,255,255,0.5);font-size:12px;margin-top:8px">Click para cerrar</div>
      </div>`
    : `<div style="background:white;border-radius:12px;padding:24px;text-align:center">
        <i class="ti ti-file" style="font-size:48px;color:#185fa5;display:block;margin-bottom:12px"></i>
        <p style="margin:0 0 16px;font-size:14px">Archivo adjunto</p>
        <a href="${url}" target="_blank"
          style="background:#185fa5;color:white;border-radius:8px;padding:10px 20px;font-size:13px;text-decoration:none;display:inline-flex;align-items:center;gap:6px">
          <i class="ti ti-external-link"></i> Abrir archivo
        </a>
      </div>`

  document.body.appendChild(overlay)
}

function actualizarBadgeProblemas(count) {
  const badge    = document.getElementById('nav-problemas-badge')
  const tabBadge = document.getElementById('badge-tab-pendientes')
  if (badge) {
    badge.textContent = count
    badge.style.display = count > 0 ? 'inline' : 'none'
  }
  if (tabBadge) {
    tabBadge.textContent = count
    tabBadge.style.display = count > 0 ? 'inline' : 'none'
  }
  // Actualizar campana también
  actualizarCampana(count)
}


// ================================================
// NAVEGACIÓN MÓVIL — Barra inferior
// ================================================
function navMovil(seccion) {
  // Cerrar la hoja "Más" si está abierta
  const sheet = document.getElementById('mobile-more-sheet')
  if (sheet) sheet.classList.remove('abierta')

  // Navegar normalmente
  mostrarSeccion(seccion)

  // Actualizar estado activo de la barra inferior
  document.querySelectorAll('.bottom-nav-btn').forEach(b => b.classList.remove('activo'))
  const btn = document.getElementById('bnav-' + seccion)
  if (btn) {
    btn.classList.add('activo')
  } else {
    // Secciones dentro de "Más" (problemas, clientes, productos) marcan el botón Más
    document.getElementById('bnav-mas')?.classList.add('activo')
  }
}

function toggleMobileMore() {
  const sheet = document.getElementById('mobile-more-sheet')
  if (sheet) sheet.classList.toggle('abierta')
}

// Cerrar hoja "Más" al tocar afuera
document.addEventListener('click', (e) => {
  const sheet = document.getElementById('mobile-more-sheet')
  const btnMas = document.getElementById('bnav-mas')
  if (sheet && sheet.classList.contains('abierta') &&
      !sheet.contains(e.target) && !btnMas?.contains(e.target)) {
    sheet.classList.remove('abierta')
  }
})

// Sincronizar badge de problemas — ahora sobre "Más" y en el item de la hoja
const _origActualizarBadge = typeof actualizarBadgeProblemas === 'function' ? actualizarBadgeProblemas : null
actualizarBadgeProblemas = function(count) {
  if (_origActualizarBadge) _origActualizarBadge(count)
  // Badge sobre el botón "Más" de la barra inferior
  const masBadge = document.getElementById('bnav-mas-badge')
  if (masBadge) {
    masBadge.textContent = count > 9 ? '9+' : count
    masBadge.style.display = count > 0 ? 'flex' : 'none'
  }
  // Badge en el item "Problemas" dentro de la hoja Más
  const moreBadge = document.getElementById('more-problemas-badge')
  if (moreBadge) {
    moreBadge.textContent = count
    moreBadge.style.display = count > 0 ? 'inline' : 'none'
  }
}


// ================================================
// SECCIÓN REPORTES
// ================================================
let _repPeriodo = 'mes'
let _repTipo    = 'cliente'
let _repSelId   = null        // id de cliente/vendedor seleccionado (null = todos)
let _repSelNombre = 'Todos'
let _repData    = []          // datos actuales para exportar
let _repTitulo  = ''
let _repSelectorCache = []

async function cargarReportes() {
  _repPeriodo = 'mes'; _repTipo = 'cliente'; _repSelId = null; _repSelNombre = 'Todos'
  // reset chips
  document.querySelectorAll('.rep-per-chip').forEach(c => c.classList.toggle('activo', c.dataset.per === 'mes'))
  document.querySelectorAll('.rep-tab-btn').forEach(c => c.classList.toggle('activo', c.dataset.rep === 'cliente'))
  document.getElementById('rep-fechas-custom').style.display = 'none'
  await cargarReporte()
}

function getRepRango() {
  const hoy = new Date()
  let desde, hasta
  if (_repPeriodo === 'mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    hasta = new Date()
  } else if (_repPeriodo === 'mes_ant') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
    hasta = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59)
  } else if (_repPeriodo === '3meses') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1)
    hasta = new Date()
  } else { // custom
    const d = document.getElementById('rep-fecha-desde').value
    const h = document.getElementById('rep-fecha-hasta').value
    desde = d ? new Date(d) : new Date(hoy.getFullYear(), hoy.getMonth(), 1)
    hasta = h ? new Date(h + 'T23:59:59') : new Date()
  }
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

function setRepPeriodo(per) {
  _repPeriodo = per
  document.querySelectorAll('.rep-per-chip').forEach(c => c.classList.toggle('activo', c.dataset.per === per))
  document.getElementById('rep-fechas-custom').style.display = per === 'custom' ? 'flex' : 'none'
  if (per !== 'custom') cargarReporte()
}

function setRepTipo(tipo) {
  _repTipo = tipo
  _repSelId = null; _repSelNombre = 'Todos'
  document.querySelectorAll('.rep-tab-btn').forEach(c => c.classList.toggle('activo', c.dataset.rep === tipo))
  // El selector individual solo aplica a cliente y vendedor
  const wrap = document.getElementById('rep-selector-wrap')
  wrap.style.display = (tipo === 'cliente' || tipo === 'vendedor') ? 'block' : 'none'
  document.getElementById('rep-selector-label').textContent = 'Todos'
  cargarReporte()
}

async function toggleRepSelector() {
  const dd = document.getElementById('rep-selector-dropdown')
  const visible = dd.style.display !== 'none'
  dd.style.display = visible ? 'none' : 'block'
  if (!visible) {
    // Cargar lista de clientes o vendedores
    const lista = document.getElementById('rep-selector-lista')
    if (_repTipo === 'cliente') {
      const { data } = await db.from('clientes').select('id, razon_social').order('razon_social')
      _repSelectorCache = (data || []).map(c => ({ id: c.id, nombre: c.razon_social }))
    } else {
      const { data } = await db.from('perfiles').select('id, nombre_completo').neq('rol', 'cliente').order('nombre_completo')
      _repSelectorCache = (data || []).map(v => ({ id: v.id, nombre: v.nombre_completo }))
    }
    renderRepSelectorLista(_repSelectorCache)
  }
}

function renderRepSelectorLista(items) {
  const lista = document.getElementById('rep-selector-lista')
  const tipoLabel = _repTipo === 'cliente' ? 'los clientes' : 'los vendedores'
  lista.innerHTML = `<div onclick="seleccionarRep(null,'Todos')" class="cob-dropdown-item">Todos ${tipoLabel}</div>` +
    items.map(i => `<div onclick="seleccionarRep('${i.id}','${i.nombre.replace(/'/g,"\\'")}')" class="cob-dropdown-item">${i.nombre}</div>`).join('')
}

function filtrarRepSelector() {
  const q = document.getElementById('rep-selector-buscar').value.toLowerCase()
  renderRepSelectorLista(_repSelectorCache.filter(i => i.nombre.toLowerCase().includes(q)))
}

function seleccionarRep(id, nombre) {
  _repSelId = id
  _repSelNombre = nombre
  document.getElementById('rep-selector-label').textContent = nombre
  document.getElementById('rep-selector-dropdown').style.display = 'none'
  cargarReporte()
}

async function cargarReporte() {
  const el = document.getElementById('rep-contenido')
  el.innerHTML = '<p style="color:var(--color-text-tertiary);font-size:13px;padding:20px;text-align:center">Generando reporte...</p>'
  const { desde, hasta } = getRepRango()

  try {
    if (_repTipo === 'cliente')   await reporteCliente(desde, hasta)
    else if (_repTipo === 'vendedor')  await reporteVendedor(desde, hasta)
    else if (_repTipo === 'productos') await reporteProductos(desde, hasta)
    else if (_repTipo === 'cobranzas') await reporteCobranzas(desde, hasta)
  } catch (e) {
    console.error('Error en reporte:', e)
    el.innerHTML = '<p style="color:#e24b4a;font-size:13px;padding:20px;text-align:center">Error al generar el reporte</p>'
  }
}

// ── REPORTE CLIENTE ──
async function reporteCliente(desde, hasta) {
  if (_repSelId) return reporteClienteIndividual(desde, hasta)

  // General: ranking de todos
  const { data: pedidos } = await db.from('pedidos')
    .select('total, monto_cobrado, estado_cobro, cliente_id, clientes(razon_social)')
    .gte('created_at', desde).lte('created_at', hasta).neq('estado', 'cancelado')

  const map = {}
  for (const p of (pedidos || [])) {
    const k = p.cliente_id
    if (!k) continue
    if (!map[k]) map[k] = { nombre: p.clientes?.razon_social || '-', facturado:0, cobrado:0, pedidos:0 }
    map[k].facturado += Number(p.total)
    map[k].cobrado   += Number(p.monto_cobrado || 0)
    map[k].pedidos   += 1
  }
  const ranking = Object.values(map).sort((a,b) => b.facturado - a.facturado)
  const totalFact = ranking.reduce((s,r) => s+r.facturado, 0)
  const maxFact = ranking[0]?.facturado || 1

  _repData = ranking.map((r,i) => ({ '#': i+1, Cliente: r.nombre, Pedidos: r.pedidos, Facturado: r.facturado, Cobrado: r.cobrado, 'Pendiente': r.facturado - r.cobrado }))
  _repTitulo = 'Ventas por cliente'

  document.getElementById('rep-contenido').innerHTML = `
    <div class="rep-resumen">
      <div><div class="rep-resumen-l">Total facturado</div><div class="rep-resumen-v">${fmtM(totalFact)}</div></div>
      <div style="text-align:right"><div class="rep-resumen-l">Clientes</div><div class="rep-resumen-v" style="font-size:15px">${ranking.length}</div></div>
    </div>
    ${ranking.length === 0 ? '<p class="vacio">Sin ventas en el período</p>' : ranking.map((r,i) => {
      const pct = r.facturado > 0 ? Math.round((r.cobrado/r.facturado)*100) : 0
      return `
      <div class="rep-fila">
        <div class="rep-rank">${i+1}</div>
        <div class="rep-fila-info">
          <div class="rep-fila-nombre">${r.nombre}</div>
          <div class="rep-fila-detalle">${r.pedidos} pedido${r.pedidos!==1?'s':''} · cobrado ${pct}%</div>
          <div class="rep-fila-bar"><div class="rep-fila-bar-fill" style="width:${Math.round((r.facturado/maxFact)*100)}%"></div></div>
        </div>
        <div class="rep-fila-monto">${fmtM(r.facturado)}</div>
      </div>`
    }).join('')}`
}

async function reporteClienteIndividual(desde, hasta) {
  const { data: pedidos } = await db.from('pedidos')
    .select('id, numero, total, monto_cobrado, estado_cobro, fecha_pedido, created_at')
    .eq('cliente_id', _repSelId).gte('created_at', desde).lte('created_at', hasta)
    .neq('estado', 'cancelado').order('created_at', { ascending: false })

  const facturado = (pedidos||[]).reduce((s,p) => s+Number(p.total), 0)
  const cobrado   = (pedidos||[]).reduce((s,p) => s+Number(p.monto_cobrado||0), 0)
  const debe      = facturado - cobrado

  // Productos que más compra
  const pedidoIds = (pedidos||[]).map(p => p.id)
  let prodMap = {}
  if (pedidoIds.length > 0) {
    const { data: items } = await db.from('pedido_items')
      .select('cantidad, subtotal, productos(descripcion, unidad)')
      .in('pedido_id', pedidoIds)
    for (const it of (items||[])) {
      const k = it.productos?.descripcion || '-'
      if (!prodMap[k]) prodMap[k] = { nombre:k, unidad: it.productos?.unidad||'', cant:0, monto:0 }
      prodMap[k].cant  += Number(it.cantidad)
      prodMap[k].monto += Number(it.subtotal)
    }
  }
  const productos = Object.values(prodMap).sort((a,b) => b.monto - a.monto).slice(0,8)

  _repData = (pedidos||[]).map(p => ({ Pedido:'#'+p.numero, Fecha:formatFecha(p.fecha_pedido||p.created_at), Total:Number(p.total), Cobrado:Number(p.monto_cobrado||0), Estado: p.estado_cobro }))
  _repTitulo = 'Cliente: ' + _repSelNombre

  document.getElementById('rep-contenido').innerHTML = `
    <div class="rep-kpi3">
      <div class="rep-kpi"><div class="rep-kpi-v">${fmtM(facturado)}</div><div class="rep-kpi-l">Facturado</div></div>
      <div class="rep-kpi"><div class="rep-kpi-v" style="color:#1d9e75">${fmtM(cobrado)}</div><div class="rep-kpi-l">Cobrado</div></div>
      <div class="rep-kpi"><div class="rep-kpi-v" style="color:#e24b4a">${fmtM(debe)}</div><div class="rep-kpi-l">Debe</div></div>
    </div>
    <div class="rep-subtitulo">PEDIDOS DEL PERÍODO (${pedidos?.length||0})</div>
    ${(pedidos||[]).length === 0 ? '<p class="vacio">Sin pedidos en el período</p>' : pedidos.map(p => {
      const cobrado = p.estado_cobro === 'cobrado'
      return `<div class="rep-det-fila">
        <div><b>#${p.numero}</b> · ${formatFecha(p.fecha_pedido||p.created_at)}</div>
        <div style="text-align:right"><div style="font-weight:600;color:var(--color-marca-oscuro)">${fmtM(p.total)}</div>
          <span class="${cobrado?'rep-badge-v':'rep-badge-p'}">${cobrado?'Cobrado':'Pendiente'}</span></div>
      </div>`
    }).join('')}
    ${productos.length > 0 ? `
      <div class="rep-subtitulo">PRODUCTOS QUE MÁS COMPRA</div>
      ${productos.map(pr => `<div class="rep-det-fila">
        <div><b>${pr.nombre}</b><div class="rep-det-sub">${pr.cant.toLocaleString('es-AR')} ${pr.unidad}</div></div>
        <div style="font-weight:600;color:var(--color-marca-oscuro)">${fmtM(pr.monto)}</div>
      </div>`).join('')}` : ''}`
}

// ── REPORTE VENDEDOR ──
async function reporteVendedor(desde, hasta) {
  if (_repSelId) return reporteVendedorIndividual(desde, hasta)

  const [{ data: pedidos }, { data: cobros }, { data: vendedores }] = await Promise.all([
    db.from('pedidos').select('total, vendedor_id').gte('created_at', desde).lte('created_at', hasta).neq('estado','cancelado'),
    db.from('cobros').select('monto, vendedor_id').gte('created_at', desde).lte('created_at', hasta),
    db.from('perfiles').select('id, nombre_completo').neq('rol','cliente')
  ])

  const ranking = (vendedores||[]).map(v => {
    const peds = (pedidos||[]).filter(p => p.vendedor_id === v.id)
    const cobs = (cobros||[]).filter(c => c.vendedor_id === v.id)
    return {
      nombre: v.nombre_completo,
      pedidos: peds.length,
      facturado: peds.reduce((s,p)=>s+Number(p.total),0),
      cobrado: cobs.reduce((s,c)=>s+Number(c.monto),0)
    }
  }).filter(v => v.pedidos > 0 || v.cobrado > 0).sort((a,b) => b.facturado - a.facturado)

  const totalFact = ranking.reduce((s,r)=>s+r.facturado,0)
  const maxFact = ranking[0]?.facturado || 1
  _repData = ranking.map((r,i) => ({ '#':i+1, Vendedor:r.nombre, Pedidos:r.pedidos, Facturado:r.facturado, Cobrado:r.cobrado }))
  _repTitulo = 'Ventas por vendedor'

  document.getElementById('rep-contenido').innerHTML = `
    <div class="rep-resumen">
      <div><div class="rep-resumen-l">Total facturado</div><div class="rep-resumen-v">${fmtM(totalFact)}</div></div>
      <div style="text-align:right"><div class="rep-resumen-l">Vendedores</div><div class="rep-resumen-v" style="font-size:15px">${ranking.length}</div></div>
    </div>
    ${ranking.length === 0 ? '<p class="vacio">Sin datos en el período</p>' : ranking.map((r,i) => {
      const pct = r.facturado > 0 ? Math.round((r.cobrado/r.facturado)*100) : 0
      return `<div class="rep-fila">
        <div class="rep-rank">${i+1}</div>
        <div class="rep-fila-info">
          <div class="rep-fila-nombre">${r.nombre}</div>
          <div class="rep-fila-detalle">${r.pedidos} pedido${r.pedidos!==1?'s':''} · cobrado ${pct}%</div>
          <div class="rep-fila-bar"><div class="rep-fila-bar-fill" style="width:${Math.round((r.facturado/maxFact)*100)}%"></div></div>
        </div>
        <div class="rep-fila-monto">${fmtM(r.facturado)}</div>
      </div>`
    }).join('')}`
}

async function reporteVendedorIndividual(desde, hasta) {
  const [{ data: pedidos }, { data: cobros }] = await Promise.all([
    db.from('pedidos').select('id, numero, total, monto_cobrado, estado_cobro, fecha_pedido, created_at, clientes(razon_social)')
      .eq('vendedor_id', _repSelId).gte('created_at', desde).lte('created_at', hasta).neq('estado','cancelado').order('created_at',{ascending:false}),
    db.from('cobros').select('monto').eq('vendedor_id', _repSelId).gte('created_at', desde).lte('created_at', hasta)
  ])
  const facturado = (pedidos||[]).reduce((s,p)=>s+Number(p.total),0)
  const cobrado   = (cobros||[]).reduce((s,c)=>s+Number(c.monto),0)

  // Clientes que atendió
  const cliMap = {}
  for (const p of (pedidos||[])) {
    const k = p.clientes?.razon_social || '-'
    if (!cliMap[k]) cliMap[k] = { nombre:k, monto:0, pedidos:0 }
    cliMap[k].monto += Number(p.total); cliMap[k].pedidos += 1
  }
  const clientes = Object.values(cliMap).sort((a,b)=>b.monto-a.monto).slice(0,8)

  _repData = (pedidos||[]).map(p => ({ Pedido:'#'+p.numero, Cliente:p.clientes?.razon_social||'-', Fecha:formatFecha(p.fecha_pedido||p.created_at), Total:Number(p.total) }))
  _repTitulo = 'Vendedor: ' + _repSelNombre

  document.getElementById('rep-contenido').innerHTML = `
    <div class="rep-kpi3">
      <div class="rep-kpi"><div class="rep-kpi-v">${fmtM(facturado)}</div><div class="rep-kpi-l">Facturado</div></div>
      <div class="rep-kpi"><div class="rep-kpi-v" style="color:#1d9e75">${fmtM(cobrado)}</div><div class="rep-kpi-l">Cobrado</div></div>
      <div class="rep-kpi"><div class="rep-kpi-v">${pedidos?.length||0}</div><div class="rep-kpi-l">Pedidos</div></div>
    </div>
    <div class="rep-subtitulo">CLIENTES ATENDIDOS</div>
    ${clientes.length === 0 ? '<p class="vacio">Sin pedidos en el período</p>' : clientes.map(c => `
      <div class="rep-det-fila">
        <div><b>${c.nombre}</b><div class="rep-det-sub">${c.pedidos} pedido${c.pedidos!==1?'s':''}</div></div>
        <div style="font-weight:600;color:var(--color-marca-oscuro)">${fmtM(c.monto)}</div>
      </div>`).join('')}`
}

// ── REPORTE PRODUCTOS ──
async function reporteProductos(desde, hasta) {
  // Traer pedidos del período (no cancelados)
  const { data: pedidos } = await db.from('pedidos').select('id').gte('created_at', desde).lte('created_at', hasta).neq('estado','cancelado')
  const ids = (pedidos||[]).map(p => p.id)
  if (ids.length === 0) {
    document.getElementById('rep-contenido').innerHTML = '<p class="vacio">Sin ventas en el período</p>'
    _repData = []; _repTitulo = 'Productos más vendidos'
    return
  }
  const { data: items } = await db.from('pedido_items')
    .select('cantidad, subtotal, productos(descripcion, unidad)').in('pedido_id', ids)

  const map = {}
  for (const it of (items||[])) {
    const k = it.productos?.descripcion || '-'
    if (!map[k]) map[k] = { nombre:k, unidad:it.productos?.unidad||'', cant:0, monto:0, veces:0 }
    map[k].cant += Number(it.cantidad); map[k].monto += Number(it.subtotal); map[k].veces += 1
  }
  const ranking = Object.values(map).sort((a,b)=>b.monto-a.monto)
  const totalMonto = ranking.reduce((s,r)=>s+r.monto,0)
  const maxMonto = ranking[0]?.monto || 1
  _repData = ranking.map((r,i) => ({ '#':i+1, Producto:r.nombre, Cantidad:r.cant, Unidad:r.unidad, 'Veces pedido':r.veces, Monto:r.monto }))
  _repTitulo = 'Productos más vendidos'

  document.getElementById('rep-contenido').innerHTML = `
    <div class="rep-resumen">
      <div><div class="rep-resumen-l">Más vendido</div><div class="rep-resumen-v" style="font-size:14px">${ranking[0]?.nombre||'-'}</div></div>
      <div style="text-align:right"><div class="rep-resumen-l">Total</div><div class="rep-resumen-v" style="font-size:15px">${fmtM(totalMonto)}</div></div>
    </div>
    ${ranking.map((r,i) => `
      <div class="rep-fila">
        <div class="rep-rank">${i+1}</div>
        <div class="rep-fila-info">
          <div class="rep-fila-nombre">${r.nombre}</div>
          <div class="rep-fila-detalle">${r.cant.toLocaleString('es-AR')} ${r.unidad} · ${r.veces} pedido${r.veces!==1?'s':''}</div>
          <div class="rep-fila-bar"><div class="rep-fila-bar-fill" style="width:${Math.round((r.monto/maxMonto)*100)}%"></div></div>
        </div>
        <div class="rep-fila-monto">${fmtM(r.monto)}</div>
      </div>`).join('')}`
}

// ── REPORTE COBRANZAS ──
async function reporteCobranzas(desde, hasta) {
  const { data: cobros } = await db.from('cobros').select('monto, medio_pago, created_at').gte('created_at', desde).lte('created_at', hasta)
  const total = (cobros||[]).reduce((s,c)=>s+Number(c.monto),0)

  // Por medio de pago
  const medios = {}
  for (const c of (cobros||[])) medios[c.medio_pago] = (medios[c.medio_pago]||0) + Number(c.monto)
  const maxMedio = Math.max(...Object.values(medios), 1)
  const iconos = { efectivo:'💵', transferencia:'🏦', cheque:'📋', echeq:'📱' }

  _repData = Object.entries(medios).map(([m,v]) => ({ 'Medio de pago': labelMedio(m), Monto: v }))
  _repData.push({ 'Medio de pago':'TOTAL', Monto: total })
  _repTitulo = 'Cobranzas por período'

  document.getElementById('rep-contenido').innerHTML = `
    <div class="rep-resumen">
      <div><div class="rep-resumen-l">Total cobrado</div><div class="rep-resumen-v">${fmtM(total)}</div></div>
      <div style="text-align:right"><div class="rep-resumen-l">Cobros</div><div class="rep-resumen-v" style="font-size:15px">${cobros?.length||0}</div></div>
    </div>
    <div class="rep-subtitulo">POR MEDIO DE PAGO</div>
    ${Object.keys(medios).length === 0 ? '<p class="vacio">Sin cobros en el período</p>' :
      Object.entries(medios).sort((a,b)=>b[1]-a[1]).map(([m,v]) => `
      <div class="rep-fila">
        <div class="rep-fila-info">
          <div class="rep-fila-nombre">${iconos[m]||'•'} ${labelMedio(m)}</div>
          <div class="rep-fila-bar"><div class="rep-fila-bar-fill" style="width:${Math.round((v/maxMedio)*100)}%"></div></div>
        </div>
        <div class="rep-fila-monto">${fmtM(v)}</div>
      </div>`).join('')}`
}

// ── EXPORTAR ──
function exportarReporteExcel() {
  if (!_repData || _repData.length === 0) { alert('No hay datos para exportar'); return }
  const cols = Object.keys(_repData[0])
  let csv = cols.join(',') + '\n'
  for (const row of _repData) {
    csv += cols.map(c => {
      let v = row[c]
      if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) v = '"' + v.replace(/"/g,'""') + '"'
      return v
    }).join(',') + '\n'
  }
  const blob = new Blob(['\ufeff' + csv], { type:'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${_repTitulo.replace(/[:\s]/g,'_')}_${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportarReportePDF() {
  if (!_repData || _repData.length === 0) { alert('No hay datos para exportar'); return }
  const cols = Object.keys(_repData[0])
  const w = window.open('', '_blank')
  const fmt = (v) => typeof v === 'number' ? '$' + v.toLocaleString('es-AR') : v
  w.document.write(`
    <html><head><title>${_repTitulo}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#1a1a1a}
      h1{color:#0d8fd1;font-size:20px;margin-bottom:4px}
      .sub{color:#888;font-size:13px;margin-bottom:20px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th{background:#0d8fd1;color:white;text-align:left;padding:8px 10px}
      td{padding:8px 10px;border-bottom:0.5px solid #e0e0e0}
      tr:nth-child(even){background:#f4f6f8}
    </style></head><body>
    <h1>🥛 La Cabaña — ${_repTitulo}</h1>
    <div class="sub">Cooperativa de Trabajo · Generado el ${new Date().toLocaleDateString('es-AR')}</div>
    <table>
      <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
      <tbody>${_repData.map(r => `<tr>${cols.map(c => `<td>${fmt(r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>
    </body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 400)
}

// Cerrar dropdown selector al tocar afuera
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('rep-selector-wrap')
  const dd = document.getElementById('rep-selector-dropdown')
  if (wrap && dd && dd.style.display !== 'none' && !wrap.contains(e.target)) {
    dd.style.display = 'none'
  }
})


// ================================================
// INFORMAR PAGO (Cliente)
// ================================================
let _informarPagoPedidoId = null

function abrirInformarPago(pedidoId, clienteNombre, pendiente) {
  _informarPagoPedidoId = pedidoId
  const modal = document.getElementById('modal-informar-pago')
  document.getElementById('ip-pedido-nombre').textContent = clienteNombre
  document.getElementById('ip-monto').value = pendiente || ''
  document.getElementById('ip-medio').value = 'transferencia'
  document.getElementById('ip-archivo').value = ''
  document.getElementById('ip-orden').value = ''
  toggleOrdenPago()
  modal.style.display = 'flex'
}

function cerrarInformarPago() {
  document.getElementById('modal-informar-pago').style.display = 'none'
  _informarPagoPedidoId = null
}

function toggleOrdenPago() {
  // La orden de pago aplica para transferencia/cheque/echeq, no para efectivo
  const medio = document.getElementById('ip-medio').value
  const wrap = document.getElementById('ip-orden-wrap')
  if (wrap) wrap.style.display = (medio === 'efectivo') ? 'none' : 'block'
}

async function confirmarInformarPago() {
  if (!_informarPagoPedidoId) return
  const monto  = Number(document.getElementById('ip-monto').value)
  const medio  = document.getElementById('ip-medio').value
  const orden  = document.getElementById('ip-orden').value
  const archivoFile = document.getElementById('ip-archivo').files[0]

  if (!monto || monto <= 0) { alert('Ingresá el monto del pago'); return }

  const btn = document.getElementById('ip-btn-confirmar')
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...' }

  // Subir comprobante si hay
  let comprobanteUrl = null
  if (archivoFile) {
    const ext = archivoFile.name.split('.').pop()
    const path = `pago_${_informarPagoPedidoId}_${Date.now()}.${ext}`
    const { error: upErr } = await db.storage.from('comprobantes').upload(path, archivoFile, { upsert: true })
    if (!upErr) {
      const { data: ud } = db.storage.from('comprobantes').getPublicUrl(path)
      comprobanteUrl = ud.publicUrl
    }
  }

  // Registrar el pago informado como PENDIENTE DE VERIFICAR (no descuenta deuda)
  const { data: pago, error } = await db.from('pagos_informados').insert({
    pedido_id:      _informarPagoPedidoId,
    cliente_id:     clienteIdUsuario,
    monto,
    medio_pago:     medio,
    orden_pago:     orden || null,
    comprobante_url: comprobanteUrl,
    estado:         'pendiente_verificar',
    informado_por:  usuarioActual.id
  }).select().single()

  if (error) {
    // Si la tabla no existe o falla, avisar claramente
    if (btn) { btn.disabled = false; btn.textContent = '✅ Informar pago' }
    alert('Error al informar el pago: ' + error.message + '\n\nVerificá que la tabla "pagos_informados" exista en la base.')
    return
  }

  // Registrar en historial del pedido
  await registrarHistorial(_informarPagoPedidoId, 'pago_informado',
    `Pago informado por el cliente — ${labelMedio(medio)} $${monto.toLocaleString('es-AR')}${comprobanteUrl ? ' | comprobante: ' + comprobanteUrl : ''}`)

  // Notificar a empresa/vendedor para verificar
  const { data: p } = await db.from('pedidos').select('numero, vendedor_id, clientes(razon_social)').eq('id', _informarPagoPedidoId).single()
  await db.from('notificaciones_admin').insert({
    tipo: 'pago_informado',
    mensaje: `${p?.clientes?.razon_social || 'Un cliente'} informó un pago de $${monto.toLocaleString('es-AR')} (${labelMedio(medio)}) en el pedido #${p?.numero} — verificar`,
    pedido_id: _informarPagoPedidoId,
    leida: false
  })

  if (btn) { btn.disabled = false; btn.textContent = '✅ Informar pago' }
  cerrarInformarPago()
  alert('✅ Pago informado. La empresa lo va a verificar pronto.')
  cargarCobranza()
}

// Verificar un pago informado (empresa/vendedor) — descuenta la deuda
async function verificarPagoInformado(pagoId) {
  const { data: pago } = await db.from('pagos_informados').select('*').eq('id', pagoId).single()
  if (!pago) return
  if (!confirm(`¿Verificar el pago de $${Number(pago.monto).toLocaleString('es-AR')}? Se registrará como cobrado.`)) return

  // Registrar el cobro real
  await db.from('cobros').insert({
    pedido_id:   pago.pedido_id,
    monto:       pago.monto,
    medio_pago:  pago.medio_pago,
    vendedor_id: usuarioActual.id,
    comprobante_url: pago.comprobante_url || null
  })

  // Actualizar el pedido (sumar a monto_cobrado)
  const { data: ped } = await db.from('pedidos').select('total, monto_cobrado').eq('id', pago.pedido_id).single()
  const nuevoCobrado = Number(ped?.monto_cobrado || 0) + Number(pago.monto)
  const estadoCobro = nuevoCobrado >= Number(ped?.total || 0) ? 'cobrado' : 'parcial'
  await db.from('pedidos').update({ monto_cobrado: nuevoCobrado, estado_cobro: estadoCobro }).eq('id', pago.pedido_id)

  // Marcar el pago como verificado
  await db.from('pagos_informados').update({ estado: 'verificado', verificado_por: usuarioActual.id }).eq('id', pagoId)

  // Notificar al cliente
  if (pago.cliente_id) {
    const { data: p } = await db.from('pedidos').select('numero').eq('id', pago.pedido_id).single()
    await db.from('notificaciones').insert({
      usuario_id: pago.cliente_id,
      tipo: 'pago_verificado',
      titulo: 'Pago verificado ✅',
      mensaje: `Tu pago del pedido #${p?.numero} fue verificado. ¡Gracias!`,
      leida: false
    })
  }

  alert('✅ Pago verificado y registrado.')
  cargarCobranza()
}
