const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration de recuperação de senha...");

    await sql`
      ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS token_version INTEGER
      NOT NULL DEFAULT 0
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS password_recovery_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at TIMESTAMPTZ,

        CONSTRAINT fk_password_recovery_usuario
          FOREIGN KEY (usuario_id)
          REFERENCES usuarios(id)
          ON DELETE CASCADE
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_password_recovery_usuario
      ON password_recovery_tokens(usuario_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_password_recovery_expires
      ON password_recovery_tokens(expires_at)
    `;

    console.log("Migration concluída.");
    process.exit(0);
  } catch (error) {
    console.error("Erro na migration:", error);
    process.exit(1);
  }
}

migrate();