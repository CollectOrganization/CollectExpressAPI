const { neon } = require("@neondatabase/serverless");
require("dotenv").config({ quiet: true });
//require("dotenv").config();

// Inicializa a conexão com o banco de dados usando a URL do .env
//const sql = neon(process.env.DATABASE_URL);
if (!process.env.DATABASE_URL) {
  throw new Error("A variável DATABASE_URL não foi definida.");
}

// Testa a conexão (opcional, mas recomendado para debug inicial)
/*sql`SELECT now()`.then(() => {
  console.log("Conectado ao NeonDB!");
}).catch((err) => {
  console.error("Erro ao conectar no banco de dados:", err);
});*/
const sql = neon(process.env.DATABASE_URL);


module.exports = sql;