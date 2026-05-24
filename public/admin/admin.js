'use strict';

let token = localStorage.getItem('admin_token') || '';
let socket = null;
let newOrderCount = 0;
const newOrderIds = new Set(); // IDs de pedidos que chegaram via socket (piscam)

// ── Auth ───────────────────────────────────────────────────────────────────

async function fazerLogin() {
  const senha = document.getElementById('senha-input').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    });
    const data = await res.json();
    if (!res.ok) { errEl.textContent = data.error || 'Erro ao fazer login'; return; }
    token = data.token;
    localStorage.setItem('admin_token', token);
    iniciarApp();
  } catch {
    errEl.textContent = 'Erro de conexão';
  }
}

function fazerLogout() {
  fetch('/api/logout', { method: 'POST', headers: { 'x-admin-token': token } });
  localStorage.removeItem('admin_token');
  token = '';
  if (socket) socket.disconnect();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function iniciarApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  conectarSocket();
  carregarPedidos();
  carregarMenu();
  carregarMesas();
}

// ── Socket ─────────────────────────────────────────────────────────────────

function conectarSocket() {
  socket = io();
  socket.emit('join_admin');

  socket.on('novo_pedido', (order) => {
    newOrderCount++;
    newOrderIds.add(order.id);
    atualizarBadges();
    tocarSom();
    mostrarToast('🛎️', `Novo pedido — Mesa ${order.mesa_numero}`,
      `${order.items.length} item(s) · R$ ${fmt(order.total)}`);
    carregarPedidos();
  });

  socket.on('conta_fechada', (data) => {
    tocarSom();
    mostrarToast('🧾', `Mesa ${data.mesa_numero} quer fechar a conta`,
      `R$ ${fmt(data.total)} · ${data.forma_pagamento}${data.troco_para > 0 ? ` · troco p/ R$ ${fmt(data.troco_para)}` : ''}`);
    carregarPedidos();
  });

  socket.on('status_atualizado', (order) => {
    if (order && order.status !== 'pendente') newOrderIds.delete(order.id);
    carregarPedidos();
  });
  socket.on('mesa_resetada', () => { carregarPedidos(); });
  socket.on('pedido_removido', () => { carregarPedidos(); });
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(el => el.classList.add('active'));

  if (tab === 'pedidos') { newOrderCount = 0; atualizarBadges(); carregarPedidos(); }
  if (tab === 'cardapio') carregarMenu();
  if (tab === 'mesas') carregarMesas();
  if (tab === 'qrcodes') carregarQRCodes();
  if (tab === 'relatorio') carregarRelatorio();
}

function toggleTab(tab) { switchTab(tab); }

function atualizarBadges() {
  const b = document.getElementById('bell-badge');
  const nb = document.getElementById('nav-badge-pedidos');
  const bnb = document.getElementById('bn-badge-pedidos');
  const show = newOrderCount > 0;
  b.style.display = show ? 'flex' : 'none';
  nb.style.display = show ? 'inline' : 'none';
  bnb.style.display = show ? 'inline' : 'none';
  b.textContent = nb.textContent = bnb.textContent = newOrderCount;
}

// ── Pedidos ────────────────────────────────────────────────────────────────

let _mesaDetalhe = null;

async function carregarPedidos() {
  try {
    const [resPedidos, resRelatorio] = await Promise.all([
      fetch('/api/pedidos', { headers: { 'x-admin-token': token } }),
      fetch('/api/relatorio/dia', { headers: { 'x-admin-token': token } }),
    ]);
    if (resPedidos.status === 401) { fazerLogout(); return; }
    const pedidos = await resPedidos.json();
    const relatorio = resRelatorio.ok ? await resRelatorio.json() : { total: 0 };
    window._allPedidos = pedidos;
    renderStats(pedidos, relatorio.total || 0);
    renderMesasSummary(pedidos);
    if (_mesaDetalhe !== null) renderDetalhesMesa(_mesaDetalhe, pedidos);
  } catch { /* ignore */ }
}

function renderStats(pedidos, totalFinalizado) {
  const pendentes = pedidos.filter(p => p.status === 'pendente').length;
  const preparando = pedidos.filter(p => p.status === 'preparando').length;
  const prontos = pedidos.filter(p => p.status === 'pronto').length;
  const totalAtivo = pedidos.reduce((s, p) => s + p.total, 0);
  const totalDia = totalFinalizado + totalAtivo;
  document.getElementById('stats-bar').innerHTML = `
    <div class="stat-card"><div class="stat-label">Pendentes</div><div class="stat-value stat-yellow">${pendentes}</div></div>
    <div class="stat-card"><div class="stat-label">Preparando</div><div class="stat-value stat-blue">${preparando}</div></div>
    <div class="stat-card"><div class="stat-label">Prontos</div><div class="stat-value stat-green">${prontos}</div></div>
    <div class="stat-card"><div class="stat-label">Total do dia</div><div class="stat-value stat-orange">R$ ${fmt(totalDia)}</div></div>
  `;
}

function renderMesasSummary(pedidos) {
  const container = document.getElementById('pedidos-container');
  if (pedidos.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="icon">🍽️</div><p>Nenhum pedido ativo no momento.</p>
    </div>`;
    return;
  }

  const byMesa = {};
  pedidos.forEach(p => {
    if (!byMesa[p.mesa_numero]) byMesa[p.mesa_numero] = [];
    byMesa[p.mesa_numero].push(p);
  });

  container.innerHTML = Object.entries(byMesa)
    .sort(([, aOrders], [, bOrders]) => {
      const aMin = Math.min(...aOrders.map(o => new Date(o.created_at)));
      const bMin = Math.min(...bOrders.map(o => new Date(o.created_at)));
      return aMin - bMin;
    })
    .map(([mesa, orders]) => {
      const total = orders.reduce((s, o) => s + o.total, 0);
      const pendentes = orders.filter(o => o.status === 'pendente').length;
      const preparando = orders.filter(o => o.status === 'preparando').length;
      const prontos = orders.filter(o => o.status === 'pronto').length;
      const preview = orders
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .flatMap(o => o.items).slice(0, 6)
        .map(i => `${i.quantidade}x ${i.nome_item}`).join(', ');
      const newOrders = orders.filter(o => newOrderIds.has(o.id));
      const newItemsText = newOrders.flatMap(o => o.items).map(i => `${i.quantidade}x ${i.nome_item}`).join(', ');
      return `
      <div class="mesa-summary-card ${newOrders.length > 0 ? 'has-pendente' : ''}" onclick="abrirDetalhesMesa(${mesa})">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <span class="mesa-badge">Mesa ${mesa}</span>
          <span style="font-size:20px;font-weight:800;color:var(--accent)">R$ ${fmt(total)}</span>
        </div>
        ${newOrders.length > 0 ? `
        <div style="background:rgba(234,179,8,.12);border:1px solid var(--yellow);border-radius:8px;padding:7px 10px;margin-bottom:10px;font-size:12px;font-weight:700;color:var(--yellow)">
          🆕 Novo: ${newItemsText}
        </div>` : ''}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          ${pendentes > 0 ? `<span class="status-badge status-pendente">⏳ ${pendentes} pendente${pendentes > 1 ? 's' : ''}</span>` : ''}
          ${preparando > 0 ? `<span class="status-badge status-preparando">👨‍🍳 ${preparando} preparando</span>` : ''}
          ${prontos > 0 ? `<span class="status-badge status-pronto">✅ ${prontos} pronto${prontos > 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="msc-preview">${preview}</div>
        <div class="msc-footer">
          <span style="font-size:12px;color:var(--text2)">${orders.length} pedido${orders.length > 1 ? 's' : ''}</span>
          <div style="display:flex;gap:8px;align-items:center">
            <button onclick="event.stopPropagation();fecharTodasMesa(${mesa})"
              style="padding:6px 12px;background:rgba(239,68,68,.15);border:1px solid var(--red);border-radius:8px;color:var(--red);font-size:12px;font-weight:700;cursor:pointer">
              🧾 Fechar Conta
            </button>
            <span style="font-size:13px;color:var(--accent);font-weight:600">Ver detalhes →</span>
          </div>
        </div>
      </div>`;
    }).join('');
}

function abrirDetalhesMesa(mesaNumero) {
  _mesaDetalhe = parseInt(mesaNumero);
  renderDetalhesMesa(_mesaDetalhe, window._allPedidos || []);
  document.getElementById('mesa-detail-overlay').classList.add('open');
}

function fecharDetalhesMesa() {
  _mesaDetalhe = null;
  document.getElementById('mesa-detail-overlay').classList.remove('open');
}

function renderDetalhesMesa(mesaNumero, allPedidos) {
  const orders = allPedidos
    .filter(p => p.mesa_numero === mesaNumero)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (!orders.length) { fecharDetalhesMesa(); return; }

  const total = orders.reduce((s, o) => s + o.total, 0);
  document.getElementById('mesa-detail-title').textContent = `Mesa ${mesaNumero}`;
  document.getElementById('mesa-detail-total-header').textContent = `R$ ${fmt(total)}`;

  document.getElementById('mesa-detail-orders').innerHTML = orders.map(p => {
    const itens = p.items.map(i =>
      `<div class="order-item">
        <span><span class="item-qty">${i.quantidade}x</span> ${i.nome_item}</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="item-price">R$ ${fmt(i.preco_unitario * i.quantidade)}</span>
          <button onclick="removerItemPedido(${p.id},${i.id})" title="Remover item"
            style="background:rgba(239,68,68,.15);border:none;border-radius:6px;color:var(--red);cursor:pointer;padding:2px 7px;font-size:14px;font-weight:700;line-height:1">×</button>
        </div>
      </div>`
    ).join('');

    const pagInfo = p.forma_pagamento
      ? `<div class="pagamento-info">💳 ${p.forma_pagamento}${p.troco_para > 0 ? ` · Troco p/ R$ ${fmt(p.troco_para)}` : ''}</div>`
      : '';

    const hora = new Date(p.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' });

    return `
    <div class="order-card ${newOrderIds.has(p.id) ? 'is-pendente' : ''}" id="order-${p.id}" style="margin-bottom:16px">
      <div class="card-header">
        <span style="font-size:12px;color:var(--text2)">⏰ ${hora}</span>
        <span class="status-badge status-${p.status}">${statusLabel(p.status)}</span>
      </div>
      <div class="order-items">${itens}</div>
      <div class="card-total">
        <span class="total-label">Total</span>
        <span class="total-value">R$ ${fmt(p.total)}</span>
      </div>
      ${pagInfo}
      <div class="card-actions">${buildActions(p)}</div>
    </div>`;
  }).join('');
}

function buildActions(p) {
  const btns = [];
  if (p.status === 'pendente')
    btns.push(`<button class="btn-sm btn-preparar" onclick="mudarStatus(${p.id},'preparando')">Preparar</button>`);
  if (p.status === 'preparando')
    btns.push(`<button class="btn-sm btn-pronto" onclick="mudarStatus(${p.id},'pronto')">Pronto</button>`);
  if (p.status === 'pronto')
    btns.push(`<button class="btn-sm btn-finalizar" onclick="mudarStatus(${p.id},'finalizado')">Finalizar</button>`);
  btns.push(`<button class="btn-sm btn-danger" onclick="fecharPedido(${p.id},${p.total})" title="Fechar este pedido e confirmar pagamento">🧾 Fechar Pedido</button>`);
  return btns.join('');
}

let _pagAdmin = '';
let _fecharCallback = null;

function _abrirModalPagamento(total, callback) {
  _fecharCallback = callback;
  _pagAdmin = '';
  document.getElementById('fechar-admin-total-val').textContent = `R$ ${fmt(total)}`;
  document.getElementById('troco-admin-group').style.display = 'none';
  document.getElementById('troco-admin-input').value = '';
  document.querySelectorAll('#fechar-admin-pay-btns button').forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.background = 'var(--surface2)';
  });
  document.getElementById('modal-fechar-mesa-admin').classList.add('open');
}

function fecharPedido(pedidoId, pedidoTotal) {
  _abrirModalPagamento(pedidoTotal, async (forma, troco) => {
    await fetch(`/api/pedidos/${pedidoId}/finalizar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ forma_pagamento: forma, troco_para: troco }),
    });
  });
}

function fecharTodasMesa(mesaNumero) {
  const orders = (window._allPedidos || []).filter(p => p.mesa_numero === mesaNumero);
  const total = orders.reduce((s, o) => s + o.total, 0);
  _abrirModalPagamento(total, async (forma, troco) => {
    await fetch(`/api/mesas/${mesaNumero}/resetar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
      body: JSON.stringify({ forma_pagamento: forma, troco_para: troco }),
    });
    fecharDetalhesMesa();
  });
}

function selecionarPagAdmin(forma) {
  _pagAdmin = forma;
  document.querySelectorAll('#fechar-admin-pay-btns button').forEach(b => {
    b.style.borderColor = b.dataset.pag === forma ? 'var(--accent)' : 'var(--border)';
    b.style.background  = b.dataset.pag === forma ? 'rgba(249,115,22,.15)' : 'var(--surface2)';
  });
  document.getElementById('troco-admin-group').style.display = forma === 'Dinheiro' ? 'block' : 'none';
}

async function confirmarFecharMesaAdmin() {
  if (!_pagAdmin) { alert('Selecione a forma de pagamento'); return; }
  const troco = parseFloat(document.getElementById('troco-admin-input').value) || 0;
  if (_fecharCallback) await _fecharCallback(_pagAdmin, troco);
  fecharModal('modal-fechar-mesa-admin');
  carregarPedidos();
}

async function removerItemPedido(pedidoId, itemId) {
  if (!confirm('Remover este item do pedido?')) return;
  await fetch(`/api/pedidos/${pedidoId}/item/${itemId}`, {
    method: 'DELETE', headers: { 'x-admin-token': token },
  });
  carregarPedidos();
}

async function mudarStatus(id, status) {
  await fetch(`/api/pedidos/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ status }),
  });
  carregarPedidos();
}

// ── Menu ───────────────────────────────────────────────────────────────────

async function carregarMenu() {
  const res = await fetch('/api/menu', { headers: { 'x-admin-token': token } });
  const items = await res.json();
  const tbody = document.getElementById('menu-tbody');
  tbody.innerHTML = items.map(i => `
    <tr>
      <td class="item-emoji">${i.emoji}</td>
      <td><strong>${i.nome}</strong><br><small style="color:var(--text2)">${i.descricao}</small></td>
      <td>${i.categoria}</td>
      <td>R$ ${fmt(i.preco)}</td>
      <td>
        <button class="btn-sm ${i.disponivel ? 'btn-pronto' : 'btn-danger'}" onclick="toggleDisponivel(${i.id}, ${!i.disponivel})" style="padding:5px 12px;min-width:70px">
          ${i.disponivel ? '✅ Ativo' : '❌ Inativo'}
        </button>
      </td>
      <td>${i.prato_do_dia ? '<span class="disponivel-badge" style="background:rgba(234,179,8,.15);color:#d97706">⭐ Sim</span>' : '—'}</td>
      <td>
        <button class="btn-sm btn-preparar" onclick="editarItem(${i.id})" style="padding:5px 10px">✏️</button>
        <button class="btn-sm btn-danger" onclick="deletarItem(${i.id})" style="padding:5px 10px;margin-left:4px">🗑️</button>
      </td>
    </tr>
  `).join('');
  window._menuItems = items;
}

function abrirModalItem(id) {
  document.getElementById('modal-item-title').textContent = 'Novo Item';
  document.getElementById('item-id').value = '';
  document.getElementById('item-nome').value = '';
  document.getElementById('item-descricao').value = '';
  document.getElementById('item-preco').value = '';
  document.getElementById('item-categoria').value = 'Prato';
  document.getElementById('item-disponivel').checked = true;
  document.getElementById('item-prato-dia').checked = false;
  document.getElementById('modal-item').classList.add('open');
}

function editarItem(id) {
  const item = (window._menuItems || []).find(i => i.id === id);
  if (!item) return;
  document.getElementById('modal-item-title').textContent = 'Editar Item';
  document.getElementById('item-id').value = item.id;
  document.getElementById('item-nome').value = item.nome;
  document.getElementById('item-descricao').value = item.descricao;
  document.getElementById('item-preco').value = item.preco;
  document.getElementById('item-categoria').value = item.categoria;
  document.getElementById('item-disponivel').checked = !!item.disponivel;
  document.getElementById('item-prato-dia').checked = !!item.prato_do_dia;
  document.getElementById('modal-item').classList.add('open');
}

async function salvarItem() {
  const id = document.getElementById('item-id').value;
  const body = {
    nome: document.getElementById('item-nome').value,
    descricao: document.getElementById('item-descricao').value,
    preco: document.getElementById('item-preco').value,
    categoria: document.getElementById('item-categoria').value,
    emoji: '🍽️',
    disponivel: document.getElementById('item-disponivel').checked,
    prato_do_dia: document.getElementById('item-prato-dia').checked,
  };
  const url = id ? `/api/menu/${id}` : '/api/menu';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify(body),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error); return; }
  fecharModal('modal-item');
  carregarMenu();
}

async function toggleDisponivel(id, novoEstado) {
  const item = (window._menuItems || []).find(i => i.id === id);
  if (!item) return;
  await fetch(`/api/menu/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ ...item, disponivel: novoEstado, prato_do_dia: !!item.prato_do_dia }),
  });
  carregarMenu();
}

async function deletarItem(id) {
  if (!confirm('Remover este item do cardápio?')) return;
  await fetch(`/api/menu/${id}`, { method: 'DELETE', headers: { 'x-admin-token': token } });
  carregarMenu();
}

// ── Mesas ──────────────────────────────────────────────────────────────────

async function carregarMesas() {
  const res = await fetch('/api/mesas', { headers: { 'x-admin-token': token } });
  const mesas = await res.json();
  window._mesas = mesas;
  document.getElementById('mesas-container').innerHTML = mesas.map(m => `
    <div class="mesa-card">
      <div class="mesa-num">${m.numero}</div>
      <div class="mesa-status">${m.status === 'active' ? '✅ Ativa' : '❌ Inativa'}</div>
      ${m.status === 'active' ? `<button class="btn-sm btn-preparar" onclick="abrirAdicionarPedido(${m.numero})" style="margin-top:12px;width:100%">➕ Adicionar Pedido</button>` : ''}
      <button class="btn-sm ${m.status === 'active' ? 'btn-danger' : 'btn-pronto'}"
        onclick="toggleMesa(${m.numero}, '${m.status === 'active' ? 'inactive' : 'active'}')"
        style="margin-top:8px;width:100%">
        ${m.status === 'active' ? '🔴 Desativar' : '🟢 Ativar'}
      </button>
    </div>
  `).join('');
}

function abrirModalMesa() {
  document.getElementById('mesa-numero').value = '';
  document.getElementById('modal-mesa').classList.add('open');
}

async function toggleMesa(numero, novoStatus) {
  await fetch(`/api/mesas/${numero}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ status: novoStatus }),
  });
  carregarMesas();
}

async function salvarMesa() {
  const numero = document.getElementById('mesa-numero').value;
  const res = await fetch('/api/mesas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ numero }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error); return; }
  fecharModal('modal-mesa');
  await carregarMesas();
  if (document.getElementById('tab-qrcodes').classList.contains('active')) carregarQRCodes();
}

// ── QR Codes ───────────────────────────────────────────────────────────────

async function carregarQRCodes() {
  const mesas = window._mesas || [];
  if (!mesas.length) {
    const res = await fetch('/api/mesas', { headers: { 'x-admin-token': token } });
    window._mesas = await res.json();
  }
  const container = document.getElementById('qr-container');
  container.innerHTML = '<p style="color:var(--text2)">Gerando QR Codes...</p>';

  const qrCards = await Promise.all(
    (window._mesas || []).map(async (m) => {
      const res = await fetch(`/api/qrcode/${m.numero}`);
      const data = await res.json();
      return `
        <div class="qr-card">
          <h3>Mesa ${m.numero}</h3>
          <img src="${data.qr}" alt="QR Mesa ${m.numero}" id="qr-img-${m.numero}" />
          <div class="qr-url">${data.url}</div>
          <button class="btn-print" onclick="imprimirQR(${m.numero})">🖨️ Imprimir</button>
        </div>
      `;
    })
  );
  container.innerHTML = qrCards.join('');
}

function imprimirQR(numero) {
  const img = document.getElementById(`qr-img-${numero}`);
  const w = window.open('');
  w.document.write(`
    <html><head><title>QR Code Mesa ${numero}</title></head>
    <body style="text-align:center;font-family:sans-serif;padding:40px">
      <h1 style="font-size:28px;margin-bottom:8px">Mesa ${numero}</h1>
      <p style="color:#666;margin-bottom:20px">Escaneie para ver o cardápio</p>
      <img src="${img.src}" style="width:250px;height:250px" />
      <script>window.print();window.close();<\/script>
    </body></html>
  `);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fecharModal(id) {
  document.getElementById(id).classList.remove('open');
}

function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusLabel(s) {
  return { pendente: '⏳ Pendente', preparando: '👨‍🍳 Preparando', pronto: '✅ Pronto', finalizado: '📦 Finalizado' }[s] || s;
}

function mostrarToast(icon, title, msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<div class="toast-icon">${icon}</div><div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

function tocarSom() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const beep = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'triangle';
      gain.gain.setValueAtTime(0.6, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    beep(880, 0,    0.12);
    beep(880, 0.15, 0.12);
    beep(1320, 0.3, 0.22);
  } catch { /* audio not available */ }
}

// ── Adicionar Pedido (Admin) ───────────────────────────────────────────────

let _addPedidoMesa = null;
let _addCart = {};

function abrirAdicionarPedido(mesa) {
  _addPedidoMesa = mesa;
  _addCart = {};
  document.getElementById('add-pedido-mesa-num').textContent = mesa;
  renderAddPedidoItems();
  document.getElementById('modal-add-pedido').classList.add('open');
}

function renderAddPedidoItems() {
  const items = window._menuItems || [];
  const cats = [...new Set(items.map(i => i.categoria))];
  let html = '';
  cats.forEach(cat => {
    const catItems = items.filter(i => i.categoria === cat && i.disponivel);
    if (!catItems.length) return;
    html += `<div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px">${cat}</div>`;
    catItems.forEach(i => {
      const qty = (_addCart[i.id] || 0);
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1"><div style="font-size:14px;font-weight:600">${i.nome}</div><div style="font-size:13px;color:var(--accent)">R$ ${fmt(i.preco)}</div></div>
        <div style="display:flex;align-items:center;gap:8px">
          <button onclick="addCartAdmin(${i.id},-1)" style="width:28px;height:28px;border-radius:50%;border:1.5px solid var(--border);background:var(--surface2);color:var(--text);cursor:pointer;font-size:16px;font-weight:700">−</button>
          <span style="min-width:20px;text-align:center;font-weight:700">${qty}</span>
          <button onclick="addCartAdmin(${i.id},1)" style="width:28px;height:28px;border-radius:50%;border:none;background:var(--accent);color:#fff;cursor:pointer;font-size:16px;font-weight:700">+</button>
        </div>
      </div>`;
    });
  });
  document.getElementById('add-pedido-items').innerHTML = html || '<p style="color:var(--text2);text-align:center;padding:20px">Nenhum item disponível</p>';
  const total = Object.entries(_addCart).reduce((s, [id, qty]) => {
    const item = (window._menuItems || []).find(i => i.id === parseInt(id));
    return s + (item ? item.preco * qty : 0);
  }, 0);
  document.getElementById('add-pedido-total-val').textContent = `R$ ${fmt(total)}`;
}

function addCartAdmin(id, delta) {
  _addCart[id] = (_addCart[id] || 0) + delta;
  if (_addCart[id] <= 0) delete _addCart[id];
  renderAddPedidoItems();
}

async function confirmarPedidoAdmin() {
  const entries = Object.entries(_addCart);
  if (!entries.length) { alert('Selecione ao menos um item'); return; }
  const items = entries.map(([id, qty]) => {
    const item = (window._menuItems || []).find(i => i.id === parseInt(id));
    return { item_id: parseInt(id), quantidade: qty, preco_unitario: item.preco, nome_item: item.nome };
  });
  const total = items.reduce((s, i) => s + i.preco_unitario * i.quantidade, 0);
  const res = await fetch('/api/pedidos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-token': token },
    body: JSON.stringify({ mesa_numero: _addPedidoMesa, forma_pagamento: '', troco_para: 0, total, items }),
  });
  if (!res.ok) { const d = await res.json(); alert(d.error); return; }
  fecharModal('modal-add-pedido');
  carregarPedidos();
}

// ── Relatório ──────────────────────────────────────────────────────────────

let _acaoComSenha = null;

function pedirSenhaAdmin(acao) {
  _acaoComSenha = acao;
  document.getElementById('confirm-senha-input').value = '';
  document.getElementById('confirm-senha-error').textContent = '';
  document.getElementById('modal-confirm-senha').classList.add('open');
  setTimeout(() => document.getElementById('confirm-senha-input').focus(), 100);
}

async function confirmarComSenha() {
  const senha = document.getElementById('confirm-senha-input').value;
  const errEl = document.getElementById('confirm-senha-error');
  errEl.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    });
    if (!res.ok) { errEl.textContent = 'Senha incorreta'; return; }
    fecharModal('modal-confirm-senha');
    if (_acaoComSenha) _acaoComSenha();
  } catch { errEl.textContent = 'Erro de conexão'; }
}

function zerarRelatorio() {
  pedirSenhaAdmin(async () => {
    await fetch('/api/relatorio/dia', { method: 'DELETE', headers: { 'x-admin-token': token } });
    carregarRelatorio();
  });
}

async function carregarRelatorio() {
  try {
    const res = await fetch('/api/relatorio/dia', { headers: { 'x-admin-token': token } });
    const data = await res.json();
    renderRelatorio(data);
  } catch { document.getElementById('relatorio-lista').innerHTML = '<p style="color:var(--text2)">Erro ao carregar relatório.</p>'; }
}

function renderRelatorio(data) {
  const { orders, total, mesas, totalPedidos, date } = data;
  document.getElementById('relatorio-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Faturado hoje</div><div class="stat-value stat-orange">R$ ${fmt(total)}</div></div>
    <div class="stat-card"><div class="stat-label">Mesas atendidas</div><div class="stat-value stat-green">${mesas}</div></div>
    <div class="stat-card"><div class="stat-label">Pedidos</div><div class="stat-value stat-blue">${totalPedidos}</div></div>
  `;
  if (!orders.length) {
    document.getElementById('relatorio-lista').innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>Nenhum pedido hoje (${date})</p></div>`;
    return;
  }
  document.getElementById('relatorio-lista').innerHTML = `
    <div style="overflow-x:auto">
    <table class="menu-table">
      <thead><tr><th>Hora</th><th>Mesa</th><th>Itens</th><th>Total</th><th>Status</th><th>Pagamento</th></tr></thead>
      <tbody>
        ${orders.map(o => {
          const hora = new Date(o.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bahia' });
          const itens = o.items.map(i => `${i.quantidade}x ${i.nome_item}`).join(', ');
          const pag = o.forma_pagamento ? `${o.forma_pagamento}${o.troco_para > 0 ? ` (troco p/ R$ ${fmt(o.troco_para)})` : ''}` : '—';
          return `<tr>
            <td>${hora}</td>
            <td><span class="mesa-badge" style="font-size:12px">Mesa ${o.mesa_numero}</span></td>
            <td style="font-size:12px;color:var(--text2);max-width:200px">${itens}</td>
            <td style="font-weight:700;color:var(--accent)">R$ ${fmt(o.total)}</td>
            <td><span class="status-badge status-${o.status}">${statusLabel(o.status)}</span></td>
            <td style="font-size:12px;color:var(--text2)">${pag}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  `;
}

// ── Init ───────────────────────────────────────────────────────────────────

document.getElementById('senha-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') fazerLogin();
});
document.getElementById('confirm-senha-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmarComSenha();
});

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

if (token) {
  fetch('/api/pedidos', { headers: { 'x-admin-token': token } })
    .then(r => r.ok ? iniciarApp() : fazerLogout())
    .catch(() => { /* show login */ });
}
