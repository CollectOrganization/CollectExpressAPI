const ApiError = require("../utils/apiError");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const reciclagem = require("../services/reciclagemService");
const { getClientIp } = require("../middlewares/rateLimitMiddleware");

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
    "Erro interno ao processar a sinalização.",
    "INTERNAL_SERVER_ERROR",
  );
}

/**
 * Sinalizações de material reciclável disponível para retirada.
 * Quem entrega (cliente ou caçambeiro) cria; o parceiro escolhe.
 */
const ofertasColetaController = {
  /** POST /api/ofertas-coleta */
  async criar(req, res) {
    try {
      const oferta = await reciclagem.criarOferta(
        reciclagem.usuarioDaRequisicao(req),
        req.body,
        { ip: getClientIp(req) },
      );

      return sendSuccess(res, oferta, 201, "Material sinalizado.");
    } catch (error) {
      return tratarErro(res, error, "Erro ao criar sinalização:");
    }
  },

  /** GET /api/ofertas-coleta/minhas */
  async minhas(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.minhasOfertas(reciclagem.usuarioDaRequisicao(req)),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao listar sinalizações:");
    }
  },

  /** PATCH /api/ofertas-coleta/:id/cancelar */
  async cancelar(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.cancelarOferta(
          reciclagem.usuarioDaRequisicao(req),
          req.params.id,
        ),
        200,
        "Sinalização cancelada.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao cancelar sinalização:");
    }
  },

  /**
   * GET /api/ofertas-coleta?materiais=&distancia_km=&de=&ate=&page=
   * Vitrine do parceiro.
   */
  async disponiveis(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.ofertasDisponiveis(
          reciclagem.usuarioDaRequisicao(req),
          req.query,
        ),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao listar sinalizações abertas:");
    }
  },

  /** GET /api/ofertas-coleta/:id */
  async detalhe(req, res) {
    try {
      return sendSuccess(
        res,
        await reciclagem.detalheDaOfertaParaParceiro(
          reciclagem.usuarioDaRequisicao(req),
          req.params.id,
        ),
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao abrir sinalização:");
    }
  },
};

module.exports = ofertasColetaController;
