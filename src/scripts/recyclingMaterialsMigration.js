const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration de materiais recicláveis...");

    // Garante a extensão usada por gen_random_uuid().
    await sql`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto"
    `;

    // Catálogo de materiais recicláveis.
    // O nome é único para permitir seed idempotente (ON CONFLICT).
    await sql`
      CREATE TABLE IF NOT EXISTS materiais_reciclaveis (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(100) NOT NULL,
        descricao TEXT,
        icone_url VARCHAR(500),
        tipos_aceitos TEXT[] NOT NULL DEFAULT '{}',
        tipos_nao_aceitos TEXT[] NOT NULL DEFAULT '{}',
        impacto_energia INTEGER NOT NULL DEFAULT 0,
        impacto_co2 INTEGER NOT NULL DEFAULT 0,
        tempo_decomposicao VARCHAR(50),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT materiais_reciclaveis_nome_unique UNIQUE (nome)
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_materiais_reciclaveis_nome
      ON materiais_reciclaveis(nome)
    `;

    console.log("✅ Migration de materiais concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration de materiais:", error);
    process.exit(1);
  }
}

migrate();