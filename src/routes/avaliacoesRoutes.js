const express = require("express");
const router = express.Router();
const avaliacoesController = require("../controllers/avaliacoesController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");

// POST /api/avaliacoes - Consumidor submete avaliação (requer CONSUMIDOR)
/*router.post(
  "/",
  authMiddleware,
  roleMiddleware(["CONSUMIDOR"]),
  avaliacoesController.criar
);*/
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.createReview),
  avaliacoesController.criar,
);


// GET /api/avaliacoes/cacambeiro/:id - Lista avaliações de um caçambeiro (Público)
/*router.get(
  "/cacambeiro/:id",
  avaliacoesController.listarPorCacambeiro
);*/
router.get(
  "/cacambeiro/:id",
  validationMiddleware(
    schemas.cacambeiroReviewParam,
    "params",
  ),
  avaliacoesController.listarPorCacambeiro,
);

module.exports = router;
