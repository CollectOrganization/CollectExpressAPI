const sql = require("../config/db");

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
 */
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
      */
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
          */
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
      */
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
   */
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
   */
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
