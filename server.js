const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST','PUT','DELETE'] } });

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const validTokens = new Set();

app.use(cors());
app.use(express.json());
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.use('/mesa', express.static(path.join(__dirname, 'public/mesa')));
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !validTokens.has(token)) return res.status(401).json({ error: 'Não autorizado' });
  next();
}

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin/index.html')));
app.get('/mesa/:numero', (req, res) => res.sendFile(path.join(__dirname, 'public/mesa/index.html')));

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  if (req.body.senha !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha incorreta' });
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  validTokens.add(token);
  res.json({ token });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) validTokens.delete(token);
  res.json({ ok: true });
});

// ── Menu ──────────────────────────────────────────────────────────────────────

app.get('/api/menu', async (req, res) => {
  try {
    const token = req.headers['x-admin-token'] || req.query.token;
    const isAdmin = token && validTokens.has(token);
    res.json(await (isAdmin ? db.getAllMenuItems() : db.getAvailableMenuItems()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/menu', requireAdmin, async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, emoji, prato_do_dia } = req.body;
    if (!nome || !preco || !categoria) return res.status(400).json({ error: 'Campos obrigatórios: nome, preco, categoria' });
    const result = await db.addMenuItem(nome, descricao || '', parseFloat(preco), categoria, emoji || '🍽️', prato_do_dia);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/menu/:id', requireAdmin, async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, emoji, disponivel, prato_do_dia } = req.body;
    await db.updateMenuItem(req.params.id, nome, descricao || '', parseFloat(preco), categoria, emoji || '🍽️',
      disponivel !== false && disponivel !== 0, prato_do_dia);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/menu/:id', requireAdmin, async (req, res) => {
  try { await db.deleteMenuItem(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mesa info (público) ───────────────────────────────────────────────────────

app.get('/api/mesa/:numero/info', async (req, res) => {
  try {
    const tables = await db.getAllTables();
    const mesa = tables.find(m => m.numero === parseInt(req.params.numero));
    if (!mesa) return res.status(404).json({ error: 'Mesa não encontrada' });
    res.json({ numero: mesa.numero, status: mesa.status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Mesas ─────────────────────────────────────────────────────────────────────

app.get('/api/mesas', requireAdmin, async (req, res) => {
  try { res.json(await db.getAllTables()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mesas', requireAdmin, async (req, res) => {
  try {
    const { numero } = req.body;
    if (!numero) return res.status(400).json({ error: 'Número da mesa é obrigatório' });
    const result = await db.addTable(parseInt(numero));
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Mesa já existe' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/mesas/:numero/status', requireAdmin, async (req, res) => {
  try { await db.updateTableStatus(req.params.numero, req.body.status); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Pedidos ───────────────────────────────────────────────────────────────────

app.get('/api/pedidos', requireAdmin, async (req, res) => {
  try { res.json(await db.getAllActiveOrders()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/pedidos/mesa/:numero', async (req, res) => {
  try { res.json(await db.getOrdersByMesa(parseInt(req.params.numero))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { mesa_numero, forma_pagamento, troco_para, total, items } = req.body;
    if (!mesa_numero || !items || items.length === 0) return res.status(400).json({ error: 'Dados inválidos' });
    const tables = await db.getAllTables();
    const mesa = tables.find(m => m.numero === parseInt(mesa_numero));
    if (mesa && mesa.status !== 'active') return res.status(403).json({ error: 'Mesa inativa' });
    const orderId = await db.createOrder(parseInt(mesa_numero), forma_pagamento || '', parseFloat(troco_para) || 0, parseFloat(total), items);
    const order = await db.getOrderById(orderId);
    io.to('admin').emit('novo_pedido', order);
    io.to(`mesa_${mesa_numero}`).emit('pedido_criado', order);
    res.status(201).json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/pedidos/:id/status', requireAdmin, async (req, res) => {
  try {
    await db.updateOrderStatus(req.params.id, req.body.status);
    const order = await db.getOrderById(req.params.id);
    io.to(`mesa_${order.mesa_numero}`).emit('status_atualizado', order);
    io.to('admin').emit('status_atualizado', order);
    res.json({ ok: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pedidos/:id/finalizar', requireAdmin, async (req, res) => {
  try {
    const { forma_pagamento, troco_para } = req.body;
    if (!forma_pagamento) return res.status(400).json({ error: 'Forma de pagamento obrigatória' });
    const order = await db.getOrderById(req.params.id);
    await db.finalizeOrder(req.params.id, forma_pagamento, troco_para || 0);
    io.to('admin').emit('pedido_removido');
    if (order) io.to(`mesa_${order.mesa_numero}`).emit('pedido_removido');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/pedidos/:id/item/:itemId', requireAdmin, async (req, res) => {
  try {
    await db.removeOrderItem(req.params.id, req.params.itemId);
    const order = await db.getOrderById(req.params.id);
    if (order) {
      io.to(`mesa_${order.mesa_numero}`).emit('status_atualizado', order);
      io.to('admin').emit('status_atualizado', order);
    }
    io.to('admin').emit('pedido_removido');
    res.json({ ok: true, order });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Conta / Resetar ───────────────────────────────────────────────────────────

app.post('/api/conta/:mesa_numero', async (req, res) => {
  try {
    const mesa_numero = parseInt(req.params.mesa_numero);
    const { forma_pagamento, troco_para } = req.body;
    if (!forma_pagamento) return res.status(400).json({ error: 'Selecione a forma de pagamento' });
    const total = await db.getTotalAtivoByMesa(mesa_numero);
    if (!total || total === 0) return res.status(400).json({ error: 'Nenhum pedido ativo nesta mesa' });
    await db.closeAllOrdersByMesa(mesa_numero, forma_pagamento, troco_para || 0);
    io.to('admin').emit('conta_fechada', { mesa_numero, total, forma_pagamento, troco_para: troco_para || 0 });
    res.json({ ok: true, total });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mesas/:numero/resetar', requireAdmin, async (req, res) => {
  try {
    const numero = parseInt(req.params.numero);
    const { forma_pagamento, troco_para } = req.body;
    await db.closeAllOrdersByMesa(numero, forma_pagamento || '', troco_para || 0);
    io.to(`mesa_${numero}`).emit('mesa_resetada');
    io.to('admin').emit('mesa_resetada', { mesa_numero: numero });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Relatório ─────────────────────────────────────────────────────────────────

function getTodayBRT() {
  const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return brtNow.toISOString().split('T')[0];
}

app.get('/api/relatorio/dia', requireAdmin, async (req, res) => {
  try {
    const date = req.query.data || getTodayBRT();
    const start = new Date(`${date}T03:00:00.000Z`);
    const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const orders = await db.getDailyReport(start.toISOString(), end.toISOString());
    const finalizados = orders.filter(o => o.status === 'finalizado');
    const total  = finalizados.reduce((s, o) => s + o.total, 0);
    const mesas  = new Set(finalizados.map(o => o.mesa_numero)).size;
    res.json({ orders, total, mesas, totalPedidos: orders.length, date });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/relatorio/mes', requireAdmin, async (req, res) => {
  try {
    const brtNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const year  = parseInt(req.query.ano) || brtNow.getUTCFullYear();
    const month = parseInt(req.query.mes) || (brtNow.getUTCMonth() + 1);
    const start = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0));
    const end   = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 3, 0, 0));
    const orders = await db.getDailyReport(start.toISOString(), end.toISOString());
    const finalizados = orders.filter(o => o.status === 'finalizado');
    const total = finalizados.reduce((s, o) => s + o.total, 0);
    const mesas = new Set(finalizados.map(o => o.mesa_numero)).size;
    res.json({ orders, total, mesas, totalPedidos: orders.length, year, month });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


  try {
    const date = req.query.data || getTodayBRT();
    const start = new Date(`${date}T03:00:00.000Z`);
    const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    await db.clearDailyOrders(start.toISOString(), end.toISOString());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── QR Code ───────────────────────────────────────────────────────────────────

app.get('/api/qrcode/:numero', async (req, res) => {
  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/mesa/${req.params.numero}`;
    const qr = await QRCode.toDataURL(url, { width: 300, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } });
    res.json({ url, qr });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  socket.on('join_admin', () => socket.join('admin'));
  socket.on('join_mesa', (numero) => socket.join(`mesa_${numero}`));
});

// ── Start ─────────────────────────────────────────────────────────────────────

db.initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 Comanda Digital rodando em http://localhost:${PORT}`);
    console.log(`   Admin:  http://localhost:${PORT}/admin`);
    console.log(`   Mesa 1: http://localhost:${PORT}/mesa/1\n`);
  });
}).catch(err => {
  console.error('Erro ao inicializar banco:', err);
  process.exit(1);
});
