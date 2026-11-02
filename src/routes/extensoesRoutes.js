const express = require("express");

const extensoesController = require("../controllers/extensoesController");

const router = express.Router();

/*
 * Rotas SEM login: o segredo é o token do link enviado por e-mail ao
 * caçambeiro (256 bits, guardado só como hash no banco).
 *
 * O GET só mostra a página; a decisão acontece no POST, para que
 * leitores de e-mail e antivírus que abrem links não aceitem nada.
 */

// Formulário da página usa application/x-www-form-urlencoded.
const formulario = express.urlencoded({
  extended: false,
  limit: "2kb",
});

router.get("/resposta/:token", extensoesController.paginaResposta);

router.post(
  "/resposta/:token",
  formulario,
  extensoesController.confirmarResposta,
);

module.exports = router;
