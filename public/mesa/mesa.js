'use strict';

const mesaNumero = parseInt(location.pathname.split('/').pop()) || 1;
let menuItems = [];
let cart = {};
let formaPagamento = '';
let pedidoAtual = null;
let socket = null;

document.getElementById('mesa-num-header').textContent = mesaNumero;
document.title = `Mesa ${mesaNumero} — Cardápio`;

(async function init() {
  await carregarMenu();
  conectarSocket();
})();

// ── Socket ─────────────────────────────────────────────────────────────────

function conectarSocket() {
  socket = io();
  socket.emit('join_mesa', mesaNumero);

  socket.on('status_atualizado', (order) => {
    if (pedidoAtual && order.id === pedidoAtual.id) {
      pedidoAtual = order;
      atualizarStatusBanner(order.status);
    }
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
  if (!cart[id]) cart[id] = { item, qty: 0 };
  cart[id].qty++;
  atualizarBadgeCarrinho();
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
  badge.textContent = total;
  badge.style.display = total > 0 ? 'flex' : 'none';
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
    container.innerHTML = `
      <div class="empty-cart">
        <div class="icon">🛒</div>
        <p>Seu carrinho está vazio.<br>Adicione itens do cardápio!</p>
      </div>`;
    footer.style.display = 'none';
    return;
  }

  container.innerHTML = items.map(({ item, qty }) => `
    <div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${item.nome}</div>
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

// ── Checkout ───────────────────────────────────────────────────────────────

function abrirCheckout() {
  fecharCarrinho();
  formaPagamento = '';
  document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('troco-group').classList.remove('visible');
  document.getElementById('troco-input').value = '';
  renderResumoCheckout();
  document.getElementById('checkout-overlay').classList.add('open');
}

function fecharCheckout() {
  document.getElementById('checkout-overlay').classList.remove('open');
  abrirCarrinho();
}

function selecionarPagamento(forma) {
  formaPagamento = forma;
  document.querySelectorAll('.pay-btn').forEach(b => {
    const label = b.querySelector('.pay-label');
    b.classList.toggle('selected', label && label.textContent === forma);
  });
  document.getElementById('troco-group').classList.toggle('visible', forma === 'Dinheiro');
}

function renderResumoCheckout() {
  const items = Object.values(cart);
  const linhas = items.map(({ item, qty }) =>
    `<div class="summary-item"><span>${qty}x ${item.nome}</span><span>R$ ${fmt(item.preco * qty)}</span></div>`
  ).join('');
  document.getElementById('checkout-summary').innerHTML = `
    ${linhas}
    <div class="summary-total"><span>Total</span><span>R$ ${fmt(totalCarrinho())}</span></div>
  `;
}

async function confirmarPedido() {
  if (!formaPagamento) { alert('Selecione a forma de pagamento'); return; }
  const items = Object.values(cart);
  if (items.length === 0) { alert('Carrinho vazio'); return; }

  const troco = parseFloat(document.getElementById('troco-input').value) || 0;
  if (formaPagamento === 'Dinheiro' && troco > 0 && troco < totalCarrinho()) {
    alert(`O valor para troco (R$ ${fmt(troco)}) deve ser maior ou igual ao total (R$ ${fmt(totalCarrinho())})`);
    return;
  }

  const body = {
    mesa_numero: mesaNumero,
    forma_pagamento: formaPagamento,
    troco_para: troco,
    total: totalCarrinho(),
    items: items.map(({ item, qty }) => ({
      item_id: item.id,
      quantidade: qty,
      preco_unitario: item.preco,
      nome_item: item.nome,
    })),
  };

  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); alert(d.error); return; }
    const order = await res.json();
    pedidoAtual = order;

    // Fecha checkout, limpa carrinho, volta ao cardápio
    document.getElementById('checkout-overlay').classList.remove('open');
    cart = {};
    atualizarBadgeCarrinho();

    // Configura link do WhatsApp
    const linhas = items.map(({ item, qty }) => `  ${qty}x ${item.nome} — R$ ${fmt(item.preco * qty)}`).join('\n');
    const pag = order.troco_para > 0
      ? `${order.forma_pagamento} (troco p/ R$ ${fmt(order.troco_para)})`
      : order.forma_pagamento;
    const msg = `*Comanda Digital — Mesa ${mesaNumero}*\n\n${linhas}\n\n*Total: R$ ${fmt(order.total)}*\nPagamento: ${pag}\n\n_Gerado automaticamente_`;
    document.getElementById('btn-whatsapp').href = `https://wa.me/?text=${encodeURIComponent(msg)}`;

    // Mostra status banner e toast
    atualizarStatusBanner('pendente');
    mostrarToastPedido();
  } catch { alert('Erro ao enviar pedido. Tente novamente.'); }
}

// ── Status Banner ──────────────────────────────────────────────────────────

function atualizarStatusBanner(status) {
  const banner = document.getElementById('status-banner');
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const sub = document.getElementById('status-sub');
  banner.classList.add('visible');
  dot.className = `status-dot ${status}`;
  const labels = {
    pendente:   ['⏳ Pedido recebido', 'Aguardando preparo...'],
    preparando: ['👨‍🍳 Preparando seu pedido', 'Já estamos no fogão!'],
    pronto:     ['✅ Pedido pronto!', 'Pode buscar ou aguardar na mesa'],
  };
  [text.textContent, sub.textContent] = labels[status] || [status, ''];
}

function mostrarToastPedido() {
  const toast = document.getElementById('toast-pedido');
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
