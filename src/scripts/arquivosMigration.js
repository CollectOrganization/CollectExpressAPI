const sql = require("../config/db");

/**
 * Tabela `arquivos`: cópia durável das fotos, assinaturas e PDFs.
 *
 * O disco do Render é apagado a cada deploy/reinício; sem esta tabela os
 * contratos deixam de poder ser gerados quando a assinatura some. O
 * conteúdo fica em base64 (TEXT) para não depender de como o driver
 * HTTP do Neon trata colunas binárias.
 */
async function migrate() {
  try {
    console.log("Executando migration dos arquivos...");

    await sql`
      CREATE TABLE IF NOT EXISTS arquivos (
        chave VARCHAR(200) PRIMARY KEY,
        conteudo_base64 TEXT NOT NULL,
        tamanho INTEGER NOT NULL,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    console.log("✅ Migration dos arquivos concluída.");
    process.exitCode = 0;
  } catch (error) {
    console.error("❌ Erro na migration dos arquivos:", error);
    process.exitCode = 1;
  }
}

migrate();