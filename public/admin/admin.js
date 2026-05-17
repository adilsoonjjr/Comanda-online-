'use strict';

let token = localStorage.getItem('admin_token') || '';
let socket = null;
let newOrderCount = 0;

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
    atualizarBadges();
    tocarSom();
    mostrarToast('🛎️', `Novo pedido — Mesa ${order.mesa_numero}`,
      `${order.items.length} item(s) · R$ ${fmt(order.total)}`);
    carregarPedidos();
  });

  socket.on('status_atualizado', () => {
    carregarPedidos();
  });
}

// ── Tabs ───────────────────────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');

  if (tab === 'pedidos') { newOrderCount = 0; atualizarBadges(); carregarPedidos(); }
  if (tab === 'cardapio') carregarMenu();
  if (tab === 'mesas') carregarMesas();
  if (tab === 'qrcodes') carregarQRCodes();
}

function toggleTab(tab) { switchTab(tab); }

function atualizarBadges() {
  const b = document.getElementById('bell-badge');
  const nb = document.getElementById('nav-badge-pedidos');
  b.style.display = newOrderCount > 0 ? 'flex' : 'none';
  nb.style.display = newOrderCount > 0 ? 'inline' : 'none';
  b.textContent = nb.textContent = newOrderCount;
}

// ── Pedidos ────────────────────────────────────────────────────────────────

async function carregarPedidos() {
  try {
    const res = await fetch('/api/pedidos', { headers: { 'x-admin-token': token } });
    if (res.status === 401) { fazerLogout(); return; }
    const pedidos = await res.json();
    renderStats(pedidos);
    renderPedidos(pedidos);
  } catch { /* ignore */ }
}

function renderStats(pedidos) {
  const pendentes = pedidos.filter(p => p.status === 'pendente').length;
  const preparando = pedidos.filter(p => p.status === 'preparando').length;
  const prontos = pedidos.filter(p => p.status === 'pronto').length;
  const total = pedidos.reduce((s, p) => s + p.total, 0);
  document.getElementById('stats-bar').innerHTML = `
    <div class="stat-card"><div class="stat-label">Pendentes</div><div class="stat-value stat-yellow">${pendentes}</div></div>
    <div class="stat-card"><div class="stat-label">Preparando</div><div class="stat-value stat-blue">${preparando}</div></div>
    <div class="stat-card"><div class="stat-label">Prontos</div><div class="stat-value stat-green">${prontos}</div></div>
    <div class="stat-card"><div class="stat-label">Total do dia</div><div class="stat-value stat-orange">R$ ${fmt(total)}</div></div>
  `;
}

function renderPedidos(pedidos) {
  const container = document.getElementById('pedidos-container');
  if (pedidos.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <div class="icon">🍽️</div><p>Nenhum pedido ativo no momento.</p>
    </div>`;
    return;
  }
  container.innerHTML = pedidos.map(p => {
    const itens = p.items.map(i =>
      `<div class="order-item">
        <span><span class="item-qty">${i.quantidade}x</span> ${i.nome_item}</span>
        <span class="item-price">R$ ${fmt(i.preco_unitario * i.quantidade)}</span>
      </div>`
    ).join('');

    const pagInfo = p.forma_pagamento
      ? `<div class="pagamento-info">💳 ${p.forma_pagamento}${p.troco_para > 0 ? ` · Troco p/ R$ ${fmt(p.troco_para)}` : ''}</div>`
      : '';

    const actions = buildActions(p);
    const hora = new Date(p.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    return `
    <div class="order-card" id="order-${p.id}">
      <div class="card-header">
        <span class="mesa-badge">Mesa ${p.mesa_numero}</span>
        <span class="status-badge status-${p.status}">${statusLabel(p.status)}</span>
      </div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">⏰ ${hora}</div>
      <div class="order-items">${itens}</div>
      <div class="card-total">
        <span class="total-label">Total</span>
        <span class="total-value">R$ ${fmt(p.total)}</span>
      </div>
      ${pagInfo}
      <div class="card-actions">${actions}</div>
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
  return btns.join('');
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
      <td><span class="disponivel-badge ${i.disponivel ? 'disp-sim' : 'disp-nao'}">${i.disponivel ? 'Sim' : 'Não'}</span></td>
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
  document.getElementById('item-emoji').value = '';
  document.getElementById('item-nome').value = '';
  document.getElementById('item-descricao').value = '';
  document.getElementById('item-preco').value = '';
  document.getElementById('item-categoria').value = 'Bebidas';
  document.getElementById('item-disponivel').checked = true;
  document.getElementById('modal-item').classList.add('open');
}

function editarItem(id) {
  const item = (window._menuItems || []).find(i => i.id === id);
  if (!item) return;
  document.getElementById('modal-item-title').textContent = 'Editar Item';
  document.getElementById('item-id').value = item.id;
  document.getElementById('item-emoji').value = item.emoji;
  document.getElementById('item-nome').value = item.nome;
  document.getElementById('item-descricao').value = item.descricao;
  document.getElementById('item-preco').value = item.preco;
  document.getElementById('item-categoria').value = item.categoria;
  document.getElementById('item-disponivel').checked = !!item.disponivel;
  document.getElementById('modal-item').classList.add('open');
}

async function salvarItem() {
  const id = document.getElementById('item-id').value;
  const body = {
    nome: document.getElementById('item-nome').value,
    descricao: document.getElementById('item-descricao').value,
    preco: document.getElementById('item-preco').value,
    categoria: document.getElementById('item-categoria').value,
    emoji: document.getElementById('item-emoji').value || '🍽️',
    disponivel: document.getElementById('item-disponivel').checked,
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
    </div>
  `).join('');
}

function abrirModalMesa() {
  document.getElementById('mesa-numero').value = '';
  document.getElementById('modal-mesa').classList.add('open');
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
  carregarMesas();
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
    [440, 550, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.15);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.15);
    });
  } catch { /* audio not available */ }
}

// ── Init ───────────────────────────────────────────────────────────────────

document.getElementById('senha-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') fazerLogin();
});

document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

if (token) {
  fetch('/api/pedidos', { headers: { 'x-admin-token': token } })
    .then(r => r.ok ? iniciarApp() : fazerLogout())
    .catch(() => { /* show login */ });
}
