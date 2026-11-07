const crypto = require("crypto");

const ApiError = require("../utils/apiError");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const chatService = require("../services/chatService");

function tratarErro(res, error, contexto) {
  if (error instanceof ApiError) {
    return sendError(
      res,
      error.statusCode,
      error.message,
      error.code,
      error.fields,
    );
  }

  console.error(contexto, error);

  return sendError(
    res,
    500,
    "Erro interno no chat.",
    "INTERNAL_SERVER_ERROR",
  );
}

const chatController = {
  /** GET /api/chat/conversas?tipo=&status=&denunciadas=&busca=&page= */
  async listar(req, res) {
    try {
      const { tipo, status, denunciadas, busca, page } = req.query;

      const resultado = await chatService.listarConversas(
        chatService.usuarioDaRequisicao(req),
        {
          tipo,
          status,
          denunciadas: denunciadas === "true",
          busca,
          page,
        },
      );

      return sendSuccess(res, resultado);
    } catch (error) {
      return tratarErro(res, error, "Erro ao listar conversas:");
    }
  },

  /** GET /api/chat/nao-lidas */
  async naoLidas(req, res) {
    try {
      return sendSuccess(
        res,
        await chatService.contarNaoLidas(chatService.usuarioDaRequisicao(req)),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao contar mensagens não lidas:");
    }
  },

  /** GET /api/chat/conversas/:id */
  async detalhe(req, res) {
    try {
      return sendSuccess(
        res,
        await chatService.detalheDaConversa(
          chatService.usuarioDaRequisicao(req),
          req.params.id,
        ),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao abrir conversa:");
    }
  },

  /** GET /api/chat/conversas/:id/mensagens?depois=&antes=&limite= */
  async mensagens(req, res) {
    try {
      return sendSuccess(
        res,
        await chatService.listarMensagens(
          chatService.usuarioDaRequisicao(req),
          req.params.id,
          req.query,
        ),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao listar mensagens:");
    }
  },

  /** POST /api/chat/conversas/:id/mensagens  { texto } */
  async enviar(req, res) {
    try {
      const mensagem = await chatService.enviarMensagem(
        chatService.usuarioDaRequisicao(req),
        req.params.id,
        req.body.texto,
      );

      return sendSuccess(res, mensagem, 201, "Mensagem enviada.");
    } catch (error) {
      return tratarErro(res, error, "Erro ao enviar mensagem:");
    }
  },

  /** POST /api/chat/pedidos/:id/conversa */
  async conversaDoPedido(req, res) {
    try {
      return sendSuccess(
        res,
        await chatService.conversaDoPedido(
          chatService.usuarioDaRequisicao(req),
          req.params.id,
        ),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao abrir conversa do pedido:");
    }
  },

  /** POST /api/chat/chamados  { assunto, mensagem, aluguel_id? } */
  async abrirChamado(req, res) {
    try {
      const { assunto, mensagem, aluguel_id: aluguelId } = req.body;

      const chamado = await chatService.abrirChamado(
        chatService.usuarioDaRequisicao(req),
        { assunto, mensagem, aluguelId },
      );

      return sendSuccess(res, chamado, 201, "Chamado aberto.");
    } catch (error) {
      return tratarErro(res, error, "Erro ao abrir chamado:");
    }
  },

  /** PATCH /api/chat/chamados/:id/fechar */
  async fecharChamado(req, res) {
    try {
      return sendSuccess(
        res,
        await chatService.fecharChamado(
          chatService.usuarioDaRequisicao(req),
          req.params.id,
        ),
        200,
        "Chamado encerrado.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao fechar chamado:");
    }
  },

  /** POST /api/chat/conversas/:id/denunciar  { motivo? } */
  async denunciar(req, res) {
    try {
      return sendSuccess(
        res,
        await chatService.denunciar(
          chatService.usuarioDaRequisicao(req),
          req.params.id,
          req.body?.motivo,
        ),
        201,
        "Denúncia enviada à equipe.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao denunciar conversa:");
    }
  },

  /** PATCH /api/chat/conversas/:id/denuncia  (ADMIN) */
  async resolverDenuncia(req, res) {
    try {
      return sendSuccess(
        res,
        await chatService.resolverDenuncia(
          chatService.usuarioDaRequisicao(req),
          req.params.id,
        ),
        200,
        "Denúncia marcada como analisada.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao resolver denúncia:");
    }
  },

  /**
   * POST /api/internal/jobs/chat
   *
   * Avisa por e-mail quem deixou mensagens sem ler por mais de 8 horas.
   * Chamado por um cron externo; protegido por JOBS_SECRET
   * (header x-jobs-secret), como a varredura de extensões.
   */
  async rodarVarredura(req, res) {
    const esperado = process.env.JOBS_SECRET;
    const recebido = req.get("x-jobs-secret") || "";

    const autorizado =
      Boolean(esperado) &&
      recebido.length === esperado.length &&
      crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado));

    if (!autorizado) {
      return sendError(res, 403, "Acesso negado.", "FORBIDDEN");
    }

    try {
      return sendSuccess(res, await chatService.avisarMensagensNaoLidas());
    } catch (error) {
      return tratarErro(res, error, "Erro na varredura do chat:");
    }
  },
};

module.exports = chatController;
