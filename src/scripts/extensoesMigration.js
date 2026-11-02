const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration de extensão de aluguel...");

    await sql`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto"
    `;

    // O caçambeiro escolhe, por caçamba, se aceita pedidos de extensão.
    await sql`
      ALTER TABLE cacambas
      ADD COLUMN IF NOT EXISTS permite_extensao BOOLEAN NOT NULL DEFAULT FALSE
    `;

    // Dias e valor pagos em extensões. Ficam separados de
    // dias_aluguel/preco_final para não quebrar o CHECK de 30 dias
    // nem os relatórios atuais; o fim previsto passa a ser
    // data_inicio + dias_aluguel + dias_extra.
    await sql`
      ALTER TABLE alugueis
      ADD COLUMN IF NOT EXISTS dias_extra INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS valor_extra NUMERIC(12, 2) NOT NULL DEFAULT 0
    `;

    // Estados: SOLICITADA -> AGUARDANDO_PAGAMENTO -> PAGA, ou
    // RECUSADA / EXPIRADA / CANCELADA.
    await sql`
      CREATE TABLE IF NOT EXISTS extensoes_aluguel (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aluguel_id UUID NOT NULL,
        dias_adicionais INTEGER NOT NULL,
        valor NUMERIC(12, 2) NOT NULL,
        status VARCHAR(25) NOT NULL DEFAULT 'SOLICITADA',
        solicitada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        solicitacao_expira_em TIMESTAMPTZ NOT NULL,
        respondida_em TIMESTAMPTZ,
        pagamento_expira_em TIMESTAMPTZ,
        pago_em TIMESTAMPTZ,
        token_hash VARCHAR(64),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_extensoes_aluguel_aluguel
          FOREIGN KEY (aluguel_id) REFERENCES alugueis(id) ON DELETE CASCADE,
        CONSTRAINT extensoes_aluguel_dias_check
          CHECK (dias_adicionais >= 1 AND dias_adicionais <= 30),
        CONSTRAINT extensoes_aluguel_valor_check CHECK (valor > 0),
        CONSTRAINT extensoes_aluguel_status_check CHECK (
          status IN (
            'SOLICITADA',
            'AGUARDANDO_PAGAMENTO',
            'PAGA',
            'RECUSADA',
            'EXPIRADA',
            'CANCELADA'
          )
        ),
        CONSTRAINT extensoes_aluguel_token_unique UNIQUE (token_hash)
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_extensoes_aluguel_aluguel
      ON extensoes_aluguel(aluguel_id, criado_em DESC)
    `;

    // No máximo uma extensão em aberto por aluguel.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_extensoes_aluguel_em_aberto
      ON extensoes_aluguel(aluguel_id)
      WHERE status IN ('SOLICITADA', 'AGUARDANDO_PAGAMENTO')
    `;

    // O PIX de uma extensão fica na mesma tabela dos PIX de pedido,
    // identificado por extensao_id. PIX de pedido tem extensao_id nulo.
    await sql`
      ALTER TABLE pagamentos_pix
      ADD COLUMN IF NOT EXISTS extensao_id UUID
    `;

    await sql`
      DO $$
      BEGIN
        ALTER TABLE pagamentos_pix
        ADD CONSTRAINT fk_pagamentos_pix_extensao
        FOREIGN KEY (extensao_id) REFERENCES extensoes_aluguel(id)
        ON DELETE CASCADE;
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_extensao
      ON pagamentos_pix(extensao_id)
      WHERE extensao_id IS NOT NULL
    `;

    console.log("✅ Migration de extensão de aluguel concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration de extensão de aluguel:", error);
    process.exit(1);
  }
}

migrate();
