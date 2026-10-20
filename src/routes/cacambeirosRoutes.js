const express = require("express");
const router = express.Router();
const cacambeirosController = require("../controllers/cacambeirosController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require("../middlewares/validationMiddleware",);
const schemas = require("../validators/requestSchemas");

const avaliacoesController = require("../controllers/avaliacoesController");

// Rotas autenticadas do caçambeiro (antes de /:id para evitar conflito)
router.get("/dashboard", authMiddleware, roleMiddleware(['CACAMBEIRO']), cacambeirosController.dashboard);
router.get("/financeiro", authMiddleware, roleMiddleware(['CACAMBEIRO']), cacambeirosController.financeiro);

// Rota pública para listar as avaliações de um fornecedor
/*router.get("/:id_cacambeiro/avaliacoes", avaliacoesController.listarPorCacambeiro);*/
router.get(
  "/:id/avaliacoes",
  validationMiddleware(schemas.uuidParam, "params"),
  avaliacoesController.listarPorCacambeiro,
);

// Rotas públicas para consumidores verem os fornecedores
router.get("/", cacambeirosController.listar);
router.get("/:id", cacambeirosController.buscarPorId);





module.exports = router;