const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ quiet: true });
//require("dotenv").config();

let sql;
if (process.env.DATABASE_URL) {
  sql = neon(process.env.DATABASE_URL);
} else {
  console.warn("⚠️ AVISO: DATABASE_URL não definida no .env. Configure a URL do NeonDB.");
  sql = async () => {
    throw new Error("DATABASE_URL não configurada no .env");
  };
}

// Testa a conexão (opcional, mas recomendado para debug inicial)
if (process.env.DATABASE_URL) {
  sql`SELECT now()`.then(() => {
    console.log("Conectado ao NeonDB!");
  }).catch((err) => {
    console.error("Erro ao conectar no banco de dados:", err);
  });
}

module.exports = sql;