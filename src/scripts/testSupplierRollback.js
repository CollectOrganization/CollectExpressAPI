const bcrypt = require("bcryptjs");

const sql = require("../config/db");

async function testSupplierRollback() {
  const unique = Date.now().toString();

  const email = `rollback.${unique}@teste.local`;
  const documento = unique.padStart(14, "0").slice(-14);
  const telefone = unique.padStart(11, "0").slice(-11);
  const senhaHash = await bcrypt.hash("Senha123", 10);

  console.log("Iniciando teste de rollback...");
  console.log(`E-mail temporário: ${email}`);

  try {
    /*
     * A inserção do usuário é válida, mas horario_inicio recebe NULL.
     * A coluna é NOT NULL, portanto novos_detalhes deve falhar.
     *
     * Como os dois INSERTs fazem parte da mesma instrução SQL,
     * o usuário também não pode permanecer no banco.
     */
    await sql`
      WITH novo_usuario AS (
        INSERT INTO usuarios (
          nome_completo,
          email,
          senha_hash,
          tipo_perfil,
          documento,
          telefone,
          status
        )
        VALUES (
          'Fornecedor Teste Rollback',
          ${email},
          ${senhaHash},
          'CACAMBEIRO',
          ${documento},
          ${telefone},
          'PENDENTE'
        )
        RETURNING id, tipo_perfil
      ),
      novos_detalhes AS (
        INSERT INTO detalhes_cacambeiro (
          usuario_id,
          horario_inicio,
          horario_fim,
          raio_entrega_km,
          taxa_entrega
        )
        SELECT
          id,
          NULL,
          '18:00',
          30,
          50
        FROM novo_usuario
        WHERE tipo_perfil = 'CACAMBEIRO'
        RETURNING usuario_id
      )
      SELECT *
      FROM novo_usuario
    `;

    throw new Error(
      "O cadastro deveria ter falhado, mas foi concluído.",
    );
  } catch (error) {
    /*
     * 23502 = violação de NOT NULL no PostgreSQL.
     */
    if (error.code === "23502") {
      console.log(
        "Falha esperada nos detalhes do fornecedor detectada.",
      );
    } else if (
      error.message ===
      "O cadastro deveria ter falhado, mas foi concluído."
    ) {
      throw error;
    } else {
      console.log(
        `A operação falhou com o código: ${error.code || "desconhecido"}`,
      );
    }
  }

  const users = await sql`
    SELECT id
    FROM usuarios
    WHERE email = ${email}
  `;

  if (users.length > 0) {
    /*
     * Limpeza defensiva, caso o teste encontre um cadastro órfão.
     */
    await sql`
      DELETE FROM usuarios
      WHERE email = ${email}
    `;

    throw new Error(
      "ROLLBACK FALHOU: o usuário permaneceu no banco.",
    );
  }

  const orphanDetails = await sql`
    SELECT dc.id
    FROM detalhes_cacambeiro dc
    LEFT JOIN usuarios u ON u.id = dc.usuario_id
    WHERE u.id IS NULL
  `;

  if (orphanDetails.length > 0) {
    throw new Error(
      `Foram encontrados ${orphanDetails.length} detalhes órfãos.`,
    );
  }

  console.log(
    "✅ SUCESSO: o usuário não foi persistido após a falha.",
  );
  console.log(
    "✅ SUCESSO: nenhum detalhe órfão foi encontrado.",
  );
}

testSupplierRollback()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Teste de rollback falhou:", error);
    process.exit(1);
  });