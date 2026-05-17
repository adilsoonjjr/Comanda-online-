'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'comanda.db'));

// Promisify helpers
const run = (sql, params = []) => new Promise((res, rej) =>
  db.run(sql, params, function (err) { err ? rej(err) : res(this); }));
const all = (sql, params = []) => new Promise((res, rej) =>
  db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
const get = (sql, params = []) => new Promise((res, rej) =>
  db.get(sql, params, (err, row) => err ? rej(err) : res(row)));

// ── Init ───────────────────────────────────────────────────────────────────

async function initDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');

  await run(`CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero INTEGER UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    descricao TEXT DEFAULT '',
    preco REAL NOT NULL,
    categoria TEXT NOT NULL,
    emoji TEXT DEFAULT '🍽️',
    disponivel INTEGER NOT NULL DEFAULT 1
  )`);

  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mesa_numero INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','preparando','pronto','finalizado')),
    forma_pagamento TEXT DEFAULT '',
    troco_para REAL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL,
    quantidade INTEGER NOT NULL DEFAULT 1,
    preco_unitario REAL NOT NULL,
    nome_item TEXT NOT NULL
  )`);

  // Seed tables
  const tc = await get('SELECT COUNT(*) as c FROM tables');
  if (tc.c === 0) {
    for (let i = 1; i <= 5; i++) await run('INSERT INTO tables (numero) VALUES (?)', [i]);
    console.log('✅ Mesas criadas (1-5)');
  }

  console.log('✅ Cardápio vazio — adicione os produtos pelo painel Admin');
}

// ── Tables ─────────────────────────────────────────────────────────────────

function getAllTables() {
  return all('SELECT * FROM tables ORDER BY numero');
}
function addTable(numero) {
  return run('INSERT INTO tables (numero) VALUES (?)', [numero]);
}
function updateTableStatus(numero, status) {
  return run('UPDATE tables SET status=? WHERE numero=?', [status, numero]);
}

// ── Menu ───────────────────────────────────────────────────────────────────

function getAllMenuItems() {
  return all('SELECT * FROM menu_items ORDER BY categoria, nome');
}
function getAvailableMenuItems() {
  return all('SELECT * FROM menu_items WHERE disponivel=1 ORDER BY categoria, nome');
}
function addMenuItem(nome, descricao, preco, categoria, emoji) {
  return run('INSERT INTO menu_items (nome, descricao, preco, categoria, emoji) VALUES (?,?,?,?,?)',
    [nome, descricao, preco, categoria, emoji]);
}
function updateMenuItem(id, nome, descricao, preco, categoria, emoji, disponivel) {
  return run('UPDATE menu_items SET nome=?, descricao=?, preco=?, categoria=?, emoji=?, disponivel=? WHERE id=?',
    [nome, descricao, preco, categoria, emoji, disponivel ? 1 : 0, id]);
}
function deleteMenuItem(id) {
  return run('DELETE FROM menu_items WHERE id=?', [id]);
}

// ── Orders ─────────────────────────────────────────────────────────────────

async function getAllActiveOrders() {
  const orders = await all(`SELECT * FROM orders WHERE status != 'finalizado' ORDER BY created_at DESC`);
  return attachItems(orders);
}

async function getOrdersByMesa(numero) {
  const orders = await all(
    `SELECT * FROM orders WHERE mesa_numero=? AND status != 'finalizado' ORDER BY created_at DESC`, [numero]);
  return attachItems(orders);
}

async function getOrderById(id) {
  const order = await get('SELECT * FROM orders WHERE id=?', [id]);
  if (!order) return null;
  return (await attachItems([order]))[0];
}

async function attachItems(orders) {
  return Promise.all(orders.map(async (o) => {
    const items = await all('SELECT * FROM order_items WHERE order_id=?', [o.id]);
    return { ...o, items };
  }));
}

async function createOrder(mesa_numero, forma_pagamento, troco_para, total, items) {
  const result = await run(
    'INSERT INTO orders (mesa_numero, forma_pagamento, troco_para, total) VALUES (?,?,?,?)',
    [mesa_numero, forma_pagamento, troco_para || 0, total]
  );
  const orderId = result.lastID;
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

module.exports = {
  initDatabase,
  getAllTables,
  addTable,
  updateTableStatus,
  getAllMenuItems,
  getAvailableMenuItems,
  addMenuItem,
  updateMenuItem,
  deleteMenuItem,
  getAllActiveOrders,
  getOrdersByMesa,
  getOrderById,
  createOrder,
  updateOrderStatus,
};
