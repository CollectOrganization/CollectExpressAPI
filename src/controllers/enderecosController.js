const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

const enderecosController = {
  /**
   * GET /api/enderecos
   *
   * Lista os endereços pertencentes ao usuário autenticado.
   * O usuario_id é obtido exclusivamente do JWT pelo authMiddleware.
   */
  async listar(req, res) {
    try {
      const usuarioId = req.usuario_id;

      const enderecos = await sql`
        SELECT
          id,
          cep,
          logradouro,
          numero,
          bairro,
          cidade_estado,
          criado_em
        FROM enderecos
        WHERE usuario_id = ${usuarioId}
        ORDER BY criado_em DESC
      `;

      return sendSuccess(
        res,
        enderecos,
        200,
        "Endereços encontrados com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao listar endereços:", error);

      return sendError(
        res,
        500,
        "Erro interno ao buscar endereços.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * POST /api/enderecos
   *
   * Cria um endereço para o usuário autenticado.
   *
   * As validações de formato e campos obrigatórios são realizadas
   * pelo validationMiddleware antes da execução deste controller.
   *
   * Regra de negócio:
   * - cada usuário pode possuir no máximo 10 endereços.
   */
  async criar(req, res) {
    try {
      const usuarioId = req.usuario_id;

      const {
        cep,
        logradouro,
        numero,
        bairro,
        cidade_estado,
      } = req.body;

      // Verifica quantos endereços o usuário já cadastrou.
      const countResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM enderecos
        WHERE usuario_id = ${usuarioId}
      `;

      const totalEnderecos = Number(countResult[0].total);

      if (totalEnderecos >= 10) {
        return sendError(
          res,
          409,
          "Limite de 10 endereços atingido.",
          "ADDRESS_LIMIT_REACHED",
        );
      }

      /*
       * Normaliza campos textuais antes de salvar.
       * O CEP já deve chegar somente com números por causa
       * do schema de validação.
       */
      const cepNormalizado = cep.replace(/\D/g, "");
      const logradouroNormalizado = logradouro.trim();
      const numeroNormalizado = numero.trim();
      const bairroNormalizado = bairro?.trim() || "";
      const cidadeEstadoNormalizado = cidade_estado.trim();

      const resultado = await sql`
        INSERT INTO enderecos (
          id,
          usuario_id,
          cep,
          logradouro,
          numero,
          bairro,
          cidade_estado
        )
        VALUES (
          gen_random_uuid(),
          ${usuarioId},
          ${cepNormalizado},
          ${logradouroNormalizado},
          ${numeroNormalizado},
          ${bairroNormalizado},
          ${cidadeEstadoNormalizado}
        )
        RETURNING
          id,
          cep,
          logradouro,
          numero,
          bairro,
          cidade_estado,
          criado_em
      `;

      return sendSuccess(
        res,
        resultado[0],
        201,
        "Endereço cadastrado com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao criar endereço:", error);

      return sendError(
        res,
        500,
        "Erro interno ao salvar o endereço.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * PUT /api/enderecos/:id
   *
   * Atualiza um endereço pertencente ao usuário autenticado.
   *
   * Regras:
   * - exige autenticação;
   * - somente o proprietário pode atualizar;
   * - não permite alterar endereço vinculado a pedido ativo;
   * - todos os campos principais devem ser enviados.
   */
  async atualizar(req, res) {
    try {
      const usuarioId = req.usuario_id;
      const { id } = req.params;

      const {
        cep,
        logradouro,
        numero,
        bairro,
        cidade_estado,
      } = req.body;

      /*
      * Verifica simultaneamente se o endereço existe e se pertence
      * ao usuário autenticado.
      *
      * A mesma resposta é usada para endereço inexistente ou de
      * outro usuário, evitando revelar informações indevidas.
      */
      const enderecos = await sql`
        SELECT id
        FROM enderecos
        WHERE id = ${id}
          AND usuario_id = ${usuarioId}
        LIMIT 1
      `;

      if (enderecos.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Endereço não encontrado.",
          code: "ADDRESS_NOT_FOUND",
        });
      }

      /*
      * Impede a alteração de um endereço usado por um pedido ativo.
      *
      * Isso evita modificar o local de entrega de um pedido que
      * já está em andamento.
      */
      const pedidosAtivos = await sql`
        SELECT 1
        FROM alugueis
        WHERE endereco_id = ${id}
          AND status_aluguel IN (
            'AGUARDANDO_ENTREGA',
            'EM_USO',
            'AGUARDANDO_RETIRADA'
          )
        LIMIT 1
      `;

      if (pedidosAtivos.length > 0) {
        return res.status(409).json({
          success: false,
          message:
            "Este endereço está vinculado a um pedido ativo e não pode ser alterado.",
          code: "ADDRESS_HAS_ACTIVE_ORDER",
        });
      }

      /*
      * Atualiza somente quando o endereço também pertence ao
      * usuário autenticado. Essa segunda verificação protege contra
      * alterações entre a consulta anterior e este comando.
      */
      const resultado = await sql`
        UPDATE enderecos
        SET
          cep = ${cep.replace(/\D/g, "")},
          logradouro = ${logradouro.trim()},
          numero = ${numero.trim()},
          bairro = ${(bairro || "").trim()},
          cidade_estado = ${cidade_estado.trim()}
        WHERE id = ${id}
          AND usuario_id = ${usuarioId}
        RETURNING
          id,
          cep,
          logradouro,
          numero,
          bairro,
          cidade_estado,
          criado_em
      `;

      if (resultado.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Endereço não encontrado.",
          code: "ADDRESS_NOT_FOUND",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Endereço atualizado com sucesso.",
        data: resultado[0],
      });
    } catch (error) {
      console.error("Erro ao atualizar endereço:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno ao atualizar o endereço.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * DELETE /api/enderecos/:id
   *
   * Remove um endereço do usuário autenticado.
   *
   * Regras:
   * - o endereço deve pertencer ao usuário autenticado;
   * - endereços vinculados a pedidos não podem ser removidos;
   * - retorna 404 também para endereço de outro usuário, evitando
   *   revelar a existência de recursos de terceiros.
   */
  async remover(req, res) {
    try {
      const usuarioId = req.usuario_id;
      const { id } = req.params;

      /*
       * Consulta o endereço usando também usuario_id.
       * Isso garante o isolamento do recurso por proprietário.
       */
      const enderecos = await sql`
        SELECT id
        FROM enderecos
        WHERE id = ${id}
          AND usuario_id = ${usuarioId}
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
       * Verifica qualquer pedido associado ao endereço.
       *
       * A chave estrangeira de alugueis usa ON DELETE RESTRICT,
       * portanto mesmo pedidos finalizados preservam o endereço
       * para manter a integridade do histórico.
       */
      const pedidosResult = await sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (
            WHERE status_aluguel IN (
              'AGUARDANDO_ENTREGA',
              'EM_USO',
              'AGUARDANDO_RETIRADA'
            )
          )::int AS ativos
        FROM alugueis
        WHERE endereco_id = ${id}
      `;

      const totalPedidos = Number(pedidosResult[0].total);
      const pedidosAtivos = Number(pedidosResult[0].ativos);

      if (pedidosAtivos > 0) {
        return sendError(
          res,
          409,
          "Não é possível remover este endereço porque existem pedidos ativos vinculados.",
          "ADDRESS_HAS_ACTIVE_ORDERS",
        );
      }

      if (totalPedidos > 0) {
        return sendError(
          res,
          409,
          "Não é possível remover este endereço porque ele faz parte do histórico de pedidos.",
          "ADDRESS_HAS_ORDER_HISTORY",
        );
      }

      /*
       * O usuario_id também é utilizado no DELETE como uma segunda
       * proteção contra remoção de recursos de terceiros.
       */
      const removidos = await sql`
        DELETE FROM enderecos
        WHERE id = ${id}
          AND usuario_id = ${usuarioId}
        RETURNING id
      `;

      if (removidos.length === 0) {
        return sendError(
          res,
          404,
          "Endereço não encontrado.",
          "ADDRESS_NOT_FOUND",
        );
      }

      return sendSuccess(
        res,
        null,
        200,
        "Endereço removido com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao remover endereço:", error);

      // Proteção adicional para violações de chave estrangeira.
      if (error.code === "23503") {
        return sendError(
          res,
          409,
          "O endereço está vinculado a outros registros e não pode ser removido.",
          "ADDRESS_IN_USE",
        );
      }

      return sendError(
        res,
        500,
        "Erro interno ao remover endereço.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = enderecosController;


// --------- Old Version ----------
/*
const sql = require("../config/db");

const enderecosController = {
  /**
   * GET /api/enderecos
   * Lista todos os endereços do usuário autenticado.
   * Ownership isolation: usa req.usuario_id do token JWT.
   *
  async listar(req, res) {
    try {
      const usuario_id = req.usuario_id;

      const enderecos = await sql`
        SELECT id, cep, logradouro, numero, bairro, cidade_estado, criado_em
        FROM enderecos
        WHERE usuario_id = ${usuario_id}
        ORDER BY criado_em DESC
      `;

      return res.status(200).json(enderecos);
    } catch (error) {
      console.error("Erro ao listar endereços:", error);
      return res.status(500).json({ error: "Erro interno ao buscar endereços." });
    }
  },

  /**
   * POST /api/enderecos
   * Cria um novo endereço para o usuário autenticado.
   * Validações: cep (8 dígitos), logradouro (1-200), numero (1-20), cidade_estado (1-100).
   * Limite: máximo 10 endereços por usuário.
   *
  async criar(req, res) {
    try {
      const usuario_id = req.usuario_id;
      const { cep, logradouro, numero, bairro, cidade_estado } = req.body;

      // Validação de campos obrigatórios e formatos
      const fields = {};

      if (!cep || !/^\d{8}$/.test(cep)) {
        fields.cep = "CEP deve conter exatamente 8 dígitos numéricos.";
      }

      if (!logradouro || logradouro.length < 1 || logradouro.length > 200) {
        fields.logradouro = "Logradouro deve ter entre 1 e 200 caracteres.";
      }

      if (!numero || numero.length < 1 || numero.length > 20) {
        fields.numero = "Número deve ter entre 1 e 20 caracteres.";
      }

      if (!cidade_estado || cidade_estado.length < 1 || cidade_estado.length > 100) {
        fields.cidade_estado = "Cidade/Estado deve ter entre 1 e 100 caracteres.";
      }

      if (Object.keys(fields).length > 0) {
        return res.status(400).json({ error: "Campos inválidos.", fields });
      }

      // Verificar limite de 10 endereços por usuário
      const countResult = await sql`
        SELECT COUNT(*)::int AS total FROM enderecos WHERE usuario_id = ${usuario_id}
      `;

      if (countResult[0].total >= 10) {
        return res.status(400).json({ error: "Limite de 10 endereços atingido." });
      }

      // Inserir novo endereço
      const resultado = await sql`
        INSERT INTO enderecos (id, usuario_id, cep, logradouro, numero, bairro, cidade_estado)
        VALUES (gen_random_uuid(), ${usuario_id}, ${cep}, ${logradouro}, ${numero}, ${bairro || ''}, ${cidade_estado})
        RETURNING id, cep, logradouro, numero, bairro, cidade_estado, criado_em
      `;

      return res.status(201).json(resultado[0]);
    } catch (error) {
      console.error("Erro ao criar endereço:", error);
      return res.status(500).json({ error: "Erro interno ao salvar o endereço." });
    }
  },

  /**
   * DELETE /api/enderecos/:id
   * Remove um endereço do usuário autenticado.
   * Verifica ownership e se não há aluguéis ativos vinculados.
   *
  async remover(req, res) {
    try {
      const usuario_id = req.usuario_id;
      const { id } = req.params;

      // Verificar se o endereço existe e pertence ao usuário
      const endereco = await sql`
        SELECT id, usuario_id FROM enderecos WHERE id = ${id}
      `;

      if (endereco.length === 0) {
        return res.status(404).json({ error: "Endereço não encontrado." });
      }

      if (endereco[0].usuario_id !== usuario_id) {
        return res.status(403).json({ error: "Acesso negado. Este endereço pertence a outro usuário." });
      }

      // Verificar se há aluguéis ativos vinculados ao endereço
      const alugueisAtivos = await sql`
        SELECT COUNT(*)::int AS total
        FROM alugueis
        WHERE endereco_id = ${id}
          AND status_aluguel IN ('AGUARDANDO_ENTREGA', 'EM_USO', 'AGUARDANDO_RETIRADA')
      `;

      if (alugueisAtivos[0].total > 0) {
        return res.status(400).json({
          error: "Não é possível remover este endereço pois há pedidos ativos vinculados."
        });
      }

      // Deletar o endereço
      await sql`DELETE FROM enderecos WHERE id = ${id}`;

      return res.status(200).json({ message: "Endereço removido com sucesso." });
    } catch (error) {
      console.error("Erro ao remover endereço:", error);
      return res.status(500).json({ error: "Erro interno ao remover endereço." });
    }
  }
};

module.exports = enderecosController;
*/