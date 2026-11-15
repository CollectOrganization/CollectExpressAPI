const crypto = require("crypto");

const { sendSuccess, sendError } = require("../utils/apiResponse");
const reciclagem = require("../services/reciclagemService");

const reciclagemJobController = {
  /**
   * POST /api/internal/jobs/reciclagem
   *
   * Expira sinalizações em que já não dá tempo de agendar e envia os
   * lembretes das coletas das próximas 24 horas. Chamado por um cron
   * externo; protegido por JOBS_SECRET (header x-jobs-secret).
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
      return sendSuccess(res, await reciclagem.varredura());
    } catch (error) {
      console.error("Erro na varredura de reciclagem:", error);

      return sendError(
        res,
        500,
        "Erro interno na varredura de reciclagem.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = reciclagemJobController;
