const express = require("express");
const rateLimit = require("express-rate-limit");

const localizacaoController = require("../controllers/localizacaoController");

const router = express.Router();

/*
 * Rota pública que consulta serviços gratuitos de terceiros. O limite
 * por IP protege esses serviços (e o nosso nome neles) contra abuso.
 */
const limiteDeCep = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    return res.status(429).json({
      success: false,
      message: "Muitas consultas de CEP. Tente novamente em 1 minuto.",
      code: "CEP_RATE_LIMIT_EXCEEDED",
    });
  },
});

router.get("/cep/:cep", limiteDeCep, localizacaoController.buscarCep);

module.exports = router;
