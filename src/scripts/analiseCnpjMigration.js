const sql = require("../config/db");

/**
 * Tabela da análise de CNPJ com IA (uma linha por usuário: a última
 * análise substitui a anterior). Veja src/services/analiseCnpjService.js.
 *
 * `resultado` guarda a análise inteira (checagens, classificações do
 * LLM, parecer e o resumo dos dados públicos da Receita). Sócios,
 * e-mail e telefone da empresa não são gravados.
 */
async function migrate() {
  try {
    console.log("Executando migration da análise de CNPJ...");

    await sql`
      CREATE TABLE IF NOT EXISTS analises_cnpj (
        usuario_id UUID PRIMARY KEY
          REFERENCES usuarios(id) ON DELETE CASCADE,
        nota NUMERIC(3, 1),
        recomendacao VARCHAR(10) NOT NULL,
        resultado JSONB NOT NULL,
        modelo VARCHAR(60),
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT analises_cnpj_recomendacao_check
          CHECK (recomendacao IN ('APROVAR', 'REVISAR', 'REPROVAR')),
        CONSTRAINT analises_cnpj_nota_check
          CHECK (nota IS NULL OR (nota >= 0 AND nota <= 10))
      )
    `;

    console.log("✅ Migration da análise de CNPJ concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration da análise de CNPJ:", error);
    process.exit(1);
  }
}

migrate();
