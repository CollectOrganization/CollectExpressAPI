const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");
const geocoding = require("../services/geocodingService");

const localizacaoController = {
  /**
   * GET /api/localizacao/cep/:cep
   *
   * Endereço e coordenadas de um CEP. Rota pública: o app a usa para
   * saber onde o cliente quer a entrega antes de mostrar as caçambas.
   *
   * latitude/longitude podem vir nulas quando o CEP existe mas não foi
   * possível localizá-lo no mapa; o app deve avisar a pessoa.
   */
  async buscarCep(req, res) {
    const cep = geocoding.normalizarCep(req.params.cep);

    if (!cep) {
      return sendError(
        res,
        400,
        "Informe um CEP com 8 dígitos.",
        "INVALID_CEP",
        { cep: "Informe um CEP com 8 dígitos." },
      );
    }

    try {
      const endereco = await geocoding.buscarCep(cep);

      if (!endereco) {
        return sendError(
          res,
          404,
          "CEP não encontrado.",
          "CEP_NOT_FOUND",
        );
      }

      return sendSuccess(res, endereco);
    } catch (error) {
      if (error instanceof geocoding.GeocodingUnavailableError) {
        return sendError(
          res,
          503,
          "Não foi possível consultar o CEP agora. Tente novamente em instantes.",
          "GEOCODING_UNAVAILABLE",
        );
      }

      console.error("Erro ao buscar CEP:", error);

      return sendError(
        res,
        500,
        "Erro interno ao buscar o CEP.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = localizacaoController;
