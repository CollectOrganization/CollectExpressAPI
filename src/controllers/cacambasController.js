const sql = require("../config/db");

const ITEMS_PER_PAGE = 20;

/**
 * Builds filter conditions and executes the appropriate queries for listing dumpsters.
 * Uses neon tagged templates for safe parameterized queries.
 */
async function executeListQuery({ tipo_residuo, cacambeiro_id, search, offset }) {
  const hasSearch = search && search.length >= 3;
  const searchPattern = hasSearch ? `%${search.toLowerCase()}%` : null;

  // Determine which combination of filters to apply
  if (tipo_residuo && cacambeiro_id && hasSearch) {
    const countRows = await sql`
      SELECT COUNT(*)::int as total FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
        AND c.cacambeiro_id = ${cacambeiro_id}
        AND LOWER(c.nome) LIKE ${searchPattern}
    `;
    const dataRows = await sql`
      SELECT c.* FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
        AND c.cacambeiro_id = ${cacambeiro_id}
        AND LOWER(c.nome) LIKE ${searchPattern}
      ORDER BY c.criado_em DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return { countRows, dataRows };
  }

  if (tipo_residuo && cacambeiro_id) {
    const countRows = await sql`
      SELECT COUNT(*)::int as total FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
        AND c.cacambeiro_id = ${cacambeiro_id}
    `;
    const dataRows = await sql`
      SELECT c.* FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
        AND c.cacambeiro_id = ${cacambeiro_id}
      ORDER BY c.criado_em DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return { countRows, dataRows };
  }

  if (tipo_residuo && hasSearch) {
    const countRows = await sql`
      SELECT COUNT(*)::int as total FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
        AND LOWER(c.nome) LIKE ${searchPattern}
    `;
    const dataRows = await sql`
      SELECT c.* FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
        AND LOWER(c.nome) LIKE ${searchPattern}
      ORDER BY c.criado_em DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return { countRows, dataRows };
  }

  if (cacambeiro_id && hasSearch) {
    const countRows = await sql`
      SELECT COUNT(*)::int as total FROM cacambas c
      WHERE c.disponivel = true
        AND c.cacambeiro_id = ${cacambeiro_id}
        AND LOWER(c.nome) LIKE ${searchPattern}
    `;
    const dataRows = await sql`
      SELECT c.* FROM cacambas c
      WHERE c.disponivel = true
        AND c.cacambeiro_id = ${cacambeiro_id}
        AND LOWER(c.nome) LIKE ${searchPattern}
      ORDER BY c.criado_em DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return { countRows, dataRows };
  }

  if (tipo_residuo) {
    const countRows = await sql`
      SELECT COUNT(*)::int as total FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
    `;
    const dataRows = await sql`
      SELECT c.* FROM cacambas c
      WHERE c.disponivel = true
        AND c.tipo_residuo = ${tipo_residuo}
      ORDER BY c.criado_em DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return { countRows, dataRows };
  }

  if (cacambeiro_id) {
    const countRows = await sql`
      SELECT COUNT(*)::int as total FROM cacambas c
      WHERE c.disponivel = true
        AND c.cacambeiro_id = ${cacambeiro_id}
    `;
    const dataRows = await sql`
      SELECT c.* FROM cacambas c
      WHERE c.disponivel = true
        AND c.cacambeiro_id = ${cacambeiro_id}
      ORDER BY c.criado_em DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return { countRows, dataRows };
  }

  if (hasSearch) {
    const countRows = await sql`
      SELECT COUNT(*)::int as total FROM cacambas c
      WHERE c.disponivel = true
        AND LOWER(c.nome) LIKE ${searchPattern}
    `;
    const dataRows = await sql`
      SELECT c.* FROM cacambas c
      WHERE c.disponivel = true
        AND LOWER(c.nome) LIKE ${searchPattern}
      ORDER BY c.criado_em DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;
    return { countRows, dataRows };
  }

  // No filters
  const countRows = await sql`
    SELECT COUNT(*)::int as total FROM cacambas c
    WHERE c.disponivel = true
  `;
  const dataRows = await sql`
    SELECT c.* FROM cacambas c
    WHERE c.disponivel = true
    ORDER BY c.criado_em DESC
    LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
  `;
  return { countRows, dataRows };
}

const cacambasController = {
  /**
   * GET /api/cacambas/minhas
   * Lista todas as caçambas do fornecedor autenticado,
   * incluindo disponíveis e indisponíveis.
   */
  async minhas(req, res) {
    try {
      const cacambeiroId = req.usuario_id;

      const cacambas = await sql`
        SELECT
          id,
          cacambeiro_id,
          nome,
          tipo_residuo,
          tamanho_m3,
          preco_diaria,
          foto_url,
          disponivel,
          criado_em
        FROM cacambas
        WHERE cacambeiro_id = ${cacambeiroId}
        ORDER BY criado_em DESC
      `;

      return res.status(200).json({
        success: true,
        data: cacambas,
      });
    } catch (error) {
      console.error("Erro ao listar minhas caçambas:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno ao buscar suas caçambas.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  async listar(req, res) {
    // mantenha a implementação atual
  },
  
  /**
   * GET /api/cacambas
   * Lista caçambas disponíveis no marketplace com paginação, busca e filtros.
   * Query params: page, tipo_residuo, cacambeiro_id, search (min 3 chars)
   * Retorna apenas disponivel=true, ordenado por criado_em DESC.
   */
  async listar(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const { tipo_residuo, cacambeiro_id, search } = req.query;
      const offset = (page - 1) * ITEMS_PER_PAGE;

      const { countRows, dataRows } = await executeListQuery({
        tipo_residuo,
        cacambeiro_id,
        search,
        offset
      });

      const total = countRows[0].total;
      const totalPages = Math.ceil(total / ITEMS_PER_PAGE);

      return res.status(200).json({
        data: dataRows,
        total,
        page,
        totalPages
      });
    } catch (error) {
      console.error("Erro ao listar caçambas:", error);
      return res.status(500).json({ error: "Erro interno ao buscar caçambas." });
    }
  },

  /**
   * GET /api/cacambas/:id
   * Retorna detalhes completos da caçamba + info do cacambeiro + até 10 avaliações recentes.
   */
  async detalhe(req, res) {
    try {
      const { id } = req.params;

      // Buscar caçamba com dados do cacambeiro
      const cacambaRows = await sql`
        SELECT 
          c.*,
          u.nome_completo as cacambeiro_nome_completo,
          u.telefone as cacambeiro_telefone,
          dc.horario_inicio as cacambeiro_horario_inicio,
          dc.horario_fim as cacambeiro_horario_fim,
          dc.raio_entrega_km as cacambeiro_raio_entrega_km,
          dc.taxa_entrega as cacambeiro_taxa_entrega
        FROM cacambas c
        JOIN usuarios u ON u.id = c.cacambeiro_id
        LEFT JOIN detalhes_cacambeiro dc ON dc.usuario_id = c.cacambeiro_id
        WHERE c.id = ${id}
      `;

      if (cacambaRows.length === 0) {
        return res.status(404).json({ error: "Caçamba não encontrada." });
      }

      const cacamba = cacambaRows[0];

      // Calcular nota_media do cacambeiro
      const notaRows = await sql`
        SELECT ROUND(AVG(nota)::numeric, 1)::float as nota_media
        FROM avaliacoes
        WHERE cacambeiro_id = ${cacamba.cacambeiro_id}
      `;

      const nota_media = notaRows[0].nota_media || null;

      // Buscar até 10 avaliações mais recentes do cacambeiro
      const avaliacoes = await sql`
        SELECT 
          a.nota,
          a.comentario,
          a.data_avaliacao,
          u.nome_completo
        FROM avaliacoes a
        JOIN usuarios u ON u.id = a.consumidor_id
        WHERE a.cacambeiro_id = ${cacamba.cacambeiro_id}
        ORDER BY a.data_avaliacao DESC
        LIMIT 10
      `;

      // Montar resposta
      const response = {
        id: cacamba.id,
        cacambeiro_id: cacamba.cacambeiro_id,
        nome: cacamba.nome,
        tipo_residuo: cacamba.tipo_residuo,
        tamanho_m3: cacamba.tamanho_m3,
        preco_diaria: cacamba.preco_diaria,
        foto_url: cacamba.foto_url,
        disponivel: cacamba.disponivel,
        criado_em: cacamba.criado_em,
        cacambeiro: {
          nome_completo: cacamba.cacambeiro_nome_completo,
          telefone: cacamba.cacambeiro_telefone,
          horario_inicio: cacamba.cacambeiro_horario_inicio,
          horario_fim: cacamba.cacambeiro_horario_fim,
          raio_entrega_km: cacamba.cacambeiro_raio_entrega_km,
          nota_media,
          taxa_entrega: cacamba.cacambeiro_taxa_entrega
        },
        avaliacoes
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error("Erro ao buscar detalhes da caçamba:", error);
      return res.status(500).json({ error: "Erro interno ao buscar detalhes da caçamba." });
    }
  },

  /**
   * POST /api/cacambas
   * Cria nova caçamba. Requer perfil CACAMBEIRO.
   * Valida campos: nome (1-100), tipo_residuo (1-50), tamanho_m3 (0.01-999.99), preco_diaria (0.01-99999999.99)
   * Define cacambeiro_id = req.usuario_id e disponivel = true por padrão.
   */
  async criar(req, res) {
    try {
      const cacambeiro_id = req.usuario_id;
      const { nome, tipo_residuo, tamanho_m3, preco_diaria, foto_url } = req.body;

      const resultado = await sql`
        INSERT INTO cacambas (
          id, cacambeiro_id, nome, tipo_residuo, tamanho_m3, preco_diaria, foto_url, disponivel
        ) VALUES (
          gen_random_uuid(),
          ${cacambeiro_id},
          ${nome},
          ${tipo_residuo},
          ${tamanho_m3},
          ${preco_diaria},
          ${foto_url || null},
          true
        )
        RETURNING *
      `;

      return res.status(201).json(resultado[0]);
    } catch (error) {
      console.error("Erro ao criar caçamba:", error);
      return res.status(500).json({ error: "Erro interno ao cadastrar a caçamba." });
    }
  },

  /**
   * PUT /api/cacambas/:id
   * Atualiza caçamba. Apenas o dono (cacambeiro_id = req.usuario_id) pode atualizar.
   * Campos atualizáveis: preco_diaria, disponivel, foto_url, nome, tipo_residuo, tamanho_m3
   */
  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const cacambeiro_id = req.usuario_id;

      // Verificar se a caçamba existe
      const cacambaExistente = await sql`
        SELECT * FROM cacambas WHERE id = ${id}
      `;

      if (cacambaExistente.length === 0) {
        return res.status(404).json({ error: "Caçamba não encontrada." });
      }

      // Verificar se o usuário é o dono
      if (cacambaExistente[0].cacambeiro_id !== cacambeiro_id) {
        return res.status(403).json({ error: "Acesso não autorizado" });
      }

      const { preco_diaria, disponivel, foto_url, nome, tipo_residuo, tamanho_m3 } = req.body;

      const resultado = await sql`
        UPDATE cacambas SET
          preco_diaria = COALESCE(${preco_diaria !== undefined ? preco_diaria : null}, preco_diaria),
          disponivel = COALESCE(${disponivel !== undefined ? disponivel : null}, disponivel),
          foto_url = COALESCE(${foto_url !== undefined ? foto_url : null}, foto_url),
          nome = COALESCE(${nome !== undefined ? nome : null}, nome),
          tipo_residuo = COALESCE(${tipo_residuo !== undefined ? tipo_residuo : null}, tipo_residuo),
          tamanho_m3 = COALESCE(${tamanho_m3 !== undefined ? tamanho_m3 : null}, tamanho_m3)
        WHERE id = ${id} AND cacambeiro_id = ${cacambeiro_id}
        RETURNING *
      `;

      return res.status(200).json(resultado[0]);
    } catch (error) {
      console.error("Erro ao atualizar caçamba:", error);
      return res.status(500).json({ error: "Erro interno ao atualizar a caçamba." });
    }
  },

  /**
   * DELETE /api/cacambas/:id
   * Remove caçamba. Apenas o dono pode remover.
   * Verifica se existem pedidos ativos antes de permitir a exclusão.
   */
  async remover(req, res) {
    try {
      const { id } = req.params;
      const cacambeiro_id = req.usuario_id;

      // Verificar se a caçamba existe
      const cacambaExistente = await sql`
        SELECT * FROM cacambas WHERE id = ${id}
      `;

      if (cacambaExistente.length === 0) {
        return res.status(404).json({ error: "Caçamba não encontrada." });
      }

      // Verificar se o usuário é o dono
      if (cacambaExistente[0].cacambeiro_id !== cacambeiro_id) {
        return res.status(403).json({ error: "Acesso não autorizado" });
      }

      // Verificar se existem pedidos ativos (via itens_aluguel)
      const pedidosAtivos = await sql`
        SELECT COUNT(*)::int as count
        FROM alugueis a
        JOIN itens_aluguel ia ON ia.aluguel_id = a.id
        WHERE ia.cacamba_id = ${id}
          AND a.status_aluguel IN ('AGUARDANDO_ENTREGA', 'EM_USO', 'AGUARDANDO_RETIRADA')
      `;

      if (pedidosAtivos[0].count > 0) {
        return res.status(400).json({
          error: "Não é possível remover a caçamba pois existem pedidos ativos associados a ela."
        });
      }

      // Deletar a caçamba
      await sql`DELETE FROM cacambas WHERE id = ${id}`;

      return res.status(200).json({ message: "Caçamba removida com sucesso." });
    } catch (error) {
      console.error("Erro ao remover caçamba:", error);
      return res.status(500).json({ error: "Erro interno ao remover caçamba." });
    }
  }
};

module.exports = cacambasController;
