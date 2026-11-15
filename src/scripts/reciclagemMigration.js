const sql = require("../config/db");

/**
 * Materiais recicláveis oferecidos no app. O nome é único, então a
 * migração pode ser repetida sem duplicar.
 */
const MATERIAIS = [
  ["Plástico", "Garrafas PET, embalagens, sacolas e recipientes.", 70, 1500, "400 anos"],
  ["Papel e papelão", "Caixas, jornais, revistas e papel de escritório.", 60, 900, "3 a 6 meses"],
  ["Vidro", "Garrafas, potes e frascos sem tampa.", 30, 300, "1 milhão de anos"],
  ["Metal", "Latas de alumínio e aço, sucata e fios.", 95, 4000, "100 a 500 anos"],
  ["Eletrônicos", "Aparelhos, cabos, placas e baterias.", 80, 2000, "Indeterminado"],
  ["Madeira", "Pallets, tábuas e restos de móveis sem tinta tóxica.", 25, 600, "10 a 15 anos"],
  ["Óleo de cozinha", "Óleo usado em recipiente fechado.", 40, 700, "Indeterminado"],
  ["Outros", "Outros materiais recicláveis descritos na sinalização.", 0, 0, null],
];

async function migrate() {
  try {
    console.log("Executando migration da reciclagem...");

    // Novo perfil. Cada instrução é uma transação própria, então o valor
    // já pode ser usado nas seguintes.
    await sql`ALTER TYPE tipo_perfil ADD VALUE IF NOT EXISTS 'PARCEIRO'`;

    await sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;

    await sql`
      CREATE TABLE IF NOT EXISTS materiais_reciclaveis (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nome VARCHAR(100) NOT NULL,
        descricao TEXT,
        icone_url VARCHAR(500),
        tipos_aceitos TEXT[] NOT NULL DEFAULT '{}',
        tipos_nao_aceitos TEXT[] NOT NULL DEFAULT '{}',
        impacto_energia INTEGER NOT NULL DEFAULT 0,
        impacto_co2 INTEGER NOT NULL DEFAULT 0,
        tempo_decomposicao VARCHAR(50),
        criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT materiais_reciclaveis_nome_unique UNIQUE (nome)
      )
    `;

    for (const [nome, descricao, energia, co2, decomposicao] of MATERIAIS) {
      await sql`
        INSERT INTO materiais_reciclaveis (
          nome, descricao, impacto_energia, impacto_co2, tempo_decomposicao
        )
        VALUES (${nome}, ${descricao}, ${energia}, ${co2}, ${decomposicao})
        ON CONFLICT (nome) DO NOTHING
      `;
    }

    // Perfil do parceiro: assinatura da empresa e região de atuação
    // (círculo, como a cerca do caçambeiro).
    await sql`
      ALTER TABLE detalhes_parceiro
      ADD COLUMN IF NOT EXISTS responsavel_nome VARCHAR(150),
      ADD COLUMN IF NOT EXISTS assinatura_path VARCHAR(500),
      ADD COLUMN IF NOT EXISTS assinatura_atualizada_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS centro_lat NUMERIC(9, 6),
      ADD COLUMN IF NOT EXISTS centro_lng NUMERIC(9, 6),
      ADD COLUMN IF NOT EXISTS raio_atuacao_km NUMERIC(5, 2),
      ADD COLUMN IF NOT EXISTS area_atualizada_em TIMESTAMPTZ
    `;

    await sql`
      ALTER TABLE detalhes_parceiro
      ALTER COLUMN capacidade_diaria_kg DROP NOT NULL,
      ALTER COLUMN materiais_aceitos DROP NOT NULL
    `;

    await sql`
      DO $$
      BEGIN
        ALTER TABLE detalhes_parceiro
        ADD CONSTRAINT detalhes_parceiro_centro_check CHECK (
          (centro_lat IS NULL AND centro_lng IS NULL)
          OR (
            centro_lat BETWEEN -90 AND 90
            AND centro_lng BETWEEN -180 AND 180
          )
        );
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS parceiro_materiais (
        parceiro_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        material_id UUID NOT NULL
          REFERENCES materiais_reciclaveis(id) ON DELETE CASCADE,
        PRIMARY KEY (parceiro_id, material_id)
      )
    `;

    // Sinalização de material reciclável disponível para retirada.
    await sql`
      CREATE TABLE IF NOT EXISTS ofertas_coleta (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        anunciante_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        endereco_id UUID NOT NULL REFERENCES enderecos(id) ON DELETE RESTRICT,
        descricao TEXT NOT NULL,
        quantidade_estimada VARCHAR(100) NOT NULL,
        observacoes VARCHAR(500),
        janela_inicio TIMESTAMPTZ NOT NULL,
        janela_fim TIMESTAMPTZ NOT NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'ABERTA',
        aceite_termos_em TIMESTAMPTZ NOT NULL,
        aceite_ip VARCHAR(64),
        versao_termos VARCHAR(10) NOT NULL,
        assinatura_path VARCHAR(500),
        cancelada_em TIMESTAMPTZ,
        criada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

        CONSTRAINT ofertas_coleta_status_check CHECK (
          status IN ('ABERTA', 'AGENDADA', 'CONCLUIDA', 'CANCELADA', 'EXPIRADA')
        ),
        CONSTRAINT ofertas_coleta_janela_check CHECK (janela_fim > janela_inicio)
      )
    `;

    await sql`
      CREATE INDEX IF NOT EXISTS idx_ofertas_coleta_status
      ON ofertas_coleta(status, janela_fim)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_ofertas_coleta_anunciante
      ON ofertas_coleta(anunciante_id)
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS oferta_materiais (
        oferta_id UUID NOT NULL REFERENCES ofertas_coleta(id) ON DELETE CASCADE,
        material_id UUID NOT NULL
          REFERENCES materiais_reciclaveis(id) ON DELETE RESTRICT,
        PRIMARY KEY (oferta_id, material_id)
      )
    `;

    // coletas já existia: consumidor_id passa a ser "quem entrega" (cliente
    // ou caçambeiro). Ganha o vínculo com a sinalização, o prazo de
    // cancelamento, o documento e o fechamento.
    await sql`
      ALTER TABLE coletas
      ADD COLUMN IF NOT EXISTS oferta_id UUID REFERENCES ofertas_coleta(id),
      ADD COLUMN IF NOT EXISTS agendada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS cancelavel_ate TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS observacoes VARCHAR(500),
      ADD COLUMN IF NOT EXISTS codigo VARCHAR(24),
      ADD COLUMN IF NOT EXISTS documento_hash CHAR(64),
      ADD COLUMN IF NOT EXISTS documento_path VARCHAR(500),
      ADD COLUMN IF NOT EXISTS documento_versao VARCHAR(10),
      ADD COLUMN IF NOT EXISTS assinatura_gerador_path VARCHAR(500),
      ADD COLUMN IF NOT EXISTS assinatura_parceiro_path VARCHAR(500),
      ADD COLUMN IF NOT EXISTS cancelada_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS cancelada_por UUID
        REFERENCES usuarios(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS cancelamento_motivo VARCHAR(300),
      ADD COLUMN IF NOT EXISTS concluida_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS peso_real_kg NUMERIC(10, 2),
      ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ
    `;

    await sql`
      ALTER TABLE coletas
      ALTER COLUMN data_agendada TYPE TIMESTAMPTZ
      USING data_agendada AT TIME ZONE 'UTC'
    `;
    await sql`ALTER TABLE coletas ALTER COLUMN status SET DEFAULT 'AGENDADA'`;

    // Uma sinalização só tem uma coleta ativa (ou concluída) de cada vez.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coletas_oferta_ativa
      ON coletas(oferta_id) WHERE status IN ('AGENDADA', 'CONCLUIDA')
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_coletas_codigo
      ON coletas(codigo) WHERE codigo IS NOT NULL
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_coletas_parceiro_status
      ON coletas(parceiro_id, status)
    `;

    // Chat: nova conversa entre quem entrega e o parceiro.
    await sql`
      ALTER TABLE conversas
      ADD COLUMN IF NOT EXISTS coleta_id UUID REFERENCES coletas(id)
        ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS parceiro_id UUID REFERENCES usuarios(id)
        ON DELETE CASCADE
    `;
    await sql`ALTER TABLE conversas DROP CONSTRAINT IF EXISTS conversas_tipo_check`;
    await sql`
      ALTER TABLE conversas ADD CONSTRAINT conversas_tipo_check
      CHECK (tipo IN ('PEDIDO', 'SUPORTE_CACAMBEIRO', 'CHAMADO', 'COLETA'))
    `;
    await sql`ALTER TABLE conversas DROP CONSTRAINT IF EXISTS conversas_partes_check`;
    await sql`
      ALTER TABLE conversas ADD CONSTRAINT conversas_partes_check CHECK (
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
        OR (tipo = 'COLETA'
          AND coleta_id IS NOT NULL
          AND parceiro_id IS NOT NULL
          AND aluguel_id IS NULL
          AND ((consumidor_id IS NOT NULL) <> (cacambeiro_id IS NOT NULL)))
      )
    `;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_conversas_coleta
      ON conversas(coleta_id) WHERE tipo = 'COLETA'
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_conversas_parceiro
      ON conversas(parceiro_id)
    `;
    await sql`ALTER TABLE mensagens DROP CONSTRAINT IF EXISTS mensagens_lado_check`;
    await sql`
      ALTER TABLE mensagens ADD CONSTRAINT mensagens_lado_check
      CHECK (lado IN ('CLIENTE', 'CACAMBEIRO', 'ADMIN', 'PARCEIRO'))
    `;

    console.log("✅ Migration da reciclagem concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration da reciclagem:", error);
    process.exit(1);
  }
}

migrate();
