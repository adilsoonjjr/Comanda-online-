'use strict';

const { createClient } = require('@libsql/client');
const path = require('path');

const client = createClient({
  url: process.env.TURSO_URL || `file:${process.env.DB_PATH || path.join(__dirname, 'comanda.db')}`,
  authToken: process.env.TURSO_TOKEN,
});

async function run(sql, args = []) {
  return client.execute({ sql, args });
}

async function all(sql, args = []) {
  const result = await client.execute({ sql, args });
  return result.rows.map(row => {
    const obj = {};
    result.columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

async function get(sql, args = []) {
  const result = await client.execute({ sql, args });
  if (!result.rows[0]) return null;
  const obj = {};
  result.columns.forEach((col, i) => { obj[col] = result.rows[0][i]; });
  return obj;
}

// ── Init ───────────────────────────────────────────────────────────────────

async function initDatabase() {
  await run(`CREATE TABLE IF NOT EXISTS tables (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    numero  INTEGER UNIQUE NOT NULL,
    status  TEXT NOT NULL DEFAULT 'active'
  )`);

  await run(`CREATE TABLE IF NOT EXISTS menu_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    nome         TEXT NOT NULL,
    descricao    TEXT DEFAULT '',
    preco        REAL NOT NULL,
    categoria    TEXT NOT NULL,
    emoji        TEXT DEFAULT '🍽️',
    disponivel   INTEGER NOT NULL DEFAULT 1,
    prato_do_dia INTEGER NOT NULL DEFAULT 0
  )`);

  await run(`CREATE TABLE IF NOT EXISTS orders (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_numero     INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pendente',
    forma_pagamento TEXT DEFAULT '',
    troco_para      REAL DEFAULT 0,
    total           REAL NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       INTEGER NOT NULL,
    item_id        INTEGER NOT NULL,
    quantidade     INTEGER NOT NULL DEFAULT 1,
    preco_unitario REAL NOT NULL,
    nome_item      TEXT NOT NULL
  )`);

  // Migration: prato_do_dia column
  try {
    await run('ALTER TABLE menu_items ADD COLUMN prato_do_dia INTEGER NOT NULL DEFAULT 0');
  } catch { /* already exists */ }

  const tc = await get('SELECT COUNT(*) as c FROM tables');
  if (!tc || tc.c === 0) {
    for (let i = 1; i <= 5; i++) await run('INSERT INTO tables (numero) VALUES (?)', [i]);
    console.log('✅ Mesas criadas (1-5)');
  }

  console.log('✅ Banco de dados pronto');
}

// ── Tables ─────────────────────────────────────────────────────────────────

function getAllTables() { return all('SELECT * FROM tables ORDER BY numero'); }
function addTable(numero) { return run('INSERT INTO tables (numero) VALUES (?)', [numero]); }
function updateTableStatus(numero, status) {
  return run('UPDATE tables SET status=? WHERE numero=?', [status, numero]);
}

// ── Menu ───────────────────────────────────────────────────────────────────

function getAllMenuItems() { return all('SELECT * FROM menu_items ORDER BY categoria, nome'); }
function getAvailableMenuItems() { return all('SELECT * FROM menu_items WHERE disponivel=1 ORDER BY categoria, nome'); }

function addMenuItem(nome, descricao, preco, categoria, emoji, prato_do_dia) {
  return run(
    'INSERT INTO menu_items (nome, descricao, preco, categoria, emoji, prato_do_dia) VALUES (?,?,?,?,?,?)',
    [nome, descricao, preco, categoria, emoji, prato_do_dia ? 1 : 0]
  );
}

function updateMenuItem(id, nome, descricao, preco, categoria, emoji, disponivel, prato_do_dia) {
  return run(
    'UPDATE menu_items SET nome=?, descricao=?, preco=?, categoria=?, emoji=?, disponivel=?, prato_do_dia=? WHERE id=?',
    [nome, descricao, preco, categoria, emoji, disponivel ? 1 : 0, prato_do_dia ? 1 : 0, id]
  );
}

function deleteMenuItem(id) { return run('DELETE FROM menu_items WHERE id=?', [id]); }

// ── Orders ─────────────────────────────────────────────────────────────────

async function attachItems(orders) {
  return Promise.all(orders.map(async o => {
    const items = await all('SELECT * FROM order_items WHERE order_id=?', [o.id]);
    return { ...o, items };
  }));
}

async function getAllActiveOrders() {
  const orders = await all("SELECT * FROM orders WHERE status != 'finalizado' ORDER BY created_at DESC");
  return attachItems(orders);
}

async function getOrdersByMesa(numero) {
  const orders = await all(
    "SELECT * FROM orders WHERE mesa_numero=? AND status != 'finalizado' ORDER BY created_at DESC", [numero]
  );
  return attachItems(orders);
}

async function getOrderById(id) {
  const order = await get('SELECT * FROM orders WHERE id=?', [id]);
  if (!order) return null;
  return (await attachItems([order]))[0];
}

async function createOrder(mesa_numero, forma_pagamento, troco_para, total, items) {
  const result = await run(
    'INSERT INTO orders (mesa_numero, forma_pagamento, troco_para, total, created_at) VALUES (?,?,?,?,?)',
    [mesa_numero, forma_pagamento, troco_para || 0, total, new Date().toISOString()]
  );
  const orderId = result.lastInsertRowid;
  for (const item of items) {
    await run(
      'INSERT INTO order_items (order_id, item_id, quantidade, preco_unitario, nome_item) VALUES (?,?,?,?,?)',
      [orderId, item.item_id, item.quantidade, item.preco_unitario, item.nome_item]
    );
  }
  return orderId;
}

function updateOrderStatus(id, status) {
  return run('UPDATE orders SET status=? WHERE id=?', [status, id]);
}

async function getTotalAtivoByMesa(mesa_numero) {
  const row = await get(
    "SELECT COALESCE(SUM(total), 0) as total FROM orders WHERE mesa_numero=? AND status != 'finalizado'",
    [mesa_numero]
  );
  return row ? row.total : 0;
}

async function closeAllOrdersByMesa(mesa_numero, forma_pagamento, troco_para) {
  await run(
    "UPDATE orders SET status='finalizado', forma_pagamento=?, troco_para=? WHERE mesa_numero=? AND status != 'finalizado'",
    [forma_pagamento, troco_para || 0, mesa_numero]
  );
}

async function getDailyReport(dateStart, dateEnd) {
  const orders = await all(
    'SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at DESC',
    [dateStart, dateEnd]
  );
  return attachItems(orders);
}

async function clearDailyOrders(dateStart, dateEnd) {
  const orders = await all(
    'SELECT id FROM orders WHERE created_at >= ? AND created_at < ?',
    [dateStart, dateEnd]
  );
  for (const o of orders) {
    await run('DELETE FROM order_items WHERE order_id=?', [o.id]);
  }
  await run('DELETE FROM orders WHERE created_at >= ? AND created_at < ?', [dateStart, dateEnd]);
}

module.exports = {
  initDatabase,
  getAllTables, addTable, updateTableStatus,
  getAllMenuItems, getAvailableMenuItems, addMenuItem, updateMenuItem, deleteMenuItem,
  getAllActiveOrders, getOrdersByMesa, getOrderById, createOrder, updateOrderStatus,
  getTotalAtivoByMesa, closeAllOrdersByMesa, getDailyReport, clearDailyOrders,
};
