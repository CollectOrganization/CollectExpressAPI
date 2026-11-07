const express = require("express");
const router = express.Router();
const cacambeirosController = require("../controllers/cacambeirosController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require("../middlewares/validationMiddleware",);
const schemas = require("../validators/requestSchemas");

const avaliacoesController = require("../controllers/avaliacoesController");
const assinaturasController = require("../controllers/assinaturasController");
const areaAtendimentoController = require("../controllers/areaAtendimentoController");
const { uploadJson } = require("../middlewares/uploadBody");

// Rotas autenticadas do caçambeiro (antes de /:id para evitar conflito)
router.get("/dashboard", authMiddleware, roleMiddleware(['CACAMBEIRO']), cacambeirosController.dashboard);
router.get("/financeiro", authMiddleware, roleMiddleware(['CACAMBEIRO']), cacambeirosController.financeiro);

// Área de atendimento (cerca virtual circular) e pendências de cadastro.
router.get(
  "/me/area",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  areaAtendimentoController.obter,
);
router.put(
  "/me/area",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(schemas.updateServiceArea),
  areaAtendimentoController.salvar,
);
router.get(
  "/me/pendencias",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  areaAtendimentoController.pendencias,
);

// Assinatura padrão da empresa, usada nos contratos de locação.
router.get(
  "/me/assinatura",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  assinaturasController.obter,
);
router.put(
  "/me/assinatura",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  uploadJson,
  validationMiddleware(schemas.uploadAssinatura),
  assinaturasController.salvar,
);
router.delete(
  "/me/assinatura",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  assinaturasController.remover,
);

// Rotas públicas para consumidores verem os fornecedores
router.get("/", cacambeirosController.listar);
//router.get("/:id", cacambeirosController.buscarPorId);
router.get(
  "/:id",
  validationMiddleware(
    schemas.uuidParam,
    "params",
  ),
  cacambeirosController.buscarPorId,
);


// Rota pública para listar as avaliações de um fornecedor
/*router.get("/:id_cacambeiro/avaliacoes", avaliacoesController.listarPorCacambeiro);*/
router.get(
  "/:id/avaliacoes",
  validationMiddleware(schemas.uuidParam, "params"),
  avaliacoesController.listarPorCacambeiro,
);



module.exports = router;