const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

const ITEMS_PER_PAGE = 20;

const RENTAL_STATUSES = [
  "AGUARDANDO_ENTREGA",
  "EM_USO",
  "AGUARDANDO_RETIRADA",
  "FINALIZADO",
];

const PAYMENT_STATUSES = [
  "PENDENTE",
  "PAGO",
];

/**
 * Converte o parâmetro de página em um número válido.
 */
function parsePage(value) {
  return Math.max(1, Number.parseInt(value, 10) || 1);
}

/**
 * Verifica rigorosamente uma data no formato YYYY-MM-DD.
 *
 * Evita datas que o JavaScript normalizaria silenciosamente,
 * como 2026-02-31.
 */
function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value
    .split("-")
    .map(Number);

  const date = new Date(
    year,
    month - 1,
    day,
  );

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

const alugueisController = {
  /**
   * POST /api/alugueis/checkout
   *
   * Finaliza o carrinho de forma atômica:
   *
   * 1. valida a data;
   * 2. valida se o endereço pertence ao consumidor;
   * 3. bloqueia o carrinho durante o checkout;
   * 4. valida disponibilidade e fornecedor das caçambas;
   * 5. cria o aluguel;
   * 6. cria os itens do aluguel;
   * 7. remove o carrinho.
   *
   * Todas as alterações são executadas em uma única instrução SQL.
   * Se qualquer etapa falhar, o PostgreSQL desfaz toda a operação.
   */
  async checkout(req, res) {
    try {
      const consumidorId = req.usuario_id;
      const {
        endereco_id: enderecoId,
        data_inicio: dataInicioString,
      } = req.body;

      /*
       * Os campos já são validados pelo validationMiddleware,
       * mas a data também precisa passar pela regra de negócio.
       */
      if (!isValidDate(dataInicioString)) {
        return sendError(
          res,
          400,
          "Data de início inválida.",
          "INVALID_START_DATE",
        );
      }

      const [year, month, day] = dataInicioString
        .split("-")
        .map(Number);

      const dataInicio = new Date(
        year,
        month - 1,
        day,
      );

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const diferencaDias = Math.round(
        (dataInicio.getTime() - hoje.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (
        diferencaDias < 1 ||
        diferencaDias > 60
      ) {
        return sendError(
          res,
          400,
          "A data de início deve estar entre 1 e 60 dias a partir de hoje.",
          "INVALID_START_DATE",
        );
      }

      /*
       * Verifica ownership do endereço.
       *
       * Um consumidor não pode usar o endereço de outro usuário
       * durante o checkout.
       */
      const enderecos = await sql`
        SELECT id
        FROM enderecos
        WHERE id = ${enderecoId}
          AND usuario_id = ${consumidorId}
        LIMIT 1
      `;

      if (enderecos.length === 0) {
        return sendError(
          res,
          404,
          "Endereço não encontrado.",
          "ADDRESS_NOT_FOUND",
        );
      }

      /*
       * Verificação inicial para retornar uma mensagem específica
       * quando não existe carrinho.
       *
       * A consulta atômica abaixo fará a mesma proteção novamente,
       * incluindo bloqueio contra checkouts concorrentes.
       */
      const carrinhos = await sql`
        SELECT id
        FROM carrinho
        WHERE consumidor_id = ${consumidorId}
        LIMIT 1
      `;

      if (carrinhos.length === 0) {
        return sendError(
          res,
          400,
          "O carrinho está vazio.",
          "EMPTY_CART",
        );
      }

      /*
       * Checkout atômico.
       *
       * O carrinho é bloqueado com FOR UPDATE. Isso impede que
       * duas requisições concorrentes criem dois pedidos usando
       * o mesmo carrinho.
       */
      const pedidos = await sql`
        WITH carrinho_bloqueado AS (
          SELECT
            c.id,
            c.cacambeiro_id
          FROM carrinho c
          WHERE c.consumidor_id = ${consumidorId}
          FOR UPDATE
        ),

        itens_carrinho_validacao AS (
          SELECT
            ic.cacamba_id,
            ic.quantidade,
            ic.dias_aluguel,
            ca.preco_diaria,
            ca.disponivel,
            ca.cacambeiro_id,
            cb.cacambeiro_id AS fornecedor_carrinho
          FROM carrinho_bloqueado cb
          INNER JOIN itens_carrinho ic
            ON ic.carrinho_id = cb.id
          INNER JOIN cacambas ca
            ON ca.id = ic.cacamba_id
        ),

        resumo AS (
          SELECT
            COUNT(*)::int AS quantidade_itens,

            COALESCE(
              SUM(
                quantidade *
                dias_aluguel *
                preco_diaria
              ),
              0
            )::numeric AS total_itens,

            MAX(dias_aluguel)::int AS max_dias,

            COUNT(*) FILTER (
              WHERE disponivel = FALSE
                 OR cacambeiro_id <> fornecedor_carrinho
            )::int AS itens_invalidos
          FROM itens_carrinho_validacao
        ),

        novo_pedido AS (
          INSERT INTO alugueis (
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
          )
          SELECT
            gen_random_uuid(),
            ${consumidorId},
            cb.cacambeiro_id,
            ${enderecoId},
            NOW(),
            ${dataInicioString}::date,
            resumo.max_dias,

            resumo.total_itens +
            COALESCE(
              (
                SELECT dc.taxa_entrega
                FROM detalhes_cacambeiro dc
                WHERE dc.usuario_id = cb.cacambeiro_id
              ),
              0
            ),

            'PENDENTE',
            'AGUARDANDO_ENTREGA'
          FROM resumo
          CROSS JOIN carrinho_bloqueado cb
          WHERE resumo.quantidade_itens > 0
            AND resumo.itens_invalidos = 0
          RETURNING *
        ),

        novos_itens AS (
          INSERT INTO itens_aluguel (
            id,
            aluguel_id,
            cacamba_id,
            quantidade,
            dias_aluguel,
            preco_diaria
          )
          SELECT
            gen_random_uuid(),
            np.id,
            icv.cacamba_id,
            icv.quantidade,
            icv.dias_aluguel,
            icv.preco_diaria
          FROM itens_carrinho_validacao icv
          CROSS JOIN novo_pedido np
          RETURNING id
        ),

        carrinho_removido AS (
          DELETE FROM carrinho c
          USING carrinho_bloqueado cb
          WHERE c.id = cb.id

            /*
             * O carrinho só é removido se o pedido foi criado.
             */
            AND EXISTS (
              SELECT 1
              FROM novo_pedido
            )

            /*
             * Também confirma que todos os itens foram copiados
             * para itens_aluguel.
             */
            AND (
              SELECT COUNT(*)::int
              FROM novos_itens
            ) = (
              SELECT quantidade_itens
              FROM resumo
            )

          /*
           * Os itens do carrinho são removidos automaticamente
           * pela constraint ON DELETE CASCADE.
           */
          RETURNING c.id
        )

        SELECT np.*
        FROM novo_pedido np
        WHERE EXISTS (
          SELECT 1
          FROM carrinho_removido
        )
      `;

      /*
       * A ausência de resultado indica que:
       *
       * - o carrinho estava vazio;
       * - uma caçamba ficou indisponível;
       * - uma caçamba pertence a outro fornecedor;
       * - outro checkout processou o carrinho primeiro.
       */
      if (pedidos.length === 0) {
        return sendError(
          res,
          400,
          "Não foi possível concluir o pedido. Verifique a disponibilidade e os itens do carrinho.",
          "CHECKOUT_FAILED",
        );
      }

      return sendSuccess(
        res,
        pedidos[0],
        201,
        "Pedido criado com sucesso.",
      );
    } catch (error) {
      console.error("Erro no checkout:", error);

      return sendError(
        res,
        500,
        "Erro interno ao processar o pedido.",
        "CHECKOUT_INTERNAL_ERROR",
      );
    }
  },

  /**
   * GET /api/alugueis/meus
   *
   * Retorna o histórico paginado de pedidos do consumidor
   * autenticado.
   *
   * Query:
   * - page: página atual, começando em 1.
   */
  async meusPedidos(req, res) {
    try {
      const consumidorId = req.usuario_id;
      const page = parsePage(req.query.page);
      const offset = (page - 1) * ITEMS_PER_PAGE;

      const countResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM alugueis
        WHERE consumidor_id = ${consumidorId}
      `;

      const total = countResult[0].total;
      const totalPages = Math.ceil(
        total / ITEMS_PER_PAGE,
      );

      const pedidos = await sql`
        SELECT
          a.*,
          u.nome_completo AS cacambeiro_nome
        FROM alugueis a
        INNER JOIN usuarios u
          ON u.id = a.cacambeiro_id
        WHERE a.consumidor_id = ${consumidorId}
        ORDER BY a.data_pedido DESC
        LIMIT ${ITEMS_PER_PAGE}
        OFFSET ${offset}
      `;

      return sendSuccess(
        res,
        {
          items: pedidos,
          pagination: {
            total,
            page,
            per_page: ITEMS_PER_PAGE,
            total_pages: totalPages,
          },
        },
        200,
        "Pedidos encontrados com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao buscar pedidos do consumidor:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar pedidos.",
        "ORDERS_FETCH_ERROR",
      );
    }
  },

  /**
   * GET /api/alugueis/gestao
   *
   * Retorna os pedidos associados ao fornecedor autenticado.
   */
  async gestaoPedidos(req, res) {
    try {
      const cacambeiroId = req.usuario_id;

      const pedidos = await sql`
        SELECT
          a.*,
          u.nome_completo AS consumidor_nome,
          u.telefone AS consumidor_telefone,
          e.logradouro,
          e.numero,
          e.bairro,
          e.cidade_estado,
          e.cep
        FROM alugueis a
        INNER JOIN usuarios u
          ON u.id = a.consumidor_id
        LEFT JOIN enderecos e
          ON e.id = a.endereco_id
        WHERE a.cacambeiro_id = ${cacambeiroId}
        ORDER BY
          CASE
            WHEN a.status_aluguel = 'AGUARDANDO_ENTREGA' THEN 1
            WHEN a.status_aluguel = 'EM_USO' THEN 2
            WHEN a.status_aluguel = 'AGUARDANDO_RETIRADA' THEN 3
            WHEN a.status_aluguel = 'FINALIZADO' THEN 4
          END,
          a.data_inicio ASC
      `;

      return sendSuccess(
        res,
        pedidos,
        200,
        "Pedidos de gestão encontrados com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao buscar gestão de pedidos:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar a gestão de pedidos.",
        "SUPPLIER_ORDERS_FETCH_ERROR",
      );
    }
  },

  /**
   * GET /api/alugueis
   *
   * Lista administrativa de pedidos.
   *
   * Query:
   * - page;
   * - status_aluguel;
   * - status_pagamento;
   * - search.
   */
  async listarTodos(req, res) {
    try {
      const page = parsePage(req.query.page);
      const offset = (page - 1) * ITEMS_PER_PAGE;

      const statusAluguel =
        req.query.status_aluguel || null;

      const statusPagamento =
        req.query.status_pagamento || null;

      const search =
        req.query.search?.trim() || null;

      /*
       * As validações no controller são mantidas como proteção
       * complementar às validações das rotas.
       */
      if (
        statusAluguel &&
        !RENTAL_STATUSES.includes(statusAluguel)
      ) {
        return sendError(
          res,
          400,
          "Status de aluguel inválido.",
          "INVALID_RENTAL_STATUS",
          {
            status_aluguel:
              "Informe um status de aluguel válido.",
          },
        );
      }

      if (
        statusPagamento &&
        !PAYMENT_STATUSES.includes(statusPagamento)
      ) {
        return sendError(
          res,
          400,
          "Status de pagamento inválido.",
          "INVALID_PAYMENT_STATUS",
          {
            status_pagamento:
              "Informe um status de pagamento válido.",
          },
        );
      }

      if (search && search.length > 150) {
        return sendError(
          res,
          400,
          "O termo de busca é muito longo.",
          "INVALID_SEARCH",
          {
            search:
              "A busca deve possuir no máximo 150 caracteres.",
          },
        );
      }

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      const searchIsUuid =
        search !== null && uuidRegex.test(search);

      const searchPattern = search
        ? `%${search}%`
        : null;

      /*
       * A consulta usa filtros opcionais sem interpolar comandos
       * SQL manualmente. Os valores continuam parametrizados pelo
       * driver Neon.
       */
      const countResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM alugueis a
        INNER JOIN usuarios uc
          ON uc.id = a.consumidor_id
        INNER JOIN usuarios uk
          ON uk.id = a.cacambeiro_id
        WHERE (
          ${statusAluguel}::text IS NULL
          OR a.status_aluguel::text = ${statusAluguel}
        )
        AND (
          ${statusPagamento}::text IS NULL
          OR a.status_pagamento::text = ${statusPagamento}
        )
        AND (
          ${search}::text IS NULL

          OR (
            ${searchIsUuid} = TRUE
            AND a.id::text = ${search}
          )

          OR (
            ${searchIsUuid} = FALSE
            AND (
              uc.nome_completo ILIKE ${searchPattern}
              OR uk.nome_completo ILIKE ${searchPattern}
            )
          )
        )
      `;

      const total = countResult[0].total;
      const totalPages = Math.ceil(
        total / ITEMS_PER_PAGE,
      );

      const pedidos = await sql`
        SELECT
          a.*,
          uc.nome_completo AS consumidor_nome,
          uk.nome_completo AS cacambeiro_nome,
          e.logradouro,
          e.numero,
          e.bairro,
          e.cidade_estado,
          e.cep
        FROM alugueis a
        INNER JOIN usuarios uc
          ON uc.id = a.consumidor_id
        INNER JOIN usuarios uk
          ON uk.id = a.cacambeiro_id
        LEFT JOIN enderecos e
          ON e.id = a.endereco_id
        WHERE (
          ${statusAluguel}::text IS NULL
          OR a.status_aluguel::text = ${statusAluguel}
        )
        AND (
          ${statusPagamento}::text IS NULL
          OR a.status_pagamento::text = ${statusPagamento}
        )
        AND (
          ${search}::text IS NULL

          OR (
            ${searchIsUuid} = TRUE
            AND a.id::text = ${search}
          )

          OR (
            ${searchIsUuid} = FALSE
            AND (
              uc.nome_completo ILIKE ${searchPattern}
              OR uk.nome_completo ILIKE ${searchPattern}
            )
          )
        )
        ORDER BY a.data_pedido DESC
        LIMIT ${ITEMS_PER_PAGE}
        OFFSET ${offset}
      `;

      return sendSuccess(
        res,
        {
          items: pedidos,
          pagination: {
            total,
            page,
            per_page: ITEMS_PER_PAGE,
            total_pages: totalPages,
          },
        },
        200,
        "Pedidos encontrados com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao listar todos os pedidos:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar pedidos.",
        "ADMIN_ORDERS_FETCH_ERROR",
      );
    }
  },

  /**
   * PATCH /api/alugueis/:id/status
   *
   * Atualiza o status do pedido respeitando a máquina
   * de estados sequencial:
   *
   * AGUARDANDO_ENTREGA
   *          ↓
   * EM_USO
   *          ↓
   * AGUARDANDO_RETIRADA
   *          ↓
   * FINALIZADO
   */
  async atualizarStatus(req, res) {
    try {
      const cacambeiroId = req.usuario_id;
      const { id } = req.params;
      const {
        status_aluguel: novoStatus,
      } = req.body;

      /*
       * Cada novo status possui exatamente um estado anterior
       * permitido.
       */
      const previousStatusByNextStatus = {
        EM_USO: "AGUARDANDO_ENTREGA",
        AGUARDANDO_RETIRADA: "EM_USO",
        FINALIZADO: "AGUARDANDO_RETIRADA",
      };

      const statusAnterior =
        previousStatusByNextStatus[novoStatus];

      if (!statusAnterior) {
        return sendError(
          res,
          400,
          "Status de aluguel inválido.",
          "INVALID_RENTAL_STATUS",
        );
      }

      /*
       * A condição do status é aplicada diretamente no UPDATE.
       *
       * Isso impede que duas requisições concorrentes atualizem
       * o mesmo pedido partindo de um estado desatualizado.
       */
      const resultado = await sql`
        UPDATE alugueis
        SET status_aluguel = ${novoStatus}
        WHERE id = ${id}
          AND cacambeiro_id = ${cacambeiroId}
          AND status_aluguel = ${statusAnterior}
        RETURNING *
      `;

      if (resultado.length > 0) {
        return sendSuccess(
          res,
          resultado[0],
          200,
          "Status atualizado com sucesso.",
        );
      }

      /*
       * Como o UPDATE não retornou registro, consultamos o pedido
       * para diferenciar "não encontrado" de "transição inválida".
       */
      const pedidos = await sql`
        SELECT id, status_aluguel
        FROM alugueis
        WHERE id = ${id}
          AND cacambeiro_id = ${cacambeiroId}
        LIMIT 1
      `;

      if (pedidos.length === 0) {
        return sendError(
          res,
          404,
          "Pedido não encontrado ou não pertence a você.",
          "ORDER_NOT_FOUND",
        );
      }

      if (
        pedidos[0].status_aluguel === "FINALIZADO"
      ) {
        return sendError(
          res,
          409,
          "O pedido já está finalizado.",
          "ORDER_ALREADY_FINISHED",
        );
      }

      return sendError(
        res,
        409,
        `Transição inválida. O pedido está em '${pedidos[0].status_aluguel}' e não pode avançar diretamente para '${novoStatus}'.`,
        "INVALID_STATUS_TRANSITION",
      );
    } catch (error) {
      console.error(
        "Erro ao atualizar status do pedido:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao atualizar o status do pedido.",
        "ORDER_STATUS_UPDATE_ERROR",
      );
    }
  },
};

module.exports = alugueisController;


// --------------- Old Version ---------------
/*const sql = require("../config/db");

const alugueisController = {
  /**
 * POST /api/alugueis/checkout
 *
 * Finaliza o carrinho de forma atômica:
 * - valida endereço;
 * - valida carrinho;
 * - valida disponibilidade e fornecedor;
 * - cria pedido;
 * - cria itens;
 * - remove carrinho.
 *
 * Se qualquer operação falhar, nenhuma alteração é persistida.
 *
  async checkout(req, res) {
    try {
      const consumidorId = req.usuario_id;
      const { endereco_id, data_inicio } = req.body;

      // 1. Validação complementar dos campos.
      if (!endereco_id || !data_inicio) {
        return res.status(400).json({
          success: false,
          message: "Endereço e data de início são obrigatórios.",
          code: "REQUIRED_FIELDS",
        });
      }

      // Evita que datas inválidas, como 2026-99-99, sejam aceitas.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data_inicio)) {
        return res.status(400).json({
          success: false,
          message: "A data deve usar o formato YYYY-MM-DD.",
          code: "INVALID_START_DATE",
        });
      }

      // A inclusão de T00:00:00 evita conversões indesejadas de fuso.
      const dataInicio = new Date(`${data_inicio}T00:00:00`);

      if (Number.isNaN(dataInicio.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Data de início inválida.",
          code: "INVALID_START_DATE",
        });
      }

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);

      const diferencaDias = Math.round(
        (dataInicio.getTime() - hoje.getTime()) /
          (1000 * 60 * 60 * 24),
      );

      if (diferencaDias < 1 || diferencaDias > 60) {
        return res.status(400).json({
          success: false,
          message:
            "A data de início deve estar entre 1 e 60 dias a partir de hoje.",
          code: "INVALID_START_DATE",
        });
      }

      // 2. Verifica se o endereço pertence ao consumidor autenticado.
      const enderecos = await sql`
        SELECT id
        FROM enderecos
        WHERE id = ${endereco_id}
          AND usuario_id = ${consumidorId}
      `;

      if (enderecos.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Endereço não encontrado.",
          code: "ADDRESS_NOT_FOUND",
        });
      }

      // 3. Localiza o carrinho do consumidor.
      const carrinhos = await sql`
        SELECT id, cacambeiro_id
        FROM carrinho
        WHERE consumidor_id = ${consumidorId}
      `;

      if (carrinhos.length === 0) {
        return res.status(400).json({
          success: false,
          message: "O carrinho está vazio.",
          code: "EMPTY_CART",
        });
      }

      const carrinhoId = carrinhos[0].id;
      const cacambeiroId = carrinhos[0].cacambeiro_id;

      /*
      * 4. Executa o checkout em uma única instrução SQL.
      *
      * Todas as operações abaixo fazem parte da mesma transação
      * implícita do PostgreSQL. Se qualquer CTE falhar, tudo será
      * revertido automaticamente.
      *
      const pedidos = await sql`
        WITH itens_validos AS (
          SELECT
            ic.cacamba_id,
            ic.quantidade,
            ic.dias_aluguel,
            c.preco_diaria,
            c.disponivel,
            c.cacambeiro_id
          FROM itens_carrinho ic
          INNER JOIN cacambas c
            ON c.id = ic.cacamba_id
          WHERE ic.carrinho_id = ${carrinhoId}
        ),

        resumo AS (
          SELECT
            COUNT(*)::int AS quantidade_itens,

            COALESCE(
              SUM(
                quantidade *
                dias_aluguel *
                preco_diaria
              ),
              0
            )::numeric AS total_itens,

            MAX(dias_aluguel)::int AS max_dias,

            COUNT(*) FILTER (
              WHERE disponivel = FALSE
                OR cacambeiro_id <> ${cacambeiroId}
            )::int AS itens_invalidos
          FROM itens_validos
        ),

        novo_pedido AS (
          INSERT INTO alugueis (
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
          )
          SELECT
            gen_random_uuid(),
            ${consumidorId},
            ${cacambeiroId},
            ${endereco_id},
            NOW(),
            ${data_inicio}::date,
            resumo.max_dias,

            resumo.total_itens +
            COALESCE(
              (
                SELECT taxa_entrega
                FROM detalhes_cacambeiro
                WHERE usuario_id = ${cacambeiroId}
              ),
              0
            ),

            'PENDENTE',
            'AGUARDANDO_ENTREGA'
          FROM resumo
          WHERE resumo.quantidade_itens > 0
            AND resumo.itens_invalidos = 0
          RETURNING *
        ),

        novos_itens AS (
          INSERT INTO itens_aluguel (
            id,
            aluguel_id,
            cacamba_id,
            quantidade,
            dias_aluguel,
            preco_diaria
          )
          SELECT
            gen_random_uuid(),
            novo_pedido.id,
            itens_validos.cacamba_id,
            itens_validos.quantidade,
            itens_validos.dias_aluguel,
            itens_validos.preco_diaria
          FROM itens_validos
          CROSS JOIN novo_pedido
          RETURNING id
        ),

        carrinho_removido AS (
          DELETE FROM carrinho
          WHERE id = ${carrinhoId}

            -- Só remove depois que o pedido foi criado.
            AND EXISTS (
              SELECT 1
              FROM novo_pedido
            )

            -- Confirma que todos os itens foram criados.
            AND (
              SELECT COUNT(*)::int
              FROM novos_itens
            ) = (
              SELECT quantidade_itens
              FROM resumo
            )

          /*
          * Os itens do carrinho serão removidos automaticamente
          * pelo ON DELETE CASCADE da chave estrangeira.
          *
          RETURNING id
        )

        SELECT novo_pedido.*
        FROM novo_pedido
        WHERE EXISTS (
          SELECT 1
          FROM carrinho_removido
        )
      `;

      /*
      * Se não houve resultado, o carrinho estava sem itens válidos,
      * continha caçamba indisponível ou de outro fornecedor.
      *
      if (pedidos.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            "Não foi possível concluir o pedido. Verifique a disponibilidade e os itens do carrinho.",
          code: "CHECKOUT_FAILED",
        });
      }

      return res.status(201).json({
        success: true,
        message: "Pedido criado com sucesso.",
        data: pedidos[0],
      });
    } catch (error) {
      console.error("Erro no checkout:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno ao processar o pedido.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * GET /api/alugueis/meus
   * Consumidor visualiza seu histórico de pedidos com paginação.
   * Query: page (default 1)
   * Returns: { data, total, page, totalPages }
   *
  async meusPedidos(req, res) {
    try {
      const consumidor_id = req.usuario_id;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = 20;
      const offset = (page - 1) * limit;

      // Count total orders for pagination
      const countResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM alugueis
        WHERE consumidor_id = ${consumidor_id}
      `;
      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Fetch paginated orders with cacambeiro nome_completo
      const pedidos = await sql`
        SELECT a.*, u.nome_completo AS cacambeiro_nome
        FROM alugueis a
        JOIN usuarios u ON u.id = a.cacambeiro_id
        WHERE a.consumidor_id = ${consumidor_id}
        ORDER BY a.data_pedido DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      return res.status(200).json({
        data: pedidos,
        total,
        page,
        totalPages
      });
    } catch (error) {
      return res.status(500).json({ error: "Erro ao buscar pedidos." });
    }
  },

  // Caçambeiro visualiza os pedidos que ele precisa entregar/recolher
  async gestaoPedidos(req, res) {
    try {
      const cacambeiro_id = req.usuario_id;
      const pedidos = await sql`
        SELECT a.*,
               u.nome_completo AS consumidor_nome,
               e.logradouro, e.numero, e.bairro, e.cidade_estado, e.cep
        FROM alugueis a
        JOIN usuarios u ON u.id = a.consumidor_id
        LEFT JOIN enderecos e ON e.id = a.endereco_id
        WHERE a.cacambeiro_id = ${cacambeiro_id}
        ORDER BY a.data_inicio ASC
      `;
      return res.status(200).json(pedidos);
    } catch (error) {
      return res.status(500).json({ error: "Erro ao buscar gestão de pedidos." });
    }
  },

  /**
   * GET /api/alugueis
   * Admin visualiza todos os pedidos com paginação, filtros e busca textual.
   * Query: page (default 1), status_aluguel, status_pagamento, search (min 1 char)
   * Returns: { data, total, page, totalPages }
   *
  async listarTodos(req, res) {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = 20;
      const offset = (page - 1) * limit;
      const { status_aluguel, status_pagamento, search } = req.query;

      let conditionsQuery = sql`WHERE 1=1`;

      if (status_aluguel) {
        conditionsQuery = sql`${conditionsQuery} AND a.status_aluguel = ${status_aluguel}`;
      }

      if (status_pagamento) {
        conditionsQuery = sql`${conditionsQuery} AND a.status_pagamento = ${status_pagamento}`;
      }

      if (search && search.length >= 1) {
        const searchPattern = `%${search}%`;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search);
        if (isUUID) {
          conditionsQuery = sql`${conditionsQuery} AND a.id = ${search}`;
        } else {
          conditionsQuery = sql`${conditionsQuery} AND (uc.nome_completo ILIKE ${searchPattern} OR uk.nome_completo ILIKE ${searchPattern})`;
        }
      }

      // Count total for pagination
      const countResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM alugueis a
        JOIN usuarios uc ON uc.id = a.consumidor_id
        JOIN usuarios uk ON uk.id = a.cacambeiro_id
        ${conditionsQuery}
      `;
      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      // Fetch paginated orders with consumer/cacambeiro names and address
      const pedidos = await sql`
        SELECT a.*,
               uc.nome_completo AS consumidor_nome,
               uk.nome_completo AS cacambeiro_nome,
               e.logradouro, e.numero, e.bairro, e.cidade_estado, e.cep
        FROM alugueis a
        JOIN usuarios uc ON uc.id = a.consumidor_id
        JOIN usuarios uk ON uk.id = a.cacambeiro_id
        LEFT JOIN enderecos e ON e.id = a.endereco_id
        ${conditionsQuery}
        ORDER BY a.data_pedido DESC
        LIMIT ${limit} OFFSET ${offset}
      `;

      return res.status(200).json({
        data: pedidos,
        total,
        page,
        totalPages
      });
    } catch (error) {
      console.error("Erro ao listar todos os pedidos:", error);
      return res.status(500).json({ error: "Erro ao buscar pedidos." });
    }
  },

  // Caçambeiro atualiza o status de um pedido
  async atualizarStatus(req, res) {
    try {
      const cacambeiro_id = req.usuario_id;
      const { id } = req.params;
      const { status_aluguel } = req.body;

      // State machine: sequential forward-only transitions
      const STATUS_SEQUENCE = [
        'AGUARDANDO_ENTREGA',
        'EM_USO',
        'AGUARDANDO_RETIRADA',
        'FINALIZADO'
      ];

      // 1. Find the order and verify ownership
      const pedidoRows = await sql`
        SELECT * FROM alugueis
        WHERE id = ${id} AND cacambeiro_id = ${cacambeiro_id}
      `;

      if (pedidoRows.length === 0) {
        return res.status(404).json({ error: "Pedido não encontrado ou não pertence a você." });
      }

      const pedido = pedidoRows[0];

      // 2. Check if order is already FINALIZADO
      if (pedido.status_aluguel === 'FINALIZADO') {
        return res.status(400).json({ error: "O pedido já está finalizado" });
      }

      // 3. Validate the transition is the next sequential state
      const currentIndex = STATUS_SEQUENCE.indexOf(pedido.status_aluguel);
      const newIndex = STATUS_SEQUENCE.indexOf(status_aluguel);

      if (newIndex === -1 || newIndex !== currentIndex + 1) {
        return res.status(400).json({ error: "Transição de status inválida. Apenas transições sequenciais são permitidas." });
      }

      // 4. Update the status
      const resultado = await sql`
        UPDATE alugueis
        SET status_aluguel = ${status_aluguel}
        WHERE id = ${id} AND cacambeiro_id = ${cacambeiro_id}
        RETURNING *
      `;

      return res.status(200).json(resultado[0]);
    } catch (error) {
      return res.status(500).json({ error: "Erro ao atualizar status." });
    }
  }
};

module.exports = alugueisController;
*/