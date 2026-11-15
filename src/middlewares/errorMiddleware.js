const ApiError = require("../utils/apiError");

function notFoundMiddleware(req, res) {
  return res.status(404).json({
    success: false,
    message: "Endpoint não encontrado.",
    code: "NOT_FOUND",
  });
}

function errorMiddleware(error, req, res, next) {
  // Erro de regra de negócio (4xx) é esperado e já fica em logs_erros
  // pela resposta; só falhas inesperadas vão para o console.
  const esperado =
    (error instanceof ApiError && error.statusCode < 500) ||
    error.type === "entity.too.large" ||
    error.type === "entity.parse.failed";

  if (!esperado) {
    console.error(error);
  }

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      code: error.code,
      ...(error.fields ? { fields: error.fields } : {}),
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "O corpo da requisição excede o limite permitido.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }

  // JSON malformado no corpo: erro de quem chamou, não do servidor.
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "O corpo da requisição não é um JSON válido.",
      code: "INVALID_JSON",
    });
  }

  return res.status(500).json({
    success: false,
    message: "Erro interno no servidor.",
    code: "INTERNAL_SERVER_ERROR",
  });
}

module.exports = {
  notFoundMiddleware,
  errorMiddleware,
};