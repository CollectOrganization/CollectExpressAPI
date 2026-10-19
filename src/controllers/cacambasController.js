const sql = require("../config/db");

const ITEMS_PER_PAGE = 20;
const MAX_PAGE = 100000;

/**
 * Converte valores decimais retornados pelo PostgreSQL para Number.
 * O driver pode retornar campos DECIMAL/NUMERIC como String.
 */
function serializeCacamba(cacamba) {
  if (!cacamba) return null;

  return {
    ...cacamba,
    tamanho_m3:
      cacamba.tamanho_m3 !== null
        ? Number(cacamba.tamanho_m3)
        : null,
    preco_diaria:
      cacamba.preco_diaria !== null
        ? Number(cacamba.preco_diaria)
        : null,
  };
}

/**
 * Normaliza strings opcionais recebidas pela query.
 */
function normalizeQueryString(value) {
  if (typeof value !== "string") return null;

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

/**
 * Retorna uma resposta de erro padronizada.
 */
function sendError(
  res,
  status,
  message,
  code,
  fields = undefined,
) {
  return res.status(status).json({
    success: false,
    message,
    code,
    ...(fields ? { fields } : {}),
  });
}

/**
 * Verifica se uma categoria existe.
 *
 * Atualmente caçambas e categorias são relacionadas pelo nome.
 * Futuramente, o ideal será usar cacambas.categoria_id.
 */
async function categoryExists(categoryName) {
  const rows = await sql`
    SELECT id
    FROM categorias
    WHERE LOWER(nome) = LOWER(${categoryName})
    LIMIT 1
  `;

  return rows.length > 0;
}

/**
 * Executa a consulta pública de caçambas.
 *
 * Os parâmetros opcionais são aplicados diretamente no SQL:
 * - tipo_residuo;
 * - cacambeiro_id;
 * - search.
 *
 * Todas as variáveis são parametrizadas pelo driver Neon,
 * protegendo a consulta contra SQL Injection.
 */
async function executeListQuery({
  tipoResiduo,
  cacambeiroId,
  searchPattern,
  offset,
}) {
  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM cacambas c
    WHERE c.disponivel = TRUE

      AND (
        ${tipoResiduo}::text IS NULL
        OR LOWER(c.tipo_residuo) = LOWER(${tipoResiduo}::text)
      )

      AND (
        ${cacambeiroId}::uuid IS NULL
        OR c.cacambeiro_id = ${cacambeiroId}::uuid
      )

      AND (
        ${searchPattern}::text IS NULL
        OR LOWER(c.nome) LIKE LOWER(${searchPattern}::text)
      )
  `;

  const dataRows = await sql`
    SELECT
      c.id,
      c.cacambeiro_id,
      c.nome,
      c.tipo_residuo,
      c.tamanho_m3,
      c.preco_diaria,
      c.foto_url,
      c.disponivel,
      c.criado_em
    FROM cacambas c
    WHERE c.disponivel = TRUE

      AND (
        ${tipoResiduo}::text IS NULL
        OR LOWER(c.tipo_residuo) = LOWER(${tipoResiduo}::text)
      )

      AND (
        ${cacambeiroId}::uuid IS NULL
        OR c.cacambeiro_id = ${cacambeiroId}::uuid
      )

      AND (
        ${searchPattern}::text IS NULL
        OR LOWER(c.nome) LIKE LOWER(${searchPattern}::text)
      )

    ORDER BY c.criado_em DESC
    LIMIT ${ITEMS_PER_PAGE}
    OFFSET ${offset}
  `;

  return {
    total: countRows[0]?.total ?? 0,
    rows: dataRows,
  };
}

const cacambasController = {
  /**
   * GET /api/cacambas/minhas
   *
   * Lista todas as caçambas pertencentes ao fornecedor autenticado.
   * Diferentemente do marketplace público, também retorna caçambas
   * indisponíveis.
   *
   * Requer:
   * - autenticação;
   * - perfil CACAMBEIRO.
   */
  async minhas(req, res) {
    try {
      const cacambeiroId = req.usuario_id;

      const rows = await sql`
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
        message: "Caçambas do fornecedor carregadas com sucesso.",
        data: rows.map(serializeCacamba),
      });
    } catch (error) {
      console.error("Erro ao listar minhas caçambas:", error);

      return sendError(
        res,
        500,
        "Erro interno ao buscar suas caçambas.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * GET /api/cacambas
   *
   * Lista as caçambas disponíveis no marketplace.
   *
   * Query params:
   * - page: página atual;
   * - tipo_residuo: categoria;
   * - cacambeiro_id: fornecedor;
   * - search: pesquisa pelo nome, com no mínimo 3 caracteres.
   *
   * Esta rota é pública.
   */
  async listar(req, res) {
    try {
      const parsedPage = Number.parseInt(req.query.page, 10);

      const page = Math.min(
        MAX_PAGE,
        Math.max(
          1,
          Number.isNaN(parsedPage) ? 1 : parsedPage,
        ),
      );

      const tipoResiduo = normalizeQueryString(
        req.query.tipo_residuo,
      );

      const cacambeiroId = normalizeQueryString(
        req.query.cacambeiro_id,
      );

      const search = normalizeQueryString(req.query.search);

      // Pesquisas menores que três caracteres são ignoradas.
      const searchPattern =
        search && search.length >= 3
          ? `%${search}%`
          : null;

      const offset = (page - 1) * ITEMS_PER_PAGE;

      const { total, rows } = await executeListQuery({
        tipoResiduo,
        cacambeiroId,
        searchPattern,
        offset,
      });

      const totalPages = Math.ceil(
        total / ITEMS_PER_PAGE,
      );

      return res.status(200).json({
        success: true,
        data: {
          items: rows.map(serializeCacamba),
          pagination: {
            total,
            page,
            per_page: ITEMS_PER_PAGE,
            total_pages: totalPages,
          },
          filters: {
            tipo_residuo: tipoResiduo,
            cacambeiro_id: cacambeiroId,
            search:
              search && search.length >= 3
                ? search
                : null,
          },
        },
      });
    } catch (error) {
      console.error("Erro ao listar caçambas:", error);

      /*
       * Código PostgreSQL 22P02:
       * valor inválido para UUID ou outro tipo de dado.
       */
      if (error.code === "22P02") {
        return sendError(
          res,
          400,
          "Um dos filtros informados possui formato inválido.",
          "INVALID_FILTER",
        );
      }

      return sendError(
        res,
        500,
        "Erro interno ao buscar caçambas.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * GET /api/cacambas/:id
   *
   * Retorna:
   * - dados completos da caçamba;
   * - informações do fornecedor;
   * - nota média;
   * - até dez avaliações recentes.
   *
   * Esta rota é pública.
   */
  async detalhe(req, res) {
    try {
      const { id } = req.params;

      const rows = await sql`
        SELECT
          c.id,
          c.cacambeiro_id,
          c.nome,
          c.tipo_residuo,
          c.tamanho_m3,
          c.preco_diaria,
          c.foto_url,
          c.disponivel,
          c.criado_em,

          u.nome_completo
            AS cacambeiro_nome_completo,

          u.telefone
            AS cacambeiro_telefone,

          dc.horario_inicio
            AS cacambeiro_horario_inicio,

          dc.horario_fim
            AS cacambeiro_horario_fim,

          dc.raio_entrega_km
            AS cacambeiro_raio_entrega_km,

          dc.taxa_entrega
            AS cacambeiro_taxa_entrega

        FROM cacambas c

        INNER JOIN usuarios u
          ON u.id = c.cacambeiro_id

        LEFT JOIN detalhes_cacambeiro dc
          ON dc.usuario_id = c.cacambeiro_id

        WHERE c.id = ${id}
      `;

      if (rows.length === 0) {
        return sendError(
          res,
          404,
          "Caçamba não encontrada.",
          "DUMPSTER_NOT_FOUND",
        );
      }

      const cacamba = rows[0];

      const ratingRows = await sql`
        SELECT
          ROUND(AVG(nota)::numeric, 1)::float
            AS nota_media,
          COUNT(*)::int
            AS total_avaliacoes
        FROM avaliacoes
        WHERE cacambeiro_id = ${cacamba.cacambeiro_id}
      `;

      const reviews = await sql`
        SELECT
          a.id,
          a.nota,
          a.comentario,
          a.data_avaliacao,
          u.nome_completo AS consumidor_nome
        FROM avaliacoes a

        INNER JOIN usuarios u
          ON u.id = a.consumidor_id

        WHERE a.cacambeiro_id = ${cacamba.cacambeiro_id}
        ORDER BY a.data_avaliacao DESC
        LIMIT 10
      `;

      const data = {
        ...serializeCacamba({
          id: cacamba.id,
          cacambeiro_id: cacamba.cacambeiro_id,
          nome: cacamba.nome,
          tipo_residuo: cacamba.tipo_residuo,
          tamanho_m3: cacamba.tamanho_m3,
          preco_diaria: cacamba.preco_diaria,
          foto_url: cacamba.foto_url,
          disponivel: cacamba.disponivel,
          criado_em: cacamba.criado_em,
        }),

        cacambeiro: {
          id: cacamba.cacambeiro_id,
          nome_completo:
            cacamba.cacambeiro_nome_completo,
          telefone:
            cacamba.cacambeiro_telefone,
          horario_inicio:
            cacamba.cacambeiro_horario_inicio,
          horario_fim:
            cacamba.cacambeiro_horario_fim,
          raio_entrega_km:
            cacamba.cacambeiro_raio_entrega_km !== null
              ? Number(
                  cacamba.cacambeiro_raio_entrega_km,
                )
              : null,
          taxa_entrega:
            cacamba.cacambeiro_taxa_entrega !== null
              ? Number(
                  cacamba.cacambeiro_taxa_entrega,
                )
              : null,
          nota_media:
            ratingRows[0]?.nota_media ?? null,
          total_avaliacoes:
            ratingRows[0]?.total_avaliacoes ?? 0,
        },

        avaliacoes: reviews,
      };

      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error(
        "Erro ao buscar detalhes da caçamba:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar detalhes da caçamba.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * POST /api/cacambas
   *
   * Cria uma nova caçamba para o fornecedor autenticado.
   *
   * Requer:
   * - autenticação;
   * - perfil CACAMBEIRO;
   * - validação de request feita pela rota.
   */
  async criar(req, res) {
    try {
      const cacambeiroId = req.usuario_id;

      const {
        nome,
        tipo_residuo,
        tamanho_m3,
        preco_diaria,
        foto_url,
      } = req.body;

      /*
       * Como categorias ainda estão vinculadas por texto,
       * validamos se o nome informado existe em categorias.
       */
      const categoriaValida = await categoryExists(
        tipo_residuo.trim(),
      );

      if (!categoriaValida) {
        return sendError(
          res,
          400,
          "A categoria informada não existe.",
          "CATEGORY_NOT_FOUND",
          {
            tipo_residuo:
              "Selecione uma categoria cadastrada.",
          },
        );
      }

      const rows = await sql`
        INSERT INTO cacambas (
          id,
          cacambeiro_id,
          nome,
          tipo_residuo,
          tamanho_m3,
          preco_diaria,
          foto_url,
          disponivel
        )
        VALUES (
          gen_random_uuid(),
          ${cacambeiroId},
          ${nome.trim()},
          ${tipo_residuo.trim()},
          ${tamanho_m3},
          ${preco_diaria},
          ${foto_url || null},
          TRUE
        )
        RETURNING
          id,
          cacambeiro_id,
          nome,
          tipo_residuo,
          tamanho_m3,
          preco_diaria,
          foto_url,
          disponivel,
          criado_em
      `;

      return res.status(201).json({
        success: true,
        message: "Caçamba cadastrada com sucesso.",
        data: serializeCacamba(rows[0]),
      });
    } catch (error) {
      console.error("Erro ao criar caçamba:", error);

      return sendError(
        res,
        500,
        "Erro interno ao cadastrar a caçamba.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * PUT /api/cacambas/:id
   *
   * Atualiza uma caçamba.
   *
   * Somente o fornecedor proprietário pode realizar a alteração.
   * A rota deve garantir que pelo menos um campo editável foi enviado.
   */
  async atualizar(req, res) {
    try {
      const { id } = req.params;
      const cacambeiroId = req.usuario_id;

      const {
        preco_diaria,
        disponivel,
        foto_url,
        nome,
        tipo_residuo,
        tamanho_m3,
      } = req.body;

      const existingRows = await sql`
        SELECT id, cacambeiro_id
        FROM cacambas
        WHERE id = ${id}
      `;

      if (existingRows.length === 0) {
        return sendError(
          res,
          404,
          "Caçamba não encontrada.",
          "DUMPSTER_NOT_FOUND",
        );
      }

      if (
        existingRows[0].cacambeiro_id !==
        cacambeiroId
      ) {
        return sendError(
          res,
          403,
          "Você não possui permissão para alterar esta caçamba.",
          "DUMPSTER_ACCESS_DENIED",
        );
      }

      if (tipo_residuo !== undefined) {
        const categoriaValida = await categoryExists(
          tipo_residuo.trim(),
        );

        if (!categoriaValida) {
          return sendError(
            res,
            400,
            "A categoria informada não existe.",
            "CATEGORY_NOT_FOUND",
            {
              tipo_residuo:
                "Selecione uma categoria cadastrada.",
            },
          );
        }
      }

      /*
       * Os booleanos abaixo indicam se o campo foi enviado.
       * Isso permite, por exemplo, limpar foto_url enviando null.
       */
      const hasPrice = preco_diaria !== undefined;
      const hasAvailable = disponivel !== undefined;
      const hasPhoto = foto_url !== undefined;
      const hasName = nome !== undefined;
      const hasCategory = tipo_residuo !== undefined;
      const hasSize = tamanho_m3 !== undefined;

      const rows = await sql`
        UPDATE cacambas
        SET
          preco_diaria = CASE
            WHEN ${hasPrice}
              THEN ${preco_diaria ?? null}
            ELSE preco_diaria
          END,

          disponivel = CASE
            WHEN ${hasAvailable}
              THEN ${disponivel ?? null}
            ELSE disponivel
          END,

          foto_url = CASE
            WHEN ${hasPhoto}
              THEN ${foto_url ?? null}
            ELSE foto_url
          END,

          nome = CASE
            WHEN ${hasName}
              THEN ${nome?.trim() ?? null}
            ELSE nome
          END,

          tipo_residuo = CASE
            WHEN ${hasCategory}
              THEN ${tipo_residuo?.trim() ?? null}
            ELSE tipo_residuo
          END,

          tamanho_m3 = CASE
            WHEN ${hasSize}
              THEN ${tamanho_m3 ?? null}
            ELSE tamanho_m3
          END

        WHERE id = ${id}
          AND cacambeiro_id = ${cacambeiroId}

        RETURNING
          id,
          cacambeiro_id,
          nome,
          tipo_residuo,
          tamanho_m3,
          preco_diaria,
          foto_url,
          disponivel,
          criado_em
      `;

      if (rows.length === 0) {
        return sendError(
          res,
          409,
          "A caçamba não pôde ser atualizada.",
          "DUMPSTER_UPDATE_FAILED",
        );
      }

      return res.status(200).json({
        success: true,
        message: "Caçamba atualizada com sucesso.",
        data: serializeCacamba(rows[0]),
      });
    } catch (error) {
      console.error("Erro ao atualizar caçamba:", error);

      return sendError(
        res,
        500,
        "Erro interno ao atualizar a caçamba.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * DELETE /api/cacambas/:id
   *
   * Remove ou desativa uma caçamba.
   *
   * Regras:
   * - somente o proprietário pode executar;
   * - caçambas com pedidos ativos não podem ser removidas;
   * - caçambas com histórico são apenas desativadas;
   * - caçambas sem histórico podem ser excluídas fisicamente.
   */
  async remover(req, res) {
    try {
      const { id } = req.params;
      const cacambeiroId = req.usuario_id;

      const rows = await sql`
        SELECT id, cacambeiro_id
        FROM cacambas
        WHERE id = ${id}
      `;

      if (rows.length === 0) {
        return sendError(
          res,
          404,
          "Caçamba não encontrada.",
          "DUMPSTER_NOT_FOUND",
        );
      }

      if (rows[0].cacambeiro_id !== cacambeiroId) {
        return sendError(
          res,
          403,
          "Você não possui permissão para remover esta caçamba.",
          "DUMPSTER_ACCESS_DENIED",
        );
      }

      const orderStats = await sql`
        SELECT
          COUNT(*)::int AS total,

          COUNT(*) FILTER (
            WHERE a.status_aluguel IN (
              'AGUARDANDO_ENTREGA',
              'EM_USO',
              'AGUARDANDO_RETIRADA'
            )
          )::int AS ativos

        FROM itens_aluguel ia

        INNER JOIN alugueis a
          ON a.id = ia.aluguel_id

        WHERE ia.cacamba_id = ${id}
      `;

      const totalOrders = orderStats[0]?.total ?? 0;
      const activeOrders = orderStats[0]?.ativos ?? 0;

      if (activeOrders > 0) {
        return sendError(
          res,
          409,
          "Não é possível remover a caçamba porque existem pedidos ativos associados.",
          "DUMPSTER_HAS_ACTIVE_ORDERS",
        );
      }

      /*
       * O banco usa ON DELETE RESTRICT em itens_aluguel.
       * Para preservar o histórico, uma caçamba já utilizada
       * é apenas marcada como indisponível.
       */
      if (totalOrders > 0) {
        const disabledRows = await sql`
          UPDATE cacambas
          SET disponivel = FALSE
          WHERE id = ${id}
            AND cacambeiro_id = ${cacambeiroId}
          RETURNING
            id,
            cacambeiro_id,
            nome,
            tipo_residuo,
            tamanho_m3,
            preco_diaria,
            foto_url,
            disponivel,
            criado_em
        `;

        return res.status(200).json({
          success: true,
          message:
            "A caçamba possui histórico e foi desativada.",
          data: serializeCacamba(disabledRows[0]),
        });
      }

      const deletedRows = await sql`
        DELETE FROM cacambas
        WHERE id = ${id}
          AND cacambeiro_id = ${cacambeiroId}
        RETURNING id
      `;

      if (deletedRows.length === 0) {
        return sendError(
          res,
          409,
          "A caçamba não pôde ser removida.",
          "DUMPSTER_DELETE_FAILED",
        );
      }

      return res.status(200).json({
        success: true,
        message: "Caçamba removida com sucesso.",
        data: {
          id: deletedRows[0].id,
          removed: true,
        },
      });
    } catch (error) {
      console.error("Erro ao remover caçamba:", error);

      /*
       * 23503 representa violação de chave estrangeira.
       * É mantido como proteção adicional em caso de concorrência.
       */
      if (error.code === "23503") {
        return sendError(
          res,
          409,
          "A caçamba possui registros associados e não pode ser removida.",
          "DUMPSTER_HAS_RELATIONS",
        );
      }

      return sendError(
        res,
        500,
        "Erro interno ao remover a caçamba.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = cacambasController;


// ---------- Old Version -----------
/*
const sql = require("../config/db");

const ITEMS_PER_PAGE = 20;

/**
 * Builds filter conditions and executes the appropriate queries for listing dumpsters.
 * Uses neon tagged templates for safe parameterized queries.
 *
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
   *
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
   *
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
   *
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
   *
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
   *
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
   *
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
*/