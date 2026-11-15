const ApiError = require("../utils/apiError");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const reciclagem = require("../services/reciclagemService");

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
    "Erro interno ao processar a coleta.",
    "INTERNAL_SERVER_ERROR",
  );
}

const usuario = (req) => reciclagem.usuarioDaRequisicao(req);

/**
 * Coletas agendadas por parceiros de reciclagem.
 * O telefone e o e-mail das partes não são divulgados: a conversa
 * acontece no chat.
 */
const coletasController = {
  /** POST /api/coletas  { oferta_id, data_agendada, observacoes? } */
  async agendar(req, res) {
    try {
      const coleta = await reciclagem.agendarColeta(usuario(req), req.body);
      return sendSuccess(res, coleta, 201, "Coleta agendada.");
    } catch (error) {
      return tratarErro(res, error, "Erro ao agendar coleta:");
    }
  },

  /** GET /api/coletas?status=&page= */
  async listar(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.listarColetas(usuario(req), req.query),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao listar coletas:");
    }
  },

  /** GET /api/coletas/resumo */
  async resumo(req, res) {
    try {
      return sendSuccess(res, await reciclagem.resumo(usuario(req)));
    } catch (error) {
      return tratarErro(res, error, "Erro ao resumir coletas:");
    }
  },

  /** GET /api/coletas/:id */
  async detalhe(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.detalheDaColeta(usuario(req), req.params.id),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao abrir coleta:");
    }
  },

  /** PATCH /api/coletas/:id/cancelar  { motivo?, encerrar_sinalizacao? } */
  async cancelar(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.cancelarColeta(
          usuario(req),
          req.params.id,
          req.body ?? {},
        ),
        200,
        "Coleta cancelada.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao cancelar coleta:");
    }
  },

  /** PATCH /api/coletas/:id/concluir  { peso_real_kg? } */
  async concluir(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.concluirColeta(
          usuario(req),
          req.params.id,
          req.body ?? {},
        ),
        200,
        "Coleta concluída.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao concluir coleta:");
    }
  },

  /** GET /api/coletas/:id/documento  (PDF) */
  async documento(req, res) {
    try {
      const { buffer, nome } = await reciclagem.documentoDaColeta(
        usuario(req),
        req.params.id,
      );

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });

      return res.status(200).send(buffer);
    } catch (error) {
      return tratarErro(res, error, "Erro ao baixar o documento:");
    }
  },

  /**
   * GET /api/coletas/verificar/:codigo?autenticacao=
   *
   * Pública: confere se o código de autenticação impresso no documento
   * pertence a um documento da plataforma. Não devolve dados pessoais.
   */
  async verificar(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.verificarDocumento(
          req.params.codigo,
          req.query.autenticacao,
        ),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao verificar o documento:");
    }
  },
};

module.exports = coletasController;
