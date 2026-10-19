const express = require("express");
const router = express.Router();
const enderecosController = require("../controllers/enderecosController");
const authMiddleware = require("../middlewares/authMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");

// Todas as rotas de endereço exigem autenticação
router.use(authMiddleware);

// GET /api/enderecos - Lista endereços do usuário autenticado
router.get(
    "/", 
    enderecosController.listar
);

// POST /api/enderecos - Cria novo endereço para o usuário autenticado
// Cria um endereço para o usuário autenticado.
// CEP deve possuir exatamente oito dígitos. 
/*router.post(
    "/", 
    enderecosController.criar
);
*/
router.post(
  "/",
  validationMiddleware(schemas.createAddress),
  enderecosController.criar,
);


// DELETE /api/enderecos/:id - Remove endereço (verifica ownership + pedidos ativos)
// Remove um endereço pertencente ao usuário.
// A remoção é bloqueada quando existem pedidos ativos vinculados.
/*router.delete("/:id", enderecosController.remover);*/
router.delete(
  "/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  enderecosController.remover,
);

module.exports = router;
