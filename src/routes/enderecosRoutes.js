const express = require("express");

const enderecosController = require(
  "../controllers/enderecosController",
);
const authMiddleware = require(
  "../middlewares/authMiddleware",
);
const validationMiddleware = require(
  "../middlewares/validationMiddleware",
);
const schemas = require(
  "../validators/requestSchemas",
);

const router = express.Router();

/*
 * Todas as rotas de endereço exigem autenticação.
 * O ID do proprietário é sempre obtido do JWT.
 */
router.use(authMiddleware);

/**
 * GET /api/enderecos
 * Lista os endereços do usuário autenticado.
 */
router.get("/", enderecosController.listar,);

/**
 * POST /api/enderecos
 * Cria um endereço para o usuário autenticado.
 */
router.post(
  "/",
  validationMiddleware(schemas.createAddress),
  enderecosController.criar,
);

/**
 * PUT /api/enderecos/:id
 * Atualiza um endereço pertencente ao usuário autenticado.
 */
router.put(
  "enderecos/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  validationMiddleware(schemas.updateAddress),
  enderecosController.atualizar,
);

/**
 * DELETE /api/enderecos/:id
 * Remove um endereço pertencente ao usuário autenticado.
 */
router.delete(
  "/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  enderecosController.remover,
);

module.exports = router;