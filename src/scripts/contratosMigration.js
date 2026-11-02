const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration de contratos de locação...");

    await sql`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto"
    `;

    // Assinatura padrão da empresa (caçambeiro), usada nos contratos.
    await sql`
      ALTER TABLE detalhes_cacambeiro
      ADD COLUMN IF NOT EXISTS assinatura_path VARCHAR(255),
      ADD COLUMN IF NOT EXISTS assinatura_atualizada_em TIMESTAMPTZ
    `;

    // Um contrato por aluguel. O aceite e a assinatura do consumidor
    // são gravados junto com o pedido; o PDF é gerado em seguida e
    // pode ser regerado se o arquivo não existir.
    await sql`
      CREATE TABLE IF NOT EXISTS contratos_locacao (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aluguel_id UUID NOT NULL,
        versao_termos VARCHAR(20) NOT NULL,
        aceite_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        aceite_ip VARCHAR(64),
        aceite_user_agent VARCHAR(300),
        assinatura_consumidor_path VARCHAR(255) NOT NULL,
        assinatura_cacambeiro_path VARCHAR(255),
        pdf_path VARCHAR(255),
        pdf_sha256 CHAR(64),
        pdf_gerado_em TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_contratos_locacao_aluguel
          FOREIGN KEY (aluguel_id) REFERENCES alugueis(id) ON DELETE CASCADE,
        CONSTRAINT contratos_locacao_aluguel_unique UNIQUE (aluguel_id),
        CONSTRAINT contratos_locacao_status_check
          CHECK (status IN ('PENDENTE', 'GERADO'))
      )
    `;

    console.log("✅ Migration de contratos de locação concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration de contratos de locação:", error);
    process.exit(1);
  }
}

migrate();
