const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Iniciando migration de segurança...");

    await sql`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto"
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS login_attempts (
        ip VARCHAR(255) PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 1,
        first_attempt BIGINT NOT NULL
      )
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token TEXT PRIMARY KEY,
        revoked_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_revoked_tokens_revoked_at
      ON revoked_tokens(revoked_at)
    `;

    await sql`
      ALTER TABLE itens_carrinho
      DROP CONSTRAINT IF EXISTS itens_carrinho_dias_check
    `;

    await sql`
      ALTER TABLE itens_carrinho
      ADD CONSTRAINT itens_carrinho_dias_check
      CHECK (dias_aluguel >= 1 AND dias_aluguel <= 30)
    `;

    console.log("Migration concluída.");
    process.exit(0);
  } catch (error) {
    console.error("Erro na migration:", error);
    process.exit(1);
  }
}

migrate();