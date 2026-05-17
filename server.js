const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');

const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'admin123';
// Simple in-memory token store (token -> true)
const validTokens = new Set();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// Serve static files
app.use('/admin', express.static(path.join(__dirname, 'public/admin')));
app.use('/mesa', express.static(path.join(__dirname, 'public/mesa')));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Helper ─────────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (!token || !validTokens.has(token)) {
    return res.status(401).json({ error: 'Não autorizado' });
  }
  next();
}

// ─── Page Routes ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.redirect('/admin');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/admin/index.html'));
});

// Serve mesa page for any table number
app.get('/mesa/:numero', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/mesa/index.html'));
});

// ─── API: Auth ────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { senha } = req.body;
  if (senha !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta' });
  }
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  validTokens.add(token);
  res.json({ token });
});

app.post('/api/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) validTokens.delete(token);
  res.json({ ok: true });
});

// ─── API: Menu ────────────────────────────────────────────────────────────────

app.get('/api/menu', async (req, res) => {
  try {
    const token = req.headers['x-admin-token'] || req.query.token;
    const isAdmin = token && validTokens.has(token);
    const items = await (isAdmin ? db.getAllMenuItems() : db.getAvailableMenuItems());
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/menu', requireAdmin, async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, emoji } = req.body;
    if (!nome || !preco || !categoria) {
      return res.status(400).json({ error: 'Campos obrigatórios: nome, preco, categoria' });
    }
    const result = await db.addMenuItem(nome, descricao || '', parseFloat(preco), categoria, emoji || '🍽️');
    res.status(201).json({ id: result.lastID });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/menu/:id', requireAdmin, async (req, res) => {
  try {
    const { nome, descricao, preco, categoria, emoji, disponivel } = req.body;
    await db.updateMenuItem(
      req.params.id,
      nome,
      descricao || '',
      parseFloat(preco),
      categoria,
      emoji || '🍽️',
      disponivel !== false && disponivel !== 0
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/menu/:id', requireAdmin, async (req, res) => {
  try {
    await db.deleteMenuItem(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Tables ─────────────────────────────────────────────────────────────

app.get('/api/mesas', requireAdmin, async (req, res) => {
  try {
    res.json(await db.getAllTables());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/mesas', requireAdmin, async (req, res) => {
  try {
    const { numero } = req.body;
    if (!numero) return res.status(400).json({ error: 'Número da mesa é obrigatório' });
    const result = await db.addTable(parseInt(numero));
    res.status(201).json({ id: result.lastID });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Mesa já existe' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/mesas/:numero/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await db.updateTableStatus(req.params.numero, status);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: Orders ──────────────────────────────────────────────────────────────

app.get('/api/pedidos', requireAdmin, async (req, res) => {
  try {
    res.json(await db.getAllActiveOrders());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pedidos/mesa/:numero', async (req, res) => {
  try {
    res.json(await db.getOrdersByMesa(parseInt(req.params.numero)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/pedidos', async (req, res) => {
  try {
    const { mesa_numero, forma_pagamento, troco_para, total, items } = req.body;
    if (!mesa_numero || !items || items.length === 0) {
      return res.status(400).json({ error: 'Dados do pedido inválidos' });
    }
    const orderId = await db.createOrder(
      parseInt(mesa_numero),
      forma_pagamento || '',
      parseFloat(troco_para) || 0,
      parseFloat(total),
      items
    );
    const order = await db.getOrderById(orderId);

    // Notify admin room
    io.to('admin').emit('novo_pedido', order);
    // Notify the mesa room too (so multiple tabs at same table sync)
    io.to(`mesa_${mesa_numero}`).emit('pedido_criado', order);

    res.status(201).json(order);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/pedidos/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await db.updateOrderStatus(req.params.id, status);
    const order = await db.getOrderById(req.params.id);

    // Notify the specific mesa room
    io.to(`mesa_${order.mesa_numero}`).emit('status_atualizado', order);
    // Also notify admin room so all admin tabs stay in sync
    io.to('admin').emit('status_atualizado', order);

    res.json({ ok: true, order });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── API: QR Code ────────────────────────────────────────────────────────────

app.get('/api/qrcode/:numero', async (req, res) => {
  try {
    const numero = req.params.numero;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const url = `${baseUrl}/mesa/${numero}`;
    const qrDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });
    res.json({ url, qr: qrDataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`🔌 Socket conectado: ${socket.id}`);

  socket.on('join_admin', () => {
    socket.join('admin');
    console.log(`👑 Admin entrou: ${socket.id}`);
  });

  socket.on('join_mesa', (numero) => {
    socket.join(`mesa_${numero}`);
    console.log(`🪑 Mesa ${numero} conectada: ${socket.id}`);
  });

  socket.on('disconnect', () => {
    console.log(`❌ Socket desconectado: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

db.initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`\n🚀 Comanda Digital rodando em http://localhost:${PORT}`);
    console.log(`   Admin:  http://localhost:${PORT}/admin`);
    console.log(`   Mesa 1: http://localhost:${PORT}/mesa/1\n`);
  });
}).catch(err => {
  console.error('Erro ao inicializar banco de dados:', err);
  process.exit(1);
});
