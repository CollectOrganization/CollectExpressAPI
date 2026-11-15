const sql = require("../config/db");

/**
 * Tabela de logs de erros e pontos de falha, escrita pela API
 * (origem API) e pelo app Flutter (origem APP).
 *
 * Não há chave estrangeira em usuario_id de propósito: o log precisa
 * sobreviver à exclusão do usuário e nunca pode impedir uma operação.
 */
async function migrate() {
  try {
    console.log("Executando migration dos logs...");

    await sql`
      CREATE TABLE IF NOT EXISTS logs_erros (
        id BIGSERIAL PRIMARY KEY,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        origem VARCHAR(10) NOT NULL,
        nivel VARCHAR(8) NOT NULL,
        codigo VARCHAR(80),
        mensagem TEXT NOT NULL,
        metodo VARCHAR(10),
        rota VARCHAR(300),
        status_http SMALLINT,
        duracao_ms INTEGER,
        usuario_id UUID,
        perfil VARCHAR(20),
        ip VARCHAR(64),
        user_agent VARCHAR(300),
        tela VARCHAR(120),
        app_versao VARCHAR(40),
        plataforma VARCHAR(40),
        detalhes JSONB,
        CONSTRAINT logs_erros_origem_check
          CHECK (origem IN ('API', 'APP')),
        CONSTRAINT logs_erros_nivel_check
          CHECK (nivel IN ('ERRO', 'AVISO', 'INFO'))
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_logs_erros_criado_em
      ON logs_erros (criado_em DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_logs_erros_origem_nivel
      ON logs_erros (origem, nivel, criado_em DESC)
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_logs_erros_codigo
      ON logs_erros (codigo, criado_em DESC)
    `;

    console.log("✅ Migration dos logs concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration dos logs:", error);
    process.exit(1);
  }
}

migrate();
