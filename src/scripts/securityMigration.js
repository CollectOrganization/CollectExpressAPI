const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration de segurança...");

    await sql`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto"
    `;

    await sql`
      DO $$
      BEGIN
        CREATE TYPE status_usuario AS ENUM (
          'PENDENTE',
          'ATIVO',
          'SUSPENSO'
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `;

    await sql`
      ALTER TABLE usuarios
      ADD COLUMN IF NOT EXISTS status status_usuario
      NOT NULL DEFAULT 'ATIVO'
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        usuario_id UUID NOT NULL,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,

        CONSTRAINT fk_refresh_token_usuario
          FOREIGN KEY (usuario_id)
          REFERENCES usuarios(id)
          ON DELETE CASCADE
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_usuario
      ON refresh_tokens(usuario_id)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
      ON refresh_tokens(expires_at)
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
      CREATE INDEX IF NOT EXISTS idx_password_recovery_expires_at
      ON password_recovery_tokens(expires_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        token TEXT PRIMARY KEY,
        revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      )
    `;

    await sql`
      ALTER TABLE revoked_tokens
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at
      ON revoked_tokens(expires_at)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS login_attempts (
        ip VARCHAR(255) PRIMARY KEY,
        attempts INTEGER NOT NULL DEFAULT 1,
        first_attempt BIGINT NOT NULL
      )
    `;

    console.log("Migration de segurança concluída.");
    process.exit(0);
  } catch (error) {
    console.error("Erro na migration:", error);
    process.exit(1);
  }
}

migrate();