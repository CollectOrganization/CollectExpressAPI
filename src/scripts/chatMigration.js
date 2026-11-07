const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration do chat...");

    // Uma conversa por pedido (cliente x caçambeiro), uma por caçambeiro
    // com o suporte (livre, com histórico) e os chamados do cliente com o
    // suporte (abertos pelo cliente, fechados por um admin).
    await sql`
      CREATE TABLE IF NOT EXISTS conversas (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tipo VARCHAR(20) NOT NULL,
        aluguel_id UUID REFERENCES alugueis(id) ON DELETE CASCADE,
        consumidor_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        cacambeiro_id UUID REFERENCES usuarios(id) ON DELETE CASCADE,
        assunto VARCHAR(120),
        status VARCHAR(10) NOT NULL DEFAULT 'ABERTA',
        fechada_em TIMESTAMPTZ,
        fechada_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        encerrada_em TIMESTAMPTZ,
        ultima_mensagem_em TIMESTAMPTZ,
        denunciada_em TIMESTAMPTZ,
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT conversas_tipo_check
          CHECK (tipo IN ('PEDIDO', 'SUPORTE_CACAMBEIRO', 'CHAMADO')),
        CONSTRAINT conversas_status_check
          CHECK (status IN ('ABERTA', 'FECHADA')),
        CONSTRAINT conversas_partes_check CHECK (
          (tipo = 'PEDIDO'
            AND aluguel_id IS NOT NULL
            AND consumidor_id IS NOT NULL
            AND cacambeiro_id IS NOT NULL)
          OR (tipo = 'SUPORTE_CACAMBEIRO'
            AND cacambeiro_id IS NOT NULL
            AND consumidor_id IS NULL
            AND aluguel_id IS NULL)
          OR (tipo = 'CHAMADO'
            AND consumidor_id IS NOT NULL
            AND cacambeiro_id IS NULL
            AND assunto IS NOT NULL)
        )
      )
    `;

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_conversas_pedido
      ON conversas(aluguel_id) WHERE tipo = 'PEDIDO'
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_conversas_suporte
      ON conversas(cacambeiro_id) WHERE tipo = 'SUPORTE_CACAMBEIRO'
    `;
    // Um chamado aberto por vez para cada cliente.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_conversas_chamado_aberto
      ON conversas(consumidor_id)
      WHERE tipo = 'CHAMADO' AND status = 'ABERTA'
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_conversas_consumidor
      ON conversas(consumidor_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_conversas_cacambeiro
      ON conversas(cacambeiro_id)
    `;

    // Só texto. `lado` é quem escreveu (e não o usuário), porque o lado
    // ADMIN é compartilhado por todos os admins.
    await sql`
      CREATE TABLE IF NOT EXISTS mensagens (
        id SERIAL PRIMARY KEY,
        conversa_id UUID NOT NULL
          REFERENCES conversas(id) ON DELETE CASCADE,
        remetente_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        lado VARCHAR(10) NOT NULL,
        texto VARCHAR(1000) NOT NULL,
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lida_em TIMESTAMPTZ,
        aviso_email_em TIMESTAMPTZ,

        CONSTRAINT mensagens_lado_check
          CHECK (lado IN ('CLIENTE', 'CACAMBEIRO', 'ADMIN')),
        CONSTRAINT mensagens_texto_check CHECK (length(btrim(texto)) > 0)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_mensagens_conversa
      ON mensagens(conversa_id, id DESC)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_mensagens_nao_lidas
      ON mensagens(conversa_id, lado) WHERE lida_em IS NULL
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS denuncias_chat (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversa_id UUID NOT NULL
          REFERENCES conversas(id) ON DELETE CASCADE,
        denunciante_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        motivo VARCHAR(300),
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        analisada_em TIMESTAMPTZ,
        analisada_por UUID REFERENCES usuarios(id) ON DELETE SET NULL
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_denuncias_chat_conversa
      ON denuncias_chat(conversa_id, criada_em DESC)
    `;

    // Registro de quando um admin abriu uma conversa de pedido (leitura).
    await sql`
      CREATE TABLE IF NOT EXISTS chat_acessos_admin (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        admin_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        conversa_id UUID NOT NULL
          REFERENCES conversas(id) ON DELETE CASCADE,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Pedidos que ainda estão em andamento ganham a conversa já.
    const criadas = await sql`
      INSERT INTO conversas (tipo, aluguel_id, consumidor_id, cacambeiro_id)
      SELECT 'PEDIDO', a.id, a.consumidor_id, a.cacambeiro_id
      FROM alugueis a
      WHERE a.status_aluguel <> 'FINALIZADO'
      ON CONFLICT (aluguel_id) WHERE tipo = 'PEDIDO' DO NOTHING
      RETURNING id
    `;

    console.log(`Conversas de pedidos em andamento criadas: ${criadas.length}`);
    console.log("✅ Migration do chat concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration do chat:", error);
    process.exit(1);
  }
}

migrate();
