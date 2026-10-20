const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

/**
 * Verifica se o erro recebido representa uma violação de
 * restrição UNIQUE do PostgreSQL.
 */
function isUniqueViolation(error) {
  return error?.code === "23505";
}

/**
 * Converte datas retornadas pelo PostgreSQL para YYYY-MM-DD.
 *
 * Dependendo do driver, a data pode ser uma instância de Date
 * ou uma string.
 */
function formatDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }

  return String(value).slice(0, 10);
}

const adminController = {
  // ============================================
  // CATEGORIAS
  // ============================================

  /**
   * GET /api/admin/categorias
   *
   * Lista todas as categorias cadastradas.
   *
   * Também retorna a quantidade de caçambas associadas por meio
   * do campo textual cacambas.tipo_residuo.
   *
   * Requer perfil ADMIN.
   */
  async listarCategorias(req, res) {
    try {
      const categorias = await sql`
        SELECT
          c.id,
          c.nome,
          c.criado_em,
          COUNT(ca.id)::int AS cacambas_count
        FROM categorias c
        LEFT JOIN cacambas ca
          ON LOWER(ca.tipo_residuo) = LOWER(c.nome)
        GROUP BY
          c.id,
          c.nome,
          c.criado_em
        ORDER BY c.nome ASC
      `;

      return sendSuccess(
        res,
        categorias,
        200,
        "Categorias listadas com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao listar categorias:", error);

      return sendError(
        res,
        500,
        "Erro interno ao listar categorias.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * POST /api/admin/categorias
   *
   * Cria uma nova categoria.
   *
   * Body:
   * {
   *   "nome": "Entulho de Obra"
   * }
   *
   * As validações básicas de tipo e comprimento devem ser
   * realizadas pelo validationMiddleware.
   *
   * Este método mantém as regras de negócio:
   * - normalização do nome;
   * - unicidade sem diferenciar maiúsculas e minúsculas.
   *
   * Requer perfil ADMIN.
   */
  async criarCategoria(req, res) {
    try {
      const nomeNormalizado = req.body.nome.trim();

      // Verifica a duplicidade antes do INSERT para retornar
      // uma mensagem mais amigável.
      const categoriasExistentes = await sql`
        SELECT id
        FROM categorias
        WHERE LOWER(nome) = LOWER(${nomeNormalizado})
        LIMIT 1
      `;

      if (categoriasExistentes.length > 0) {
        return sendError(
          res,
          409,
          "Já existe uma categoria com este nome.",
          "CATEGORY_ALREADY_EXISTS",
          {
            nome: "Já existe uma categoria com este nome.",
          },
        );
      }

      const resultado = await sql`
        INSERT INTO categorias (
          nome
        )
        VALUES (
          ${nomeNormalizado}
        )
        RETURNING
          id,
          nome,
          criado_em
      `;

      return sendSuccess(
        res,
        resultado[0],
        201,
        "Categoria criada com sucesso.",
      );
    } catch (error) {
      /**
       * A constraint UNIQUE continua sendo tratada porque duas
       * requisições simultâneas podem passar pela consulta anterior.
       */
      if (isUniqueViolation(error)) {
        return sendError(
          res,
          409,
          "Já existe uma categoria com este nome.",
          "CATEGORY_ALREADY_EXISTS",
          {
            nome: "Já existe uma categoria com este nome.",
          },
        );
      }

      console.error("Erro ao criar categoria:", error);

      return sendError(
        res,
        500,
        "Erro interno ao criar categoria.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * PUT /api/admin/categorias/:id
   *
   * Atualiza o nome de uma categoria.
   *
   * Como categorias e caçambas ainda estão relacionadas pelo texto
   * de tipo_residuo, a alteração também atualiza as caçambas que
   * utilizam o nome antigo.
   *
   * A atualização é realizada em uma única instrução SQL, garantindo
   * atomicidade.
   *
   * Requer perfil ADMIN.
   */
  async atualizarCategoria(req, res) {
    try {
      const { id } = req.params;
      const nomeNormalizado = req.body.nome.trim();

      // Impede que outra categoria utilize o mesmo nome.
      const duplicadas = await sql`
        SELECT id
        FROM categorias
        WHERE LOWER(nome) = LOWER(${nomeNormalizado})
          AND id <> ${id}
        LIMIT 1
      `;

      if (duplicadas.length > 0) {
        return sendError(
          res,
          409,
          "Já existe uma categoria com este nome.",
          "CATEGORY_ALREADY_EXISTS",
          {
            nome: "Já existe uma categoria com este nome.",
          },
        );
      }

      /**
       * O primeiro CTE atualiza a categoria e preserva o nome antigo.
       * O segundo atualiza as caçambas associadas ao nome anterior.
       *
       * Se qualquer atualização falhar, toda a instrução é revertida.
       */
      const resultado = await sql`
        WITH categoria_atualizada AS (
          UPDATE categorias
          SET nome = ${nomeNormalizado}
          WHERE id = ${id}
          RETURNING
            id,
            nome,
            criado_em,
            (
              SELECT nome
              FROM categorias
              WHERE id = ${id}
            ) AS nome_anterior
        ),
        cacambas_atualizadas AS (
          UPDATE cacambas ca
          SET tipo_residuo = ${nomeNormalizado}
          FROM categoria_atualizada categoria
          WHERE LOWER(ca.tipo_residuo) =
                LOWER(categoria.nome_anterior)
          RETURNING ca.id
        )
        SELECT
          id,
          nome,
          criado_em,
          (
            SELECT COUNT(*)::int
            FROM cacambas_atualizadas
          ) AS cacambas_atualizadas
        FROM categoria_atualizada
      `;

      if (resultado.length === 0) {
        return sendError(
          res,
          404,
          "Categoria não encontrada.",
          "CATEGORY_NOT_FOUND",
        );
      }

      return sendSuccess(
        res,
        resultado[0],
        200,
        "Categoria atualizada com sucesso.",
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        return sendError(
          res,
          409,
          "Já existe uma categoria com este nome.",
          "CATEGORY_ALREADY_EXISTS",
          {
            nome: "Já existe uma categoria com este nome.",
          },
        );
      }

      console.error("Erro ao atualizar categoria:", error);

      return sendError(
        res,
        500,
        "Erro interno ao atualizar categoria.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * DELETE /api/admin/categorias/:id
   *
   * Remove uma categoria somente se ela não possuir caçambas
   * associadas.
   *
   * A verificação e a exclusão são feitas na mesma instrução SQL
   * para reduzir condições de corrida.
   *
   * Requer perfil ADMIN.
   */
  async removerCategoria(req, res) {
    try {
      const { id } = req.params;

      const resultado = await sql`
        WITH categoria_alvo AS (
          SELECT
            id,
            nome
          FROM categorias
          WHERE id = ${id}
        ),
        associacoes AS (
          SELECT COUNT(ca.id)::int AS total
          FROM cacambas ca
          JOIN categoria_alvo categoria
            ON LOWER(ca.tipo_residuo) =
               LOWER(categoria.nome)
        ),
        categoria_removida AS (
          DELETE FROM categorias
          WHERE id = ${id}
            AND (
              SELECT total
              FROM associacoes
            ) = 0
          RETURNING id
        )
        SELECT
          categoria.id,
          categoria.nome,
          associacoes.total AS cacambas_associadas,
          EXISTS (
            SELECT 1
            FROM categoria_removida
          ) AS removida
        FROM categoria_alvo categoria
        CROSS JOIN associacoes
      `;

      if (resultado.length === 0) {
        return sendError(
          res,
          404,
          "Categoria não encontrada.",
          "CATEGORY_NOT_FOUND",
        );
      }

      const categoria = resultado[0];

      if (!categoria.removida) {
        return sendError(
          res,
          409,
          `Não é possível remover esta categoria. Existem ${categoria.cacambas_associadas} caçamba(s) associada(s).`,
          "CATEGORY_IN_USE",
        );
      }

      return sendSuccess(
        res,
        {
          id: categoria.id,
          nome: categoria.nome,
        },
        200,
        "Categoria removida com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao remover categoria:", error);

      return sendError(
        res,
        500,
        "Erro interno ao remover categoria.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  // ============================================
  // DASHBOARD ADMINISTRATIVO
  // ============================================

  /**
   * GET /api/admin/dashboard
   *
   * Retorna métricas gerais da plataforma.
   *
   * Query params:
   * - granularity=daily
   * - granularity=weekly
   *
   * Requer perfil ADMIN.
   */
  async dashboard(req, res) {
    try {
      const granularity = req.query.granularity || "daily";

      // Mantemos esta validação como regra de negócio mesmo que
      // também seja adicionada ao middleware das rotas.
      if (!["daily", "weekly"].includes(granularity)) {
        return sendError(
          res,
          400,
          "A granularidade deve ser 'daily' ou 'weekly'.",
          "INVALID_GRANULARITY",
          {
            granularity:
              "Informe 'daily' ou 'weekly'.",
          },
        );
      }

      /**
       * As consultas independentes são executadas em paralelo para
       * reduzir o tempo de resposta do dashboard.
       */
      const [
        totalUsuariosResult,
        totalPedidosResult,
        receitaResult,
        cacambeirosAtivosResult,
        pedidosPorStatusResult,
      ] = await Promise.all([
        sql`
          SELECT COUNT(*)::int AS total
          FROM usuarios
        `,

        sql`
          SELECT COUNT(*)::int AS total
          FROM alugueis
        `,

        sql`
          SELECT
            COALESCE(
              SUM(preco_final),
              0
            )::numeric AS total
          FROM alugueis
          WHERE status_pagamento = 'PAGO'
        `,

        sql`
          SELECT COUNT(DISTINCT u.id)::int AS total
          FROM usuarios u
          INNER JOIN cacambas c
            ON c.cacambeiro_id = u.id
          WHERE u.tipo_perfil = 'CACAMBEIRO'
            AND u.status = 'ATIVO'
            AND c.disponivel = TRUE
        `,

        sql`
          SELECT
            status_aluguel,
            COUNT(*)::int AS count
          FROM alugueis
          GROUP BY status_aluguel
        `,
      ]);

      const totalUsuarios = totalUsuariosResult[0].total;
      const totalPedidos = totalPedidosResult[0].total;
      const receitaTotal = Number(receitaResult[0].total);
      const lucroPlataforma = receitaTotal * 0.05;
      const cacambeirosAtivos =
        cacambeirosAtivosResult[0].total;

      /**
       * Inicializa todos os estados com zero.
       * Assim o frontend sempre recebe uma estrutura previsível,
       * mesmo quando ainda não existem pedidos em determinado estado.
       */
      const pedidosPorStatus = {
        AGUARDANDO_ENTREGA: 0,
        EM_USO: 0,
        AGUARDANDO_RETIRADA: 0,
        FINALIZADO: 0,
      };

      for (const row of pedidosPorStatusResult) {
        pedidosPorStatus[row.status_aluguel] = row.count;
      }

      let pedidosAoLongoDoTempo;

      if (granularity === "weekly") {
        const resultadoSemanal = await sql`
          SELECT
            DATE_TRUNC('week', data_pedido)::date AS date,
            COUNT(*)::int AS count
          FROM alugueis
          WHERE data_pedido >=
                NOW() - INTERVAL '30 days'
          GROUP BY DATE_TRUNC('week', data_pedido)
          ORDER BY date ASC
        `;

        pedidosAoLongoDoTempo = resultadoSemanal.map(
          (row) => ({
            date: formatDate(row.date),
            count: row.count,
          }),
        );
      } else {
        const resultadoDiario = await sql`
          SELECT
            data_pedido::date AS date,
            COUNT(*)::int AS count
          FROM alugueis
          WHERE data_pedido >=
                NOW() - INTERVAL '30 days'
          GROUP BY data_pedido::date
          ORDER BY date ASC
        `;

        pedidosAoLongoDoTempo = resultadoDiario.map(
          (row) => ({
            date: formatDate(row.date),
            count: row.count,
          }),
        );
      }

      const dadosDashboard = {
        total_usuarios: totalUsuarios,
        total_pedidos: totalPedidos,
        receita_total: receitaTotal,
        lucro_plataforma: lucroPlataforma,
        cacambeiros_ativos: cacambeirosAtivos,
        pedidos_por_status: pedidosPorStatus,
        pedidos_ao_longo_do_tempo:
          pedidosAoLongoDoTempo,
        granularidade: granularity,
      };

      return sendSuccess(
        res,
        dadosDashboard,
        200,
        "Dashboard carregado com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao carregar dashboard administrativo:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar dados do dashboard.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = adminController;




// --------- Old Version ------------
/*const sql = require("../config/db");

const adminController = {
  // ============================================
  // CATEGORIAS CRUD
  // ============================================

  /**
   * GET /api/admin/categorias
   * Lista todas as categorias com contagem de caçambas associadas.
   * Retorna array de { id, nome, criado_em, cacambas_count } ordenado por nome ASC.
   *
  async listarCategorias(req, res) {
    try {
      const categorias = await sql`
        SELECT 
          c.id,
          c.nome,
          c.criado_em,
          COUNT(ca.id)::int AS cacambas_count
        FROM categorias c
        LEFT JOIN cacambas ca ON LOWER(ca.tipo_residuo) = LOWER(c.nome)
        GROUP BY c.id, c.nome, c.criado_em
        ORDER BY c.nome ASC
      `;

      return res.status(200).json(categorias);
    } catch (error) {
      console.error("Erro ao listar categorias:", error);
      return res.status(500).json({ error: "Erro interno ao listar categorias." });
    }
  },

  /**
   * POST /api/admin/categorias
   * Cria uma nova categoria.
   * Body: { nome }
   * Validações: não vazio, não apenas espaços, máximo 100 caracteres, único (case-insensitive).
   *
  async criarCategoria(req, res) {
    try {
      const { nome } = req.body;

      // Validação: campo obrigatório e não vazio
      if (!nome || typeof nome !== "string" || nome.trim().length === 0) {
        return res.status(400).json({ error: "O nome da categoria é obrigatório e não pode ser vazio." });
      }

      const nomeTrimmed = nome.trim();

      // Validação: máximo 100 caracteres
      if (nomeTrimmed.length > 100) {
        return res.status(400).json({ error: "O nome da categoria deve ter no máximo 100 caracteres." });
      }

      // Validação: unicidade case-insensitive
      const existente = await sql`
        SELECT id FROM categorias WHERE LOWER(nome) = LOWER(${nomeTrimmed})
      `;

      if (existente.length > 0) {
        return res.status(409).json({ error: "Já existe uma categoria com este nome." });
      }

      const resultado = await sql`
        INSERT INTO categorias (nome)
        VALUES (${nomeTrimmed})
        RETURNING id, nome, criado_em
      `;

      return res.status(201).json(resultado[0]);
    } catch (error) {
      console.error("Erro ao criar categoria:", error);
      return res.status(500).json({ error: "Erro interno ao criar categoria." });
    }
  },

  /**
   * PUT /api/admin/categorias/:id
   * Atualiza uma categoria existente.
   * Body: { nome }
   * Mesmas validações do POST.
   *
  async atualizarCategoria(req, res) {
    try {
      const { id } = req.params;
      const { nome } = req.body;

      // Validação: campo obrigatório e não vazio
      if (!nome || typeof nome !== "string" || nome.trim().length === 0) {
        return res.status(400).json({ error: "O nome da categoria é obrigatório e não pode ser vazio." });
      }

      const nomeTrimmed = nome.trim();

      // Validação: máximo 100 caracteres
      if (nomeTrimmed.length > 100) {
        return res.status(400).json({ error: "O nome da categoria deve ter no máximo 100 caracteres." });
      }

      // Verificar se a categoria existe
      const categoriaExistente = await sql`
        SELECT id FROM categorias WHERE id = ${id}
      `;

      if (categoriaExistente.length === 0) {
        return res.status(404).json({ error: "Categoria não encontrada." });
      }

      // Validação: unicidade case-insensitive (excluindo a própria categoria)
      const duplicada = await sql`
        SELECT id FROM categorias WHERE LOWER(nome) = LOWER(${nomeTrimmed}) AND id != ${id}
      `;

      if (duplicada.length > 0) {
        return res.status(409).json({ error: "Já existe uma categoria com este nome." });
      }

      const resultado = await sql`
        UPDATE categorias
        SET nome = ${nomeTrimmed}
        WHERE id = ${id}
        RETURNING id, nome, criado_em
      `;

      return res.status(200).json(resultado[0]);
    } catch (error) {
      console.error("Erro ao atualizar categoria:", error);
      return res.status(500).json({ error: "Erro interno ao atualizar categoria." });
    }
  },

  /**
   * DELETE /api/admin/categorias/:id
   * Remove uma categoria.
   * Impede remoção se houver caçambas associadas (via tipo_residuo).
   *
  async removerCategoria(req, res) {
    try {
      const { id } = req.params;

      // Verificar se a categoria existe
      const categoriaExistente = await sql`
        SELECT id, nome FROM categorias WHERE id = ${id}
      `;

      if (categoriaExistente.length === 0) {
        return res.status(404).json({ error: "Categoria não encontrada." });
      }

      const nomeCategoria = categoriaExistente[0].nome;

      // Verificar se há caçambas associadas
      const cacambasAssociadas = await sql`
        SELECT COUNT(*)::int AS total FROM cacambas WHERE LOWER(tipo_residuo) = LOWER(${nomeCategoria})
      `;

      const total = cacambasAssociadas[0].total;

      if (total > 0) {
        return res.status(400).json({
          error: `Não é possível remover esta categoria. Existem ${total} caçamba(s) associada(s).`
        });
      }

      await sql`
        DELETE FROM categorias WHERE id = ${id}
      `;

      return res.status(200).json({ message: "Categoria removida com sucesso." });
    } catch (error) {
      console.error("Erro ao remover categoria:", error);
      return res.status(500).json({ error: "Erro interno ao remover categoria." });
    }
  },

  // ============================================
  // DASHBOARD
  // ============================================

  /**
   * GET /api/admin/dashboard
   * Retorna métricas gerais do sistema para o painel administrativo.
   * Query: granularity ('daily' | 'weekly', default 'daily')
   *
  async dashboard(req, res) {
    try {
      const granularity = req.query.granularity || "daily";

      // 1. Total de usuários
      const totalUsersResult = await sql`
        SELECT COUNT(*)::int AS total FROM usuarios
      `;
      const total_users = totalUsersResult[0].total;

      // 2. Total de pedidos (alugueis)
      const totalOrdersResult = await sql`
        SELECT COUNT(*)::int AS total FROM alugueis
      `;
      const total_orders = totalOrdersResult[0].total;

      // 3. Receita total (soma de preco_final onde status_pagamento = 'PAGO')
      const totalRevenueResult = await sql`
        SELECT COALESCE(SUM(preco_final), 0)::numeric AS total
        FROM alugueis
        WHERE status_pagamento = 'PAGO'
      `;
      const total_revenue = Number(totalRevenueResult[0].total);
      
      // 3.1 Lucro da Plataforma (5% do total movimentado)
      const lucro_plataforma = total_revenue * 0.05;

      // 4. Caçambeiros ativos (com pelo menos uma caçamba disponível)
      const activeCacambeirosResult = await sql`
        SELECT COUNT(DISTINCT u.id)::int AS total
        FROM usuarios u
        JOIN cacambas c ON c.cacambeiro_id = u.id
        WHERE u.tipo_perfil = 'CACAMBEIRO'
          AND c.disponivel = TRUE
      `;
      const active_cacambeiros = activeCacambeirosResult[0].total;

      // 5. Pedidos por status
      const ordersByStatusResult = await sql`
        SELECT status_aluguel, COUNT(*)::int AS count
        FROM alugueis
        GROUP BY status_aluguel
      `;
      const orders_by_status = {};
      ordersByStatusResult.forEach(row => {
        orders_by_status[row.status_aluguel] = row.count;
      });

      // 6. Pedidos ao longo do tempo (últimos 30 dias)
      let orders_over_time;

      if (granularity === "weekly") {
        const weeklyResult = await sql`
          SELECT DATE_TRUNC('week', data_pedido)::date AS date,
                 COUNT(*)::int AS count
          FROM alugueis
          WHERE data_pedido >= NOW() - INTERVAL '30 days'
          GROUP BY DATE_TRUNC('week', data_pedido)
          ORDER BY date ASC
        `;
        orders_over_time = weeklyResult.map(row => ({
          date: row.date.toISOString().split("T")[0],
          count: row.count
        }));
      } else {
        const dailyResult = await sql`
          SELECT data_pedido::date AS date,
                 COUNT(*)::int AS count
          FROM alugueis
          WHERE data_pedido >= NOW() - INTERVAL '30 days'
          GROUP BY data_pedido::date
          ORDER BY date ASC
        `;
        orders_over_time = dailyResult.map(row => ({
          date: row.date.toISOString().split("T")[0],
          count: row.count
        }));
      }

      return res.status(200).json({
        total_usuarios: total_users,
        total_pedidos: total_orders,
        receita_total: total_revenue,
        lucro_plataforma,
        cacambeiros_ativos: active_cacambeiros,
        pedidos_por_status: orders_by_status,
        pedidos_ao_longo_do_tempo: orders_over_time
      });
    } catch (error) {
      console.error("Erro no dashboard admin:", error);
      return res.status(500).json({ error: "Erro interno ao buscar dados do dashboard." });
    }
  }
};

module.exports = adminController;
*/