const sql = require("../config/db");

async function checkDatabase() {
  try {
    const users = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
    `;

    const orders = await sql`
      SELECT COUNT(*)::int AS total FROM alugueis
    `;

    const revenue = await sql`
      SELECT COALESCE(SUM(preco_final), 0)::numeric AS total
      FROM alugueis
      WHERE status_pagamento = 'PAGO'
    `;

    console.log("users", users);
    console.log("orders", orders);
    console.log("revenue", revenue);
  } catch (error) {
    console.error("Erro ao consultar banco:", error);
    process.exitCode = 1;
  }
}

checkDatabase();

// -------------- Old version ----------------
/*const sql = require('./src/config/db.js');
async function test() {
  const t = await sql`SELECT COUNT(*)::int AS total FROM usuarios`;
  console.log('users', t);
  const o = await sql`SELECT COUNT(*)::int AS total FROM alugueis`;
  console.log('orders', o);
  const r = await sql`SELECT COALESCE(SUM(preco_final), 0)::numeric AS total FROM alugueis WHERE status_pagamento = 'PAGO'`;
  console.log('revenue', r);
}
test();*/
