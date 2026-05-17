'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'comanda.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Init ───────────────────────────────────────────────────────────────────

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tables (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      numero  INTEGER UNIQUE NOT NULL,
      status  TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive'))
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      nome         TEXT NOT NULL,
      descricao    TEXT DEFAULT '',
      preco        REAL NOT NULL,
      categoria    TEXT NOT NULL,
      emoji        TEXT DEFAULT '🍽️',
      disponivel   INTEGER NOT NULL DEFAULT 1,
      prato_do_dia INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mesa_numero     INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pendente'
                        CHECK(status IN ('pendente','preparando','pronto','finalizado')),
      forma_pagamento TEXT DEFAULT '',
      troco_para      REAL DEFAULT 0,
      total           REAL NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL
                        DEFAULT (strftime('%Y-%m-%dT%H:%M:%S','now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      item_id        INTEGER NOT NULL,
      quantidade     INTEGER NOT NULL DEFAULT 1,
      preco_unitario REAL NOT NULL,
      nome_item      TEXT NOT NULL
    );
  `);

  // Migration: add prato_do_dia column if missing (existing databases)
  const cols = db.prepare('PRAGMA table_info(menu_items)').all();
  if (!cols.find(c => c.name === 'prato_do_dia')) {
    db.exec('ALTER TABLE menu_items ADD COLUMN prato_do_dia INTEGER NOT NULL DEFAULT 0');
  }

  const tableCount = db.prepare('SELECT COUNT(*) as c FROM tables').get().c;
  if (tableCount === 0) {
    const ins = db.prepare('INSERT INTO tables (numero) VALUES (?)');
    for (let i = 1; i <= 5; i++) ins.run(i);
    console.log('✅ Mesas criadas (1-5)');
  }

  console.log('✅ Cardápio vazio — adicione os produtos pelo painel Admin');
}

// ── Tables ─────────────────────────────────────────────────────────────────

function getAllTables() {
  return db.prepare('SELECT * FROM tables ORDER BY numero').all();
}
function addTable(numero) {
  return db.prepare('INSERT INTO tables (numero) VALUES (?)').run(numero);
}
function updateTableStatus(numero, status) {
  return db.prepare('UPDATE tables SET status=? WHERE numero=?').run(status, numero);
}

// ── Menu ───────────────────────────────────────────────────────────────────

function getAllMenuItems() {
  return db.prepare('SELECT * FROM menu_items ORDER BY categoria, nome').all();
}
function getAvailableMenuItems() {
  return db.prepare('SELECT * FROM menu_items WHERE disponivel=1 ORDER BY categoria, nome').all();
}
function addMenuItem(nome, descricao, preco, categoria, emoji, prato_do_dia) {
  return db.prepare(
    'INSERT INTO menu_items (nome, descricao, preco, categoria, emoji, prato_do_dia) VALUES (?,?,?,?,?,?)'
  ).run(nome, descricao, preco, categoria, emoji, prato_do_dia ? 1 : 0);
}
function updateMenuItem(id, nome, descricao, preco, categoria, emoji, disponivel, prato_do_dia) {
  return db.prepare(
    'UPDATE menu_items SET nome=?, descricao=?, preco=?, categoria=?, emoji=?, disponivel=?, prato_do_dia=? WHERE id=?'
  ).run(nome, descricao, preco, categoria, emoji, disponivel ? 1 : 0, prato_do_dia ? 1 : 0, id);
}
function deleteMenuItem(id) {
  return db.prepare('DELETE FROM menu_items WHERE id=?').run(id);
}

// ── Orders ─────────────────────────────────────────────────────────────────

function attachItems(orders) {
  const stmt = db.prepare('SELECT * FROM order_items WHERE order_id=?');
  return orders.map(o => ({ ...o, items: stmt.all(o.id) }));
}

function getAllActiveOrders() {
  const orders = db.prepare(
    "SELECT * FROM orders WHERE status != 'finalizado' ORDER BY created_at DESC"
  ).all();
  return attachItems(orders);
}

function getOrdersByMesa(numero) {
  const orders = db.prepare(
    "SELECT * FROM orders WHERE mesa_numero=? AND status != 'finalizado' ORDER BY created_at DESC"
  ).all(numero);
  return attachItems(orders);
}

function getOrderById(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id);
  if (!order) return null;
  return attachItems([order])[0];
}

function createOrder(mesa_numero, forma_pagamento, troco_para, total, items) {
  const insertOrder = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO orders (mesa_numero, forma_pagamento, troco_para, total) VALUES (?,?,?,?)'
    ).run(mesa_numero, forma_pagamento, troco_para || 0, total);

    const orderId = result.lastInsertRowid;
    const insItem = db.prepare(
      'INSERT INTO order_items (order_id, item_id, quantidade, preco_unitario, nome_item) VALUES (?,?,?,?,?)'
    );
    for (const item of items) {
      insItem.run(orderId, item.item_id, item.quantidade, item.preco_unitario, item.nome_item);
    }
    return orderId;
  });
  return insertOrder();
}

function updateOrderStatus(id, status) {
  return db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, id);
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
