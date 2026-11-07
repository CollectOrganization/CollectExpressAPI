const sql = require("../config/db");

async function migrate() {
  try {
    console.log("Executando migration da área de atendimento...");

    // Cerca virtual do caçambeiro: círculo com centro + raio.
    // O raio continua em raio_entrega_km, que deixa de ser obrigatório
    // no cadastro (agora é definido junto com o centro, no mapa).
    await sql`
      ALTER TABLE detalhes_cacambeiro
      ADD COLUMN IF NOT EXISTS centro_lat NUMERIC(9, 6),
      ADD COLUMN IF NOT EXISTS centro_lng NUMERIC(9, 6),
      ADD COLUMN IF NOT EXISTS area_atualizada_em TIMESTAMPTZ
    `;

    await sql`
      ALTER TABLE detalhes_cacambeiro
      ALTER COLUMN raio_entrega_km DROP NOT NULL
    `;

    await sql`
      DO $$
      BEGIN
        ALTER TABLE detalhes_cacambeiro
        ADD CONSTRAINT detalhes_cacambeiro_centro_check CHECK (
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

    // Coordenadas dos endereços de entrega (preenchidas pela API ao salvar
    // o endereço; endereços antigos são localizados quando necessário).
    await sql`
      ALTER TABLE enderecos
      ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
      ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6)
    `;

    console.log("✅ Migration da área de atendimento concluída.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro na migration da área de atendimento:", error);
    process.exit(1);
  }
}

migrate();
