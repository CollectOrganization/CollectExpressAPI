const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

const PLATFORM_FEE_RATE = 0.05;
const MAX_FINANCIAL_PERIOD_DAYS = 366;

/**
 * Converte um valor monetário em número com duas casas decimais.
 */
function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

/**
 * Converte uma data para o formato YYYY-MM-DD usando UTC.
 */
function formatDate(date) {
  return date.toISOString().split("T")[0];
}

/**
 * Cria uma data UTC e evita problemas com o fuso horário do servidor.
 */
function createUtcDate(year, month, day) {
  return new Date(Date.UTC(year, month, day));
}

/**
 * Converte YYYY-MM-DD em Date e valida datas inexistentes,
 * como 2026-02-31.
 */
function parseDateOnly(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return null;
  }

  const [year, month, day] = value
    .split("-")
    .map(Number);

  const date = createUtcDate(year, month - 1, day);

  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return isValid ? date : null;
}

/**
 * Resolve o período utilizado no relatório financeiro.
 *
 * Formatos aceitos:
 *
 * 1. Mês e ano:
 *    ?mes=10&ano=2025
 *
 * 2. Intervalo:
 *    ?data_inicio=2025-01-01&data_fim=2025-12-31
 *
 * 3. Sem parâmetros:
 *    utiliza o mês atual.
 */
function resolveFinancialPeriod(query) {
  const {
    mes,
    ano,
    data_inicio,
    data_fim,
  } = query;

  const hasMonthOrYear =
    mes !== undefined || ano !== undefined;

  const hasStartOrEnd =
    data_inicio !== undefined ||
    data_fim !== undefined;

  if (hasMonthOrYear && hasStartOrEnd) {
    return {
      error: {
        message:
          "Use apenas mês/ano ou data_inicio/data_fim.",
        fields: {
          periodo:
            "Os formatos de período não podem ser combinados.",
        },
      },
    };
  }

  if (hasMonthOrYear) {
    if (mes === undefined || ano === undefined) {
      return {
        error: {
          message: "Mês e ano devem ser informados juntos.",
          fields: {
            mes: "Informe o mês.",
            ano: "Informe o ano.",
          },
        },
      };
    }

    const parsedMonth = Number(mes);
    const parsedYear = Number(ano);

    if (
      !Number.isInteger(parsedMonth) ||
      parsedMonth < 1 ||
      parsedMonth > 12
    ) {
      return {
        error: {
          message: "Mês inválido.",
          fields: {
            mes: "O mês deve ser um inteiro entre 1 e 12.",
          },
        },
      };
    }

    if (
      !Number.isInteger(parsedYear) ||
      parsedYear < 2000 ||
      parsedYear > 2100
    ) {
      return {
        error: {
          message: "Ano inválido.",
          fields: {
            ano: "O ano deve estar entre 2000 e 2100.",
          },
        },
      };
    }

    return {
      startDate: createUtcDate(
        parsedYear,
        parsedMonth - 1,
        1,
      ),
      endDate: createUtcDate(
        parsedYear,
        parsedMonth,
        0,
      ),
    };
  }

  if (hasStartOrEnd) {
    if (
      data_inicio === undefined ||
      data_fim === undefined
    ) {
      return {
        error: {
          message:
            "As datas inicial e final devem ser informadas juntas.",
          fields: {
            data_inicio: "Informe a data inicial.",
            data_fim: "Informe a data final.",
          },
        },
      };
    }

    const startDate = parseDateOnly(data_inicio);
    const endDate = parseDateOnly(data_fim);

    if (!startDate || !endDate) {
      return {
        error: {
          message: "Datas inválidas.",
          fields: {
            data_inicio: "Formato esperado: YYYY-MM-DD.",
            data_fim: "Formato esperado: YYYY-MM-DD.",
          },
        },
      };
    }

    if (endDate < startDate) {
      return {
        error: {
          message:
            "A data final deve ser igual ou posterior à inicial.",
          fields: {
            data_fim:
              "A data final não pode ser anterior à inicial.",
          },
        },
      };
    }

    const differenceInDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) /
        (1000 * 60 * 60 * 24),
    );

    if (
      differenceInDays >
      MAX_FINANCIAL_PERIOD_DAYS
    ) {
      return {
        error: {
          message:
            "O intervalo máximo permitido é de 12 meses.",
          fields: {
            data_inicio:
              "O intervalo excede o limite permitido.",
            data_fim:
              "O intervalo excede o limite permitido.",
          },
        },
      };
    }

    return {
      startDate,
      endDate,
    };
  }

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  return {
    startDate: createUtcDate(
      currentYear,
      currentMonth,
      1,
    ),
    endDate: createUtcDate(
      currentYear,
      currentMonth + 1,
      0,
    ),
  };
}

const cacambeirosController = {
  /**
   * GET /api/cacambeiros/dashboard
   *
   * Retorna as métricas do fornecedor autenticado.
   * A rota deve exigir o perfil CACAMBEIRO.
   */
  async dashboard(req, res) {
    try {
      const cacambeiroId = req.usuario_id;

      /*
       * As métricas de pedidos são calculadas diretamente pelo banco.
       * Somente pagamentos PAGO entram no faturamento.
       */
      const [orderStats] = await sql`
        SELECT
          COUNT(*)::int AS total_orders,

          COUNT(*) FILTER (
            WHERE status_aluguel IN (
              'AGUARDANDO_ENTREGA',
              'EM_USO',
              'AGUARDANDO_RETIRADA'
            )
          )::int AS active_orders,

          COALESCE(
            SUM(preco_final) FILTER (
              WHERE status_pagamento = 'PAGO'
            ),
            0
          )::float AS total_revenue
        FROM alugueis
        WHERE cacambeiro_id = ${cacambeiroId}
      `;

      const [reviewStats] = await sql`
        SELECT
          ROUND(
            AVG(nota)::numeric,
            1
          )::float AS nota_media,

          COUNT(*)::int AS total_avaliacoes
        FROM avaliacoes
        WHERE cacambeiro_id = ${cacambeiroId}
      `;

      const grossRevenue = roundMoney(
        orderStats.total_revenue,
      );

      const platformFee = roundMoney(
        grossRevenue * PLATFORM_FEE_RATE,
      );

      const netRevenue = roundMoney(
        grossRevenue - platformFee,
      );

      return sendSuccess(
        res,
        {
          total_orders: orderStats.total_orders,
          active_orders: orderStats.active_orders,
          total_revenue_bruto: grossRevenue,
          taxa_plataforma: platformFee,

          /*
           * Mantido como total_revenue para preservar o contrato
           * esperado pelo frontend atual.
           */
          total_revenue: netRevenue,

          nota_media:
            reviewStats.nota_media ?? null,

          total_avaliacoes:
            reviewStats.total_avaliacoes,
        },
        200,
        "Dashboard carregado com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao buscar dashboard do caçambeiro:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar dados do dashboard.",
        "SUPPLIER_DASHBOARD_ERROR",
      );
    }
  },

  /**
   * GET /api/cacambeiros/financeiro
   *
   * Retorna pedidos finalizados e pagos do fornecedor
   * autenticado em determinado período.
   *
   * Exemplos:
   *
   * /financeiro?mes=10&ano=2025
   *
   * /financeiro?data_inicio=2025-01-01&data_fim=2025-12-31
   */
  async financeiro(req, res) {
    try {
      const cacambeiroId = req.usuario_id;
      const period = resolveFinancialPeriod(req.query);

      if (period.error) {
        return sendError(
          res,
          400,
          period.error.message,
          "INVALID_FINANCIAL_PERIOD",
          period.error.fields,
        );
      }

      const startDate = formatDate(
        period.startDate,
      );

      const endDate = formatDate(
        period.endDate,
      );

      /*
       * A comparação final usa:
       *
       * data_pedido < data_fim + 1 dia
       *
       * Isso inclui todo o último dia, e não apenas 00:00.
       */
      const orders = await sql`
        SELECT
          id,
          consumidor_id,
          cacambeiro_id,
          endereco_id,
          data_pedido,
          data_inicio,
          dias_aluguel,
          preco_final,
          status_pagamento,
          status_aluguel
        FROM alugueis
        WHERE cacambeiro_id = ${cacambeiroId}
          AND status_aluguel = 'FINALIZADO'
          AND status_pagamento = 'PAGO'
          AND data_pedido >= ${startDate}::date
          AND data_pedido <
            (${endDate}::date + INTERVAL '1 day')
        ORDER BY data_pedido DESC
      `;

      const formattedOrders = orders.map(
        (order) => {
          const grossValue = roundMoney(
            order.preco_final,
          );

          const platformFee = roundMoney(
            grossValue * PLATFORM_FEE_RATE,
          );

          const netValue = roundMoney(
            grossValue - platformFee,
          );

          return {
            ...order,
            preco_final: grossValue,
            valor_bruto: grossValue,
            taxa_plataforma: platformFee,
            valor_liquido: netValue,
          };
        },
      );

      const grossRevenue = roundMoney(
        formattedOrders.reduce(
          (total, order) =>
            total + order.valor_bruto,
          0,
        ),
      );

      const platformFee = roundMoney(
        formattedOrders.reduce(
          (total, order) =>
            total + order.taxa_plataforma,
          0,
        ),
      );

      const netRevenue = roundMoney(
        grossRevenue - platformFee,
      );

      return sendSuccess(
        res,
        {
          periodo: {
            data_inicio: startDate,
            data_fim: endDate,
          },
          resumo_mensal: {
            total: grossRevenue,
            taxa_plataforma: platformFee,
            total_liquido: netRevenue,
            quantidade: formattedOrders.length,
          },
          pedidos: formattedOrders,
        },
        200,
        "Dados financeiros carregados com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao buscar financeiro do caçambeiro:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar dados financeiros.",
        "SUPPLIER_FINANCIAL_ERROR",
      );
    }
  },

  /**
   * GET /api/cacambeiros
   *
   * Lista fornecedores ativos para exibição pública.
   *
   * O e-mail não é retornado para evitar exposição
   * desnecessária de dados pessoais.
   */
  async listar(req, res) {
    try {
      const cacambeiros = await sql`
        SELECT
          u.id,
          u.nome_completo,
          u.telefone,
          d.horario_inicio,
          d.horario_fim,
          d.raio_entrega_km,
          d.taxa_entrega,

          ROUND(
            AVG(av.nota)::numeric,
            1
          )::float AS nota_media,

          COUNT(
            DISTINCT av.id
          )::int AS total_avaliacoes,

          COUNT(
            DISTINCT c.id
          ) FILTER (
            WHERE c.disponivel = TRUE
          )::int AS cacambas_disponiveis

        FROM usuarios u

        INNER JOIN detalhes_cacambeiro d
          ON d.usuario_id = u.id

        LEFT JOIN avaliacoes av
          ON av.cacambeiro_id = u.id

        LEFT JOIN cacambas c
          ON c.cacambeiro_id = u.id

        WHERE u.tipo_perfil = 'CACAMBEIRO'
          AND u.status = 'ATIVO'

        GROUP BY
          u.id,
          u.nome_completo,
          u.telefone,
          d.horario_inicio,
          d.horario_fim,
          d.raio_entrega_km,
          d.taxa_entrega

        ORDER BY
          nota_media DESC NULLS LAST,
          u.nome_completo ASC
      `;

      return sendSuccess(
        res,
        cacambeiros,
        200,
        "Fornecedores carregados com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao listar caçambeiros:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar fornecedores.",
        "SUPPLIER_LIST_ERROR",
      );
    }
  },

  /**
   * GET /api/cacambeiros/:id
   *
   * Retorna o perfil público de um fornecedor ativo,
   * seu catálogo disponível e seu resumo de avaliações.
   */
  async buscarPorId(req, res) {
    try {
      const { id } = req.params;

      const profiles = await sql`
        SELECT
          u.id,
          u.nome_completo,
          u.telefone,
          d.horario_inicio,
          d.horario_fim,
          d.raio_entrega_km,
          d.taxa_entrega,

          ROUND(
            AVG(av.nota)::numeric,
            1
          )::float AS nota_media,

          COUNT(
            av.id
          )::int AS total_avaliacoes

        FROM usuarios u

        INNER JOIN detalhes_cacambeiro d
          ON d.usuario_id = u.id

        LEFT JOIN avaliacoes av
          ON av.cacambeiro_id = u.id

        WHERE u.id = ${id}
          AND u.tipo_perfil = 'CACAMBEIRO'
          AND u.status = 'ATIVO'

        GROUP BY
          u.id,
          u.nome_completo,
          u.telefone,
          d.horario_inicio,
          d.horario_fim,
          d.raio_entrega_km,
          d.taxa_entrega
      `;

      if (profiles.length === 0) {
        return sendError(
          res,
          404,
          "Fornecedor não encontrado.",
          "SUPPLIER_NOT_FOUND",
        );
      }

      const dumpsters = await sql`
        SELECT
          id,
          nome,
          tipo_residuo,
          tamanho_m3,
          preco_diaria,
          foto_url,
          disponivel,
          criado_em
        FROM cacambas
        WHERE cacambeiro_id = ${id}
          AND disponivel = TRUE
        ORDER BY criado_em DESC
      `;

      const catalog = dumpsters.map(
        (dumpster) => ({
          ...dumpster,
          tamanho_m3: Number(
            dumpster.tamanho_m3,
          ),
          preco_diaria: roundMoney(
            dumpster.preco_diaria,
          ),
        }),
      );

      return sendSuccess(
        res,
        {
          perfil: profiles[0],
          catalogo: catalog,
        },
        200,
        "Fornecedor carregado com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao buscar detalhes do caçambeiro:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar os detalhes do fornecedor.",
        "SUPPLIER_DETAILS_ERROR",
      );
    }
  },
};

module.exports = cacambeirosController;



// ----------- Old Version ----------
/*const sql = require("../config/db");

const cacambeirosController = {
  // Dashboard do caçambeiro autenticado
  async dashboard(req, res) {
    try {
      const cacambeiroId = req.usuario_id;

      const [orderStats] = await sql`
        SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (WHERE status_aluguel IN ('AGUARDANDO_ENTREGA', 'EM_USO', 'AGUARDANDO_RETIRADA'))::int AS active_orders,
          COALESCE(SUM(preco_final) FILTER (WHERE status_pagamento = 'PAGO'), 0)::float AS total_revenue
        FROM alugueis
        WHERE cacambeiro_id = ${cacambeiroId}
      `;

      const [reviewStats] = await sql`
        SELECT ROUND(AVG(nota)::numeric, 1)::float AS nota_media
        FROM avaliacoes
        WHERE cacambeiro_id = ${cacambeiroId}
      `;

      const totalRevenueBruto = orderStats.total_revenue;
      const totalRevenueLiquido = totalRevenueBruto * 0.95;

      return res.status(200).json({
        total_orders: orderStats.total_orders,
        active_orders: orderStats.active_orders,
        total_revenue_bruto: totalRevenueBruto,
        total_revenue: totalRevenueLiquido, // Keep original property to avoid breaking existing frontend logic where possible
        nota_media: reviewStats.nota_media ?? null
      });
    } catch (error) {
      console.error("Erro ao buscar dashboard do caçambeiro:", error);
      return res.status(500).json({ error: "Erro interno ao buscar dados do dashboard." });
    }
  },

  // Financeiro do caçambeiro autenticado (pedidos finalizados e pagos)
  async financeiro(req, res) {
    try {
      const cacambeiroId = req.usuario_id;

      let dataInicio;
      let dataFim;

      if (req.query.mes && req.query.ano) {
        // Frontend sends mes (1-12) and ano
        const mes = parseInt(req.query.mes);
        const ano = parseInt(req.query.ano);
        dataInicio = new Date(ano, mes - 1, 1);
        dataFim = new Date(ano, mes, 0); // last day of month
      } else if (req.query.data_inicio && req.query.data_fim) {
        dataInicio = new Date(req.query.data_inicio);
        dataFim = new Date(req.query.data_fim);

        if (isNaN(dataInicio.getTime()) || isNaN(dataFim.getTime())) {
          return res.status(400).json({
            error: "Datas inválidas.",
            fields: { data_inicio: "Formato esperado: YYYY-MM-DD", data_fim: "Formato esperado: YYYY-MM-DD" }
          });
        }

        // Validar intervalo máximo de 12 meses
        const diffMs = dataFim.getTime() - dataInicio.getTime();
        const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 365.25 / 12);
        if (diffMonths > 12) {
          return res.status(400).json({
            error: "O intervalo máximo permitido é de 12 meses.",
            fields: { data_inicio: "Intervalo excede 12 meses", data_fim: "Intervalo excede 12 meses" }
          });
        }
      } else {
        // Default: mês atual (primeiro dia até último dia)
        const now = new Date();
        dataInicio = new Date(now.getFullYear(), now.getMonth(), 1);
        dataFim = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      }

      const dataInicioStr = dataInicio.toISOString().split("T")[0];
      const dataFimStr = dataFim.toISOString().split("T")[0];

      const orders = await sql`
        SELECT *
        FROM alugueis
        WHERE cacambeiro_id = ${cacambeiroId}
          AND status_aluguel = 'FINALIZADO'
          AND status_pagamento = 'PAGO'
          AND data_pedido >= ${dataInicioStr}::date
          AND data_pedido <= ${dataFimStr}::date
        ORDER BY data_pedido DESC
      `;

      const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.preco_final) || 0), 0);
      const taxaPlataforma = totalRevenue * 0.05;
      const totalLiquido = totalRevenue * 0.95;

      const pedidosComTaxa = orders.map(order => {
        const valorBruto = Number(order.preco_final) || 0;
        return {
          ...order,
          valor_bruto: valorBruto,
          taxa_plataforma: valorBruto * 0.05,
          valor_liquido: valorBruto * 0.95,
        };
      });

      return res.status(200).json({
        resumo_mensal: {
          total: totalRevenue,
          taxa_plataforma: taxaPlataforma,
          total_liquido: totalLiquido,
          quantidade: orders.length
        },
        pedidos: pedidosComTaxa
      });
    } catch (error) {
      console.error("Erro ao buscar financeiro do caçambeiro:", error);
      return res.status(500).json({ error: "Erro interno ao buscar dados financeiros." });
    }
  },

  // Listar todos os caçambeiros e seus detalhes (Visão do Consumidor)
  async listar(req, res) {
    try {
      // Fazemos um JOIN entre a tabela base de usuários e a extensão de detalhes
      const cacambeiros = await sql`
        SELECT 
          u.id, u.nome_completo, u.email, u.telefone,
          d.horario_inicio, d.horario_fim, d.raio_entrega_km, d.nota_media, d.taxa_entrega
        FROM usuarios u
        INNER JOIN detalhes_cacambeiro d ON u.id = d.usuario_id
        WHERE u.tipo_perfil = 'CACAMBEIRO'
      `;

      return res.status(200).json(cacambeiros);
    } catch (error) {
      console.error("Erro ao listar caçambeiros:", error);
      return res.status(500).json({ error: "Erro interno ao buscar empresas." });
    }
  },

  // Ver perfil de um caçambeiro específico e suas caçambas disponíveis
  async buscarPorId(req, res) {
    try {
      const { id } = req.params;

      const cacambeiroInfo = await sql`
        SELECT 
          u.id, u.nome_completo, u.telefone,
          d.horario_inicio, d.horario_fim, d.raio_entrega_km, d.nota_media, d.taxa_entrega
        FROM usuarios u
        INNER JOIN detalhes_cacambeiro d ON u.id = d.usuario_id
        WHERE u.id = ${id} AND u.tipo_perfil = 'CACAMBEIRO'
      `;

      if (cacambeiroInfo.length === 0) {
        return res.status(404).json({ error: "Caçambeiro não encontrado." });
      }

      // Busca o catálogo daquele caçambeiro
      const cacambas = await sql`
        SELECT id, nome, tipo_residuo, tamanho_m3, preco_diaria, foto_url 
        FROM cacambas 
        WHERE cacambeiro_id = ${id} AND disponivel = true
      `;

      return res.status(200).json({
        perfil: cacambeiroInfo[0],
        catalogo: cacambas
      });

    } catch (error) {
      console.error("Erro ao buscar detalhes do caçambeiro:", error);
      return res.status(500).json({ error: "Erro interno ao buscar os detalhes da empresa." });
    }
  }
};

module.exports = cacambeirosController;
*/