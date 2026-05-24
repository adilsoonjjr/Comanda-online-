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

  const mc = await get('SELECT COUNT(*) as c FROM menu_items');
  if (!mc || mc.c === 0) {
    const seed = [
      ['Porção',                         'Feijão, arroz, macarrão',           30, 'Prato'],
      ['Buchada',                         'Farofa, arroz, macarrão',           30, 'Prato'],
      ['Peixe Frito',                     'Feijão, arroz, salada',             30, 'Prato'],
      ['Feijoada',                        'Farofa, arroz, salada',             30, 'Prato'],
      ['Carne de Sol',                    'Farofa, salada',                    35, 'Prato'],
      ['Carneiro',                        'Farofa, salada',                    40, 'Prato'],
      ['Tripa',                           'Farofa, salada',                    30, 'Prato'],
      ['Pirão de Alpim c/ Carne do Sol',  'Acompanhamento incluso',            60, 'Prato'],
      ['Pirão de Alpim c/ Frango',        'Feijão, arroz, macarrão',           25, 'Prato'],
      ['Parmegiana de Frango',            'Feijão, arroz, macarrão',           25, 'Prato'],
      ['Batata Frita',                    '',                                  20, 'Petisco'],
      ['Doce de Leite',                   '',                                   8, 'Sobremesa'],
      ['Mousse',                          '',                                   8, 'Sobremesa'],
      ['Pudim',                           '',                                   8, 'Sobremesa'],
      ['Heineken 330ml',                  '',                                  10, 'Bebidas'],
      ['Budweiser 330ml',                 '',                                  10, 'Bebidas'],
      ['Skol 300ml',                      '',                                   4, 'Bebidas'],
      ['Brahma 300ml',                    '',                                   4, 'Bebidas'],
      ['Amstel 300ml',                    '',                                   4, 'Bebidas'],
      ['Refrigerante 1L',                 '',                                   8, 'Bebidas'],
      ['Refrigerante Lata',               '',                                   5, 'Bebidas'],
      ['Água c/ Gás 500ml',               '',                                   4, 'Bebidas'],
      ['Água s/ Gás 500ml',               '',                                   3, 'Bebidas'],
      ['Whisky Red Label',                'Dose',                               9, 'Drinks'],
      ['Whisky Passport',                 'Dose',                               9, 'Drinks'],
      ['Campari',                         'Dose',                               9, 'Drinks'],
      ['Vodka',                           'Dose',                               9, 'Drinks'],
      ['Suco de Goiaba',                  '',                                  12, 'Sucos'],
      ['Suco de Acerola',                 '',                                  12, 'Sucos'],
      ['Suco de Maracujá',                '',                                  12, 'Sucos'],
      ['Suco de Manga',                   '',                                  12, 'Sucos'],
    ];
    for (const [nome, descricao, preco, categoria] of seed) {
      await run('INSERT INTO menu_items (nome, descricao, preco, categoria, emoji, disponivel, prato_do_dia) VALUES (?,?,?,?,?,1,0)',
        [nome, descricao, preco, categoria, '🍽️']);
    }
    console.log(`✅ Cardápio seed: ${seed.length} itens cadastrados`);
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

async function removeOrderItem(orderId, itemId) {
  await run('DELETE FROM order_items WHERE id=? AND order_id=?', [itemId, orderId]);
  const count = await get('SELECT COUNT(*) as c FROM order_items WHERE order_id=?', [orderId]);
  if (!count || count.c === 0) {
    await run('DELETE FROM orders WHERE id=?', [orderId]);
  } else {
    const row = await get('SELECT COALESCE(SUM(preco_unitario * quantidade),0) as total FROM order_items WHERE order_id=?', [orderId]);
    await run('UPDATE orders SET total=? WHERE id=?', [row.total, orderId]);
  }
}

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
  getTotalAtivoByMesa, closeAllOrdersByMesa, getDailyReport, clearDailyOrders, removeOrderItem,
};
