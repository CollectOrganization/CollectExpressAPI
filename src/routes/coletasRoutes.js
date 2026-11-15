const express = require("express");
const rateLimit = require("express-rate-limit");

const coletasController = require("../controllers/coletasController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");

const router = express.Router();

/*
 * Verificação de documentos: pública, então limitada por IP para
 * ninguém ficar testando códigos de autenticação.
 */
const limiteDeVerificacao = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    return res.status(429).json({
      success: false,
      message: "Muitas verificações em pouco tempo. Tente em 1 minuto.",
      code: "VERIFY_RATE_LIMIT_EXCEEDED",
    });
  },
});

router.get(
  "/verificar/:codigo",
  limiteDeVerificacao,
  coletasController.verificar,
);

router.use(authMiddleware);

const uuid = validationMiddleware(schemas.uuidParam, "params");
const todosOsPerfis = roleMiddleware([
  "CONSUMIDOR",
  "CACAMBEIRO",
  "PARCEIRO",
  "ADMIN",
]);

router.post(
  "/",
  roleMiddleware(["PARCEIRO"]),
  validationMiddleware(schemas.scheduleCollection),
  coletasController.agendar,
);

router.get("/resumo", roleMiddleware(["CONSUMIDOR", "CACAMBEIRO", "PARCEIRO"]), coletasController.resumo);
router.get("/", todosOsPerfis, coletasController.listar);
router.get("/:id", todosOsPerfis, uuid, coletasController.detalhe);
router.get("/:id/documento", todosOsPerfis, uuid, coletasController.documento);

router.patch("/:id/cancelar", todosOsPerfis, uuid, coletasController.cancelar);
router.patch(
  "/:id/concluir",
  roleMiddleware(["PARCEIRO"]),
  uuid,
  coletasController.concluir,
);

module.exports = router;
