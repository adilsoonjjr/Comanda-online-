'use strict';

const mesaNumero = parseInt(location.pathname.split('/').pop()) || 1;
const NOME_KEY = `nome_mesa_${mesaNumero}`;
let menuItems = [];
let cart = {};
let formaPagamentoFinal = '';
let totalEnviado = 0;
let socket = null;
let _addItemId = null;
let _addItemQty = 1;

document.getElementById('mesa-num-header').textContent = mesaNumero;
document.title = `Mesa ${mesaNumero} — Cardápio`;

(async function init() {
  const ativa = await verificarMesaAtiva();
  if (!ativa) return;
  await carregarMenu();
  await carregarPedidosExistentes();
  conectarSocket();
  iniciarNomeCliente();
})();

// ── Nome do cliente ────────────────────────────────────────────────────────

function iniciarNomeCliente() {
  const nome = localStorage.getItem(NOME_KEY);
  if (nome) {
    exibirNomeCliente(nome);
  } else {
    document.getElementById('modal-nome').classList.add('open');
    setTimeout(() => document.getElementById('nome-cliente-input').focus(), 150);
  }
}

function salvarNomeCliente() {
  const nome = document.getElementById('nome-cliente-input').value.trim() || 'Cliente';
  localStorage.setItem(NOME_KEY, nome);
  document.getElementById('modal-nome').classList.remove('open');
  exibirNomeCliente(nome);
}

function exibirNomeCliente(nome) {
  document.getElementById('header-cliente-nome').textContent = `👤 ${nome}`;
}

document.getElementById('nome-cliente-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') salvarNomeCliente();
});

async function carregarPedidosExistentes() {
  try {
    const res = await fetch(`/api/pedidos/mesa/${mesaNumero}`);
    const pedidos = await res.json();
    if (!Array.isArray(pedidos) || pedidos.length === 0) return;
    totalEnviado = pedidos.reduce((s, p) => s + p.total, 0);
    atualizarLabelFecharConta();
    // mostra status do pedido mais recente
    const ultimo = pedidos[0];
    if (ultimo && ultimo.status !== 'finalizado') {
      atualizarStatusBanner(ultimo.status);
    }
  } catch { /* sem pedidos anteriores */ }
}

async function verificarMesaAtiva() {
  try {
    const res = await fetch(`/api/mesa/${mesaNumero}/info`);
    if (!res.ok) return true;
    const data = await res.json();
    if (data.status !== 'active') {
      document.getElementById('mesa-inativa').style.display = 'flex';
      document.querySelector('.header').style.display = 'none';
      document.querySelector('.fechar-conta-bar').style.display = 'none';
      return false;
    }
    return true;
  } catch { return true; }
}

// ── Socket ─────────────────────────────────────────────────────────────────

function conectarSocket() {
  socket = io();
  socket.emit('join_mesa', mesaNumero);

  socket.on('status_atualizado', async (order) => {
    atualizarStatusBanner(order.status);
    try {
      const res = await fetch(`/api/pedidos/mesa/${mesaNumero}`);
      const pedidos = await res.json();
      totalEnviado = pedidos.reduce((s, p) => s + p.total, 0);
      atualizarLabelFecharConta();
    } catch { /* mantém total local */ }
  });

  socket.on('pedido_removido', async () => {
    try {
      const res = await fetch(`/api/pedidos/mesa/${mesaNumero}`);
      const pedidos = await res.json();
      totalEnviado = pedidos.reduce((s, p) => s + p.total, 0);
      atualizarLabelFecharConta();
    } catch { /* mantém total local */ }
  });

  socket.on('mesa_resetada', () => {
    localStorage.removeItem(NOME_KEY);
    document.getElementById('tela-aguardando').querySelector('.aguardando-icon').textContent = '🎉';
    document.getElementById('tela-aguardando').querySelector('.aguardando-title').textContent = 'Obrigado pela visita!';
    document.getElementById('tela-aguardando').querySelector('.aguardando-sub').textContent = 'Volte sempre!';
    setTimeout(() => location.reload(), 3000);
  });
}

// ── Menu ───────────────────────────────────────────────────────────────────

async function carregarMenu() {
  const res = await fetch('/api/menu');
  menuItems = await res.json();
  renderPratoDoDia();
  renderCategorias();
  renderMenu(menuItems);
}

function renderPratoDoDia() {
  const pratos = menuItems.filter(i => i.prato_do_dia && i.disponivel);
  const section = document.getElementById('prato-dia-section');
  if (!pratos.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  section.innerHTML = pratos.map(i => `
    <div class="prato-dia-card">
      <div style="flex:1">
        <div class="prato-dia-badge">⭐ Prato do Dia</div>
        <div class="prato-dia-nome">${i.nome}</div>
        ${i.descricao ? `<div class="prato-dia-desc">${i.descricao}</div>` : ''}
        <div class="prato-dia-price">R$ ${fmt(i.preco)}</div>
      </div>
      <button class="prato-dia-add" onclick="adicionarItem(${i.id})">+</button>
    </div>
  `).join('<div style="height:10px"></div>');
}

function renderCategorias() {
  const cats = ['Todos', ...new Set(menuItems.map(i => i.categoria))];
  document.getElementById('cats-wrap').innerHTML = cats.map((c, idx) =>
    `<button class="cat-btn ${idx === 0 ? 'active' : ''}" onclick="filtrarCategoria('${c}', this)">${c}</button>`
  ).join('');
}

function filtrarCategoria(cat, btn) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMenu(cat === 'Todos' ? menuItems : menuItems.filter(i => i.categoria === cat));
}

function renderMenu(items) {
  document.getElementById('menu-grid').innerHTML = items.map(i => `
    <div class="item-card">
      <div class="item-body">
        <div class="item-name">${i.nome}</div>
        ${i.descricao ? `<div class="item-desc">${i.descricao}</div>` : ''}
        <div class="item-footer">
          <span class="item-price">R$ ${fmt(i.preco)}</span>
          <button class="add-btn" onclick="adicionarItem(${i.id})">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Cart ───────────────────────────────────────────────────────────────────

function adicionarItem(id) {
  const item = menuItems.find(i => i.id === id);
  if (!item) return;
  _addItemId = id;
  _addItemQty = 1;
  document.getElementById('add-item-nome').textContent = item.nome;
  document.getElementById('add-item-preco').textContent = `R$ ${fmt(item.preco)}`;
  document.getElementById('add-item-desc').textContent = item.descricao || '';
  document.getElementById('add-item-qty').textContent = '1';
  document.getElementById('add-item-obs').value = '';
  document.getElementById('modal-add-item').classList.add('open');
  setTimeout(() => document.getElementById('add-item-obs').focus(), 200);
}

function alterarQtdAdd(delta) {
  _addItemQty = Math.max(1, _addItemQty + delta);
  document.getElementById('add-item-qty').textContent = _addItemQty;
}

function fecharModalAddItem() {
  document.getElementById('modal-add-item').classList.remove('open');
  _addItemId = null;
}

function confirmarAddItem() {
  if (!_addItemId) return;
  const item = menuItems.find(i => i.id === _addItemId);
  if (!item) return;
  const obs = document.getElementById('add-item-obs').value.trim();
  if (!cart[_addItemId]) cart[_addItemId] = { item, qty: 0, obs: '' };
  cart[_addItemId].qty += _addItemQty;
  if (obs) cart[_addItemId].obs = obs;
  fecharModalAddItem();
  atualizarBadgeCarrinho();
  mostrarToastAdicionado(item.nome);
  animarCarrinho();
}

function mostrarToastAdicionado(nome) {
  const el = document.getElementById('toast-adicionado');
  el.innerHTML = `✅ <span>${nome}</span> adicionado!`;
  el.classList.remove('visible');
  void el.offsetWidth;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), 2000);
}

function animarCarrinho() {
  const btn = document.querySelector('.cart-btn');
  btn.classList.remove('bounce');
  void btn.offsetWidth;
  btn.classList.add('bounce');
}

function alterarQtd(id, delta) {
  if (!cart[id]) return;
  cart[id].qty += delta;
  if (cart[id].qty <= 0) delete cart[id];
  renderCarrinho();
  atualizarBadgeCarrinho();
}

function atualizarBadgeCarrinho() {
  const total = Object.values(cart).reduce((s, v) => s + v.qty, 0);
  const badge = document.getElementById('cart-count');
  const badgeBar = document.getElementById('cart-count-bar');
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
  badgeBar.textContent = total;
  badgeBar.style.display = total > 0 ? 'inline' : 'none';
}

function totalCarrinho() {
  return Object.values(cart).reduce((s, v) => s + v.item.preco * v.qty, 0);
}

function abrirCarrinho() {
  renderCarrinho();
  document.getElementById('drawer-overlay').classList.add('open');
  document.getElementById('cart-drawer').classList.add('open');
}

function fecharCarrinho() {
  document.getElementById('drawer-overlay').classList.remove('open');
  document.getElementById('cart-drawer').classList.remove('open');
}

function renderCarrinho() {
  const items = Object.values(cart);
  const container = document.getElementById('cart-items');
  const footer = document.getElementById('cart-footer');

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-cart"><div class="icon">🛒</div><p>Carrinho vazio.<br>Adicione itens do cardápio!</p></div>`;
    footer.style.display = 'none';
    return;
  }

  container.innerHTML = items.map(({ item, qty, obs }) => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.nome}</div>
        ${obs ? `<div class="cart-item-obs">📝 ${obs}</div>` : ''}
        <div class="cart-item-price">R$ ${fmt(item.preco * qty)}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="alterarQtd(${item.id}, -1)">−</button>
        <span class="qty-num">${qty}</span>
        <button class="qty-btn" onclick="alterarQtd(${item.id}, 1)">+</button>
      </div>
    </div>
  `).join('');

  document.getElementById('cart-total-val').textContent = `R$ ${fmt(totalCarrinho())}`;
  footer.style.display = 'block';
}

// ── Checkout (enviar pedido, sem pagamento) ────────────────────────────────

function abrirCheckout() {
  fecharCarrinho();
  const items = Object.values(cart);
  const linhas = items.map(({ item, qty, obs }) =>
    `<div class="summary-item"><span>${qty}x ${item.nome}${obs ? `<br><span style="font-size:11px;color:var(--text2)">📝 ${obs}</span>` : ''}</span><span>R$ ${fmt(item.preco * qty)}</span></div>`
  ).join('');
  document.getElementById('checkout-summary').innerHTML = `
    ${linhas}
    <div class="summary-total"><span>Total</span><span>R$ ${fmt(totalCarrinho())}</span></div>
  `;
  document.getElementById('checkout-overlay').classList.add('open');
}

function fecharCheckout() {
  document.getElementById('checkout-overlay').classList.remove('open');
  abrirCarrinho();
}

async function confirmarPedido() {
  const items = Object.values(cart);
  if (items.length === 0) { alert('Carrinho vazio'); return; }

  const body = {
    mesa_numero: mesaNumero,
    forma_pagamento: '',
    troco_para: 0,
    total: totalCarrinho(),
    items: items.map(({ item, qty, obs }) => ({
      item_id: item.id, quantidade: qty,
      preco_unitario: item.preco, nome_item: item.nome,
      observacao: obs || '',
    })),
  };

  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error); return; }

    totalEnviado += totalCarrinho();
    atualizarLabelFecharConta();

    document.getElementById('checkout-overlay').classList.remove('open');
    cart = {};
    atualizarBadgeCarrinho();
    atualizarStatusBanner('pendente');
    mostrarToast();
  } catch { alert('Erro ao enviar pedido. Tente novamente.'); }
}

// ── Fechar Conta ───────────────────────────────────────────────────────────

async function abrirFecharConta() {
  // Busca total real do servidor
  try {
    const res = await fetch(`/api/pedidos/mesa/${mesaNumero}`);
    const pedidos = await res.json();
    totalEnviado = pedidos.reduce((s, p) => s + p.total, 0);
  } catch { /* usa totalEnviado local */ }

  if (totalEnviado === 0 && totalCarrinho() === 0) {
    alert('Nenhum pedido realizado ainda.'); return;
  }

  formaPagamentoFinal = '';
  document.querySelectorAll('#conta-overlay .pay-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('troco-final-group').classList.remove('visible');
  document.getElementById('troco-final-input').value = '';
  document.getElementById('total-geral-val').textContent = `R$ ${fmt(totalEnviado + totalCarrinho())}`;
  document.getElementById('conta-overlay').classList.add('open');
}

function fecharContaSheet() {
  document.getElementById('conta-overlay').classList.remove('open');
}

function selecionarPagamentoFinal(forma) {
  formaPagamentoFinal = forma;
  document.querySelectorAll('#conta-overlay .pay-btn').forEach(b => {
    b.classList.toggle('selected', b.querySelector('.pay-label').textContent === forma);
  });
  document.getElementById('troco-final-group').classList.toggle('visible', forma === 'Dinheiro');
}

async function confirmarFechamento() {
  if (!formaPagamentoFinal) { alert('Selecione a forma de pagamento'); return; }

  const troco = parseFloat(document.getElementById('troco-final-input').value) || 0;
  const totalGeral = totalEnviado + totalCarrinho();

  // Se há itens no carrinho, envia como pedido antes de fechar
  if (Object.keys(cart).length > 0) {
    const body = {
      mesa_numero: mesaNumero, forma_pagamento: '', troco_para: 0,
      total: totalCarrinho(),
      items: Object.values(cart).map(({ item, qty, obs }) => ({
        item_id: item.id, quantidade: qty, preco_unitario: item.preco, nome_item: item.nome,
        observacao: obs || '',
      })),
    };
    await fetch('/api/pedidos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    cart = {};
    atualizarBadgeCarrinho();
  }

  try {
    const res = await fetch(`/api/conta/${mesaNumero}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forma_pagamento: formaPagamentoFinal, troco_para: troco }),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error); return; }

    fecharContaSheet();

    // Configura link do WhatsApp
    const pagLabel = troco > 0 ? `${formaPagamentoFinal} (troco p/ R$ ${fmt(troco)})` : formaPagamentoFinal;
    const msg = `*Comanda Digital — Mesa ${mesaNumero}*\n\n*Total: R$ ${fmt(totalGeral)}*\nPagamento: ${pagLabel}\n\n_Gerado automaticamente_`;
    document.getElementById('btn-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;

    // Mostra tela aguardando
    document.getElementById('aguardando-total').textContent = `R$ ${fmt(totalGeral)}`;
    document.getElementById('aguardando-pag').textContent = pagLabel;
    document.getElementById('tela-aguardando').classList.add('visible');
  } catch { alert('Erro ao fechar conta. Tente novamente.'); }
}

// ── Helpers visuais ────────────────────────────────────────────────────────

function atualizarLabelFecharConta() {
  const btn = document.getElementById('btn-fechar-conta');
  const label = document.getElementById('fechar-total-label');
  if (totalEnviado > 0) {
    label.textContent = `R$ ${fmt(totalEnviado)}`;
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}

function atualizarStatusBanner(status) {
  const banner = document.getElementById('status-banner');
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const sub = document.getElementById('status-sub');
  banner.className = 'status-banner visible';
  if (status === 'preparando' || status === 'pronto') banner.classList.add(`status-${status}`);
  dot.className = `status-dot ${status}`;
  const labels = {
    pendente:   ['⏳ Pedido recebido', 'Aguardando preparo...'],
    preparando: ['👨‍🍳 Preparando seu pedido!', 'Já estamos no fogão, aguarde...'],
    pronto:     ['✅ Pedido pronto!', 'Pode buscar ou aguardar na mesa 🎉'],
  };
  [text.textContent, sub.textContent] = labels[status] || [status, ''];
}

function mostrarToast() {
  const toast = document.getElementById('toast-pedido');
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
