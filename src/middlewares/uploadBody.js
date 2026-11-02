const express = require("express");

/*
 * O parser global aceita só 100 KB. Rotas que recebem imagens em base64
 * (fotos de caçamba, assinaturas) precisam de um limite maior.
 *
 * O limite maior só vale depois da autenticação: o parser global pula
 * estas rotas e cada rota declara `uploadJson` depois de
 * authMiddleware/roleMiddleware. Assim, uma requisição anônima nunca
 * tem o corpo grande lido.
 *
 * Toda rota listada aqui DEVE usar `uploadJson` na sua cadeia.
 */
const LIMITE_UPLOAD = "3mb";

const ROTAS_COM_UPLOAD = [
  { metodo: "POST", caminho: /^\/api\/cacambas\/?$/ },
  { metodo: "PUT", caminho: /^\/api\/cacambas\/[^/]+\/?$/ },
  { metodo: "PUT", caminho: /^\/api\/cacambeiros\/me\/assinatura\/?$/ },
  { metodo: "POST", caminho: /^\/api\/alugueis\/checkout\/?$/ },
];

function ehRotaDeUpload(req) {
  return ROTAS_COM_UPLOAD.some(
    (rota) =>
      rota.metodo === req.method && rota.caminho.test(req.path),
  );
}

/** Parser padrão para todas as rotas, exceto as de upload. */
function criarParserGlobal(limite = "100kb") {
  const parser = express.json({ limit: limite });

  return function parserGlobal(req, res, next) {
    if (ehRotaDeUpload(req)) {
      return next();
    }

    return parser(req, res, next);
  };
}

const uploadJson = express.json({ limit: LIMITE_UPLOAD });

module.exports = {
  ROTAS_COM_UPLOAD,
  ehRotaDeUpload,
  criarParserGlobal,
  uploadJson,
};
