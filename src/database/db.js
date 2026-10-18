const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

/**
 * Inicializa a conexão com o NeonDB usando a variável DATABASE_URL.
 * Retorna uma função sql tagged template para executar queries.
 *
 * Uso:
 *   const sql = require('./db');
 *   const users = await sql`SELECT * FROM usuarios WHERE id = ${userId}`;
 */
let sql;
if (process.env.DATABASE_URL) {
  sql = neon(process.env.DATABASE_URL);
} else {
  sql = async () => {
    throw new Error("DATABASE_URL não configurada no .env");
  };
}

module.exports = sql;
