/*const express = require("express");
const router = express.Router();
const alugueisController = require("../controllers/alugueisController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

// Todas as rotas de alugueis exigem autenticação
router.use(authMiddleware);

// Admin - Gestão de todos os pedidos
router.get("/", roleMiddleware(["ADMIN"]), alugueisController.listarTodos);

// Consumidor - Checkout e meus pedidos
//router.post("/checkout", roleMiddleware(["CONSUMIDOR"]), alugueisController.checkout);
router.post(
  "/checkout",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.checkout),
  alugueisController.checkout,
);
router.get("/meus", roleMiddleware(["CONSUMIDOR"]), alugueisController.meusPedidos);

// Caçambeiro - Gestão de pedidos
router.get("/gestao", roleMiddleware(["CACAMBEIRO"]), alugueisController.gestaoPedidos);
//router.patch("/:id/status", roleMiddleware(["CACAMBEIRO"]), alugueisController.atualizarStatus);
router.patch(
  "/:id/status",
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(schemas.uuidParam, "params"),
  validationMiddleware(schemas.updateOrderStatus),
  alugueisController.atualizarStatus,
);

module.exports = router;
*/

const express = require("express");

const alugueisController = require("../controllers/alugueisController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require(
  "../middlewares/validationMiddleware",
);
const schemas = require("../validators/requestSchemas");

const router = express.Router();

// Todas as rotas exigem autenticação.
router.use(authMiddleware);

// ADMIN: lista todos os pedidos.
router.get(
  "/",
  roleMiddleware(["ADMIN"]),
  alugueisController.listarTodos,
);

// CONSUMIDOR: finaliza o carrinho.
router.post(
  "/checkout",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.checkout),
  alugueisController.checkout,
);

// CONSUMIDOR: visualiza os próprios pedidos.
router.get(
  "/meus",
  roleMiddleware(["CONSUMIDOR"]),
  alugueisController.meusPedidos,
);

// CACAMBEIRO: visualiza pedidos recebidos.
router.get(
  "/gestao",
  roleMiddleware(["CACAMBEIRO"]),
  alugueisController.gestaoPedidos,
);

// Detalhe de um pedido.
// O controller aplica as regras de propriedade conforme o perfil.
router.get(
  "/:id",
  roleMiddleware([
    "CONSUMIDOR",
    "CACAMBEIRO",
    "ADMIN",
  ]),
  validationMiddleware(schemas.uuidParam, "params"),
  alugueisController.detalhe,
);

// CACAMBEIRO: atualiza o status do pedido.
router.patch(
  "/:id/status",
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(schemas.uuidParam, "params"),
  validationMiddleware(schemas.updateOrderStatus),
  alugueisController.atualizarStatus,
);

module.exports = router;