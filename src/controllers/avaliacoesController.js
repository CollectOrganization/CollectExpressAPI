const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

const avaliacoesController = {
  /**
   * POST /api/avaliacoes
   *
   * Permite que um consumidor avalie um pedido finalizado.
   *
   * Body esperado:
   * {
   *   "aluguel_id": "uuid",
   *   "nota": 5,
   *   "comentario": "Ótimo atendimento"
   * }
   *
   * As validações de formato são realizadas pelo
   * validationMiddleware antes deste controller.
   *
   * Regras de negócio:
   * - o pedido deve pertencer ao consumidor autenticado;
   * - o pedido deve estar finalizado;
   * - cada pedido pode receber apenas uma avaliação.
   */
  async criar(req, res) {
    try {
      const consumidorId = req.usuario_id;
      const {
        aluguel_id: aluguelId,
        nota,
        comentario,
      } = req.body;

      /*
       * Procura o pedido restringindo pelo consumidor autenticado.
       *
       * Isso evita que um consumidor avalie um pedido pertencente
       * a outro usuário.
       */
      const pedidos = await sql`
        SELECT
          id,
          consumidor_id,
          cacambeiro_id,
          status_aluguel
        FROM alugueis
        WHERE id = ${aluguelId}
          AND consumidor_id = ${consumidorId}
        LIMIT 1
      `;

      if (pedidos.length === 0) {
        return sendError(
          res,
          404,
          "Pedido não encontrado.",
          "ORDER_NOT_FOUND",
        );
      }

      const pedido = pedidos[0];

      /*
       * Somente pedidos que chegaram ao último estado da máquina
       * de status podem ser avaliados.
       */
      if (pedido.status_aluguel !== "FINALIZADO") {
        return sendError(
          res,
          400,
          "Apenas pedidos finalizados podem ser avaliados.",
          "ORDER_NOT_FINISHED",
        );
      }

      /*
       * Esta consulta melhora a mensagem retornada ao usuário.
       *
       * A constraint UNIQUE da tabela continua sendo a proteção
       * definitiva contra duas avaliações concorrentes.
       */
      const avaliacoesExistentes = await sql`
        SELECT id
        FROM avaliacoes
        WHERE aluguel_id = ${aluguelId}
        LIMIT 1
      `;

      if (avaliacoesExistentes.length > 0) {
        return sendError(
          res,
          409,
          "Este pedido já foi avaliado.",
          "ORDER_ALREADY_REVIEWED",
        );
      }

      /*
       * Comentários vazios são armazenados como NULL.
       * Quando existir conteúdo, removemos espaços no início e no fim.
       */
      const comentarioNormalizado =
        typeof comentario === "string" &&
        comentario.trim().length > 0
          ? comentario.trim()
          : null;

      const resultado = await sql`
        INSERT INTO avaliacoes (
          id,
          aluguel_id,
          consumidor_id,
          cacambeiro_id,
          nota,
          comentario,
          data_avaliacao
        )
        VALUES (
          gen_random_uuid(),
          ${aluguelId},
          ${consumidorId},
          ${pedido.cacambeiro_id},
          ${nota},
          ${comentarioNormalizado},
          NOW()
        )
        RETURNING
          id,
          aluguel_id,
          consumidor_id,
          cacambeiro_id,
          nota,
          comentario,
          data_avaliacao
      `;

      return sendSuccess(
        res,
        resultado[0],
        201,
        "Avaliação registrada com sucesso.",
      );
    } catch (error) {
      /*
       * Código PostgreSQL 23505:
       * violação de uma constraint UNIQUE.
       *
       * Essa situação pode ocorrer quando duas requisições tentam
       * avaliar o mesmo pedido ao mesmo tempo.
       */
      if (error.code === "23505") {
        return sendError(
          res,
          409,
          "Este pedido já foi avaliado.",
          "ORDER_ALREADY_REVIEWED",
        );
      }

      /*
       * Código PostgreSQL 23503:
       * violação de chave estrangeira.
       */
      if (error.code === "23503") {
        return sendError(
          res,
          400,
          "O pedido ou usuário relacionado não é válido.",
          "INVALID_REVIEW_RELATION",
        );
      }

      console.error("Erro ao criar avaliação:", error);

      return sendError(
        res,
        500,
        "Erro interno ao salvar a avaliação.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * GET /api/avaliacoes/cacambeiro/:id
   *
   * Lista as avaliações públicas de um fornecedor.
   *
   * Também suporta temporariamente o parâmetro `id_cacambeiro`,
   * utilizado por uma rota antiga:
   *
   * GET /api/cacambeiros/:id_cacambeiro/avaliacoes
   */
  async listarPorCacambeiro(req, res) {
    try {
      const cacambeiroId =
        req.params.id ?? req.params.id_cacambeiro;

      /*
       * Confirma que o fornecedor existe.
       *
       * Dessa forma, diferenciamos um fornecedor inexistente de
       * um fornecedor existente que ainda não possui avaliações.
       */
      const cacambeiros = await sql`
        SELECT id
        FROM usuarios
        WHERE id = ${cacambeiroId}
          AND tipo_perfil = 'CACAMBEIRO'
        LIMIT 1
      `;

      if (cacambeiros.length === 0) {
        return sendError(
          res,
          404,
          "Fornecedor não encontrado.",
          "SUPPLIER_NOT_FOUND",
        );
      }

      const avaliacoes = await sql`
        SELECT
          av.id,
          av.aluguel_id,
          av.consumidor_id,
          av.cacambeiro_id,
          av.nota,
          av.comentario,
          av.data_avaliacao,
          u.nome_completo AS consumidor_nome
        FROM avaliacoes av
        INNER JOIN usuarios u
          ON u.id = av.consumidor_id
        WHERE av.cacambeiro_id = ${cacambeiroId}
        ORDER BY av.data_avaliacao DESC
      `;

      /*
       * Calcula um resumo para evitar que o frontend precise
       * recalcular a média das avaliações.
       */
      const resumo = await sql`
        SELECT
          COUNT(*)::int AS total,
          ROUND(AVG(nota)::numeric, 1)::float AS nota_media
        FROM avaliacoes
        WHERE cacambeiro_id = ${cacambeiroId}
      `;

      return sendSuccess(
        res,
        {
          avaliacoes,
          resumo: {
            total: resumo[0].total,
            nota_media: resumo[0].nota_media,
          },
        },
        200,
        "Avaliações encontradas com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao listar avaliações do fornecedor:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar as avaliações.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = avaliacoesController;



// ------------ Old Version ------------
/*const sql = require("../config/db");

const avaliacoesController = {
  /**
   * POST /api/avaliacoes
   * Consumidor submete uma avaliação para um pedido finalizado.
   * Body: { aluguel_id, nota (1-5), comentario (optional, max 500 chars) }
   *
  async criar(req, res) {
    try {
      const consumidor_id = req.usuario_id;
      const { aluguel_id, nota, comentario } = req.body;

      // 1. Validar campos obrigatórios
      if (!aluguel_id) {
        return res.status(400).json({ error: "O campo 'aluguel_id' é obrigatório" });
      }

      if (nota === undefined || nota === null) {
        return res.status(400).json({ error: "O campo 'nota' é obrigatório" });
      }

      // 2. Validar nota: inteiro entre 1 e 5
      if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
        return res.status(400).json({ error: "O campo 'nota' deve ser um inteiro entre 1 e 5" });
      }

      // 3. Validar comentario: opcional, max 500 chars
      if (comentario !== undefined && comentario !== null && comentario.length > 500) {
        return res.status(400).json({ error: "O campo 'comentario' deve ter no máximo 500 caracteres" });
      }

      // 4. Verificar se o pedido existe e pertence ao consumidor
      const pedido = await sql`
        SELECT id, consumidor_id, cacambeiro_id, status_aluguel
        FROM alugueis
        WHERE id = ${aluguel_id} AND consumidor_id = ${consumidor_id}
      `;

      if (pedido.length === 0) {
        return res.status(404).json({ error: "Pedido não encontrado" });
      }

      // 5. Verificar se o pedido está FINALIZADO
      if (pedido[0].status_aluguel !== "FINALIZADO") {
        return res.status(400).json({ error: "Apenas pedidos finalizados podem ser avaliados" });
      }

      // 6. Verificar se já existe avaliação para este pedido
      const avaliacaoExistente = await sql`
        SELECT id FROM avaliacoes WHERE aluguel_id = ${aluguel_id}
      `;

      if (avaliacaoExistente.length > 0) {
        return res.status(400).json({ error: "Este pedido já foi avaliado" });
      }

      // 7. Criar a avaliação
      const cacambeiro_id = pedido[0].cacambeiro_id;

      const novaAvaliacao = await sql`
        INSERT INTO avaliacoes (id, aluguel_id, consumidor_id, cacambeiro_id, nota, comentario, data_avaliacao)
        VALUES (gen_random_uuid(), ${aluguel_id}, ${consumidor_id}, ${cacambeiro_id}, ${nota}, ${comentario || null}, NOW())
        RETURNING *
      `;

      return res.status(201).json(novaAvaliacao[0]);
    } catch (error) {
      return res.status(500).json({ error: "Erro interno ao salvar avaliação" });
    }
  },

  /**
   * GET /api/avaliacoes/cacambeiro/:id
   * Lista todas as avaliações de um caçambeiro específico.
   * Inclui nome_completo do avaliador, ordenado por data_avaliacao DESC.
   *
  async listarPorCacambeiro(req, res) {
    try {
      const { id } = req.params;

      const avaliacoes = await sql`
        SELECT av.id, av.aluguel_id, av.consumidor_id, av.cacambeiro_id,
               av.nota, av.comentario, av.data_avaliacao,
               u.nome_completo AS consumidor_nome
        FROM avaliacoes av
        JOIN usuarios u ON av.consumidor_id = u.id
        WHERE av.cacambeiro_id = ${id}
        ORDER BY av.data_avaliacao DESC
      `;

      return res.status(200).json(avaliacoes);
    } catch (error) {
      return res.status(500).json({ error: "Erro ao buscar avaliações" });
    }
  },
};

module.exports = avaliacoesController;
*/