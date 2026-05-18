'use strict';
const db = require('./database');

const items = [
  // ── Pratos ──────────────────────────────────────────────────────
  { nome: 'Porção',                        descricao: 'Feijão, arroz, macarrão',          preco: 30, categoria: 'Prato' },
  { nome: 'Buchada',                       descricao: 'Farofa, arroz, macarrão',          preco: 30, categoria: 'Prato' },
  { nome: 'Peixe Frito',                   descricao: 'Feijão, arroz, salada',            preco: 30, categoria: 'Prato' },
  { nome: 'Feijoada',                      descricao: 'Farofa, arroz, salada',            preco: 30, categoria: 'Prato' },
  { nome: 'Carne de Sol',                  descricao: 'Farofa, salada',                   preco: 35, categoria: 'Prato' },
  { nome: 'Carneiro',                      descricao: 'Farofa, salada',                   preco: 40, categoria: 'Prato' },
  { nome: 'Tripa',                         descricao: 'Farofa, salada',                   preco: 30, categoria: 'Prato' },
  { nome: 'Pirão de Alpim c/ Carne do Sol',descricao: 'Acompanhamento incluso',           preco: 60, categoria: 'Prato' },
  { nome: 'Pirão de Alpim c/ Frango',      descricao: 'Feijão, arroz, macarrão',          preco: 25, categoria: 'Prato' },
  { nome: 'Parmegiana de Frango',          descricao: 'Feijão, arroz, macarrão',          preco: 25, categoria: 'Prato' },
  // ── Petisco ─────────────────────────────────────────────────────
  { nome: 'Batata Frita',                  descricao: '',                                  preco: 20, categoria: 'Petisco' },
  // ── Sobremesa ───────────────────────────────────────────────────
  { nome: 'Doce de Leite',                 descricao: '',                                  preco:  8, categoria: 'Sobremesa' },
  { nome: 'Mousse',                        descricao: '',                                  preco:  8, categoria: 'Sobremesa' },
  { nome: 'Pudim',                         descricao: '',                                  preco:  8, categoria: 'Sobremesa' },
  // ── Bebidas (prontas) ────────────────────────────────────────────
  { nome: 'Heineken 330ml',               descricao: '',                                  preco: 10, categoria: 'Bebidas' },
  { nome: 'Budweiser 330ml',              descricao: '',                                  preco: 10, categoria: 'Bebidas' },
  { nome: 'Skol 300ml',                   descricao: '',                                  preco:  4, categoria: 'Bebidas' },
  { nome: 'Brahma 300ml',                 descricao: '',                                  preco:  4, categoria: 'Bebidas' },
  { nome: 'Amstel 300ml',                 descricao: '',                                  preco:  4, categoria: 'Bebidas' },
  { nome: 'Refrigerante 1L',              descricao: '',                                  preco:  8, categoria: 'Bebidas' },
  { nome: 'Refrigerante Lata',            descricao: '',                                  preco:  5, categoria: 'Bebidas' },
  { nome: 'Água c/ Gás 500ml',            descricao: '',                                  preco:  4, categoria: 'Bebidas' },
  { nome: 'Água s/ Gás 500ml',            descricao: '',                                  preco:  3, categoria: 'Bebidas' },
  // ── Drinks (com preparo) ─────────────────────────────────────────
  { nome: 'Whisky Red Label',             descricao: 'Dose',                              preco:  9, categoria: 'Drinks' },
  { nome: 'Whisky Passport',              descricao: 'Dose',                              preco:  9, categoria: 'Drinks' },
  { nome: 'Campari',                      descricao: 'Dose',                              preco:  9, categoria: 'Drinks' },
  { nome: 'Vodka',                        descricao: 'Dose',                              preco:  9, categoria: 'Drinks' },
  // ── Sucos ────────────────────────────────────────────────────────
  { nome: 'Suco de Goiaba',               descricao: '',                                  preco: 12, categoria: 'Sucos' },
  { nome: 'Suco de Acerola',              descricao: '',                                  preco: 12, categoria: 'Sucos' },
  { nome: 'Suco de Maracujá',             descricao: '',                                  preco: 12, categoria: 'Sucos' },
  { nome: 'Suco de Manga',                descricao: '',                                  preco: 12, categoria: 'Sucos' },
];

(async () => {
  await db.initDatabase();
  for (const item of items) {
    await db.addMenuItem(item.nome, item.descricao, item.preco, item.categoria, '🍽️', 0);
    console.log(`✅ ${item.categoria.padEnd(10)} — ${item.nome}`);
  }
  console.log(`\n🎉 ${items.length} itens cadastrados com sucesso!`);
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
