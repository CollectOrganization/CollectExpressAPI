const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration de pagamentos PIX...");

    // Garante a extensão usada por gen_random_uuid().
    await sql`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto"
    `;

    // Cobranças PIX criadas na AbacatePay. Um pedido pode ter mais de
    // uma (quando o PIX anterior expira); o pedido fica PAGO quando
    // uma delas é paga.
    await sql`
      CREATE TABLE IF NOT EXISTS pagamentos_pix (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        aluguel_id UUID NOT NULL,
        cobranca_id VARCHAR(100) NOT NULL,
        valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 100),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        copia_cola TEXT NOT NULL,
        qr_code_base64 TEXT,
        dev_mode BOOLEAN NOT NULL DEFAULT FALSE,
        expira_em TIMESTAMPTZ,
        pago_em TIMESTAMPTZ,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_pagamentos_pix_aluguel
          FOREIGN KEY (aluguel_id) REFERENCES alugueis(id) ON DELETE CASCADE,
        CONSTRAINT pagamentos_pix_cobranca_unique UNIQUE (cobranca_id)
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_aluguel
      ON pagamentos_pix(aluguel_id, criado_em DESC)
    `;

    console.log("✅ Migration de pagamentos PIX concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration de pagamentos PIX:", error);
    process.exit(1);
  }
}

migrate();
