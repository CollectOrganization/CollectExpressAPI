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
const pagamentosController = require("../controllers/pagamentosController");
const contratosController = require("../controllers/contratosController");
const extensoesController = require("../controllers/extensoesController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const { uploadJson } = require("../middlewares/uploadBody");
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

// CONSUMIDOR: finaliza o carrinho. Exige aceite dos termos e a
// assinatura desenhada (PNG em base64, corpo de até 3 MB).
router.post(
  "/checkout",
  roleMiddleware(["CONSUMIDOR"]),
  uploadJson,
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

// CONSUMIDOR: pagamento do pedido por PIX (AbacatePay).
router.post(
  "/:id/pix",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.uuidParam, "params"),
  pagamentosController.gerarPix,
);

router.get(
  "/:id/pix",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.uuidParam, "params"),
  pagamentosController.consultarPix,
);

// Só com a chave do modo de teste da AbacatePay.
router.post(
  "/:id/pix/simular",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.uuidParam, "params"),
  pagamentosController.simularPix,
);

// Contrato de locação em PDF (dono do pedido ou ADMIN).
router.get(
  "/:id/contrato",
  roleMiddleware(["CONSUMIDOR", "CACAMBEIRO", "ADMIN"]),
  validationMiddleware(schemas.uuidParam, "params"),
  contratosController.baixar,
);

// Extensão do aluguel.
router.get(
  "/:id/extensoes",
  roleMiddleware(["CONSUMIDOR", "CACAMBEIRO", "ADMIN"]),
  validationMiddleware(schemas.uuidParam, "params"),
  extensoesController.listar,
);

router.post(
  "/:id/extensoes",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.uuidParam, "params"),
  validationMiddleware(schemas.requestExtension),
  extensoesController.solicitar,
);

router.patch(
  "/:id/extensoes/:extId",
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(schemas.extensionParams, "params"),
  validationMiddleware(schemas.respondExtension),
  extensoesController.responder,
);

// Pagamento da extensão aceita (PIX, 24 h).
router.post(
  "/:id/extensoes/:extId/pix",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.extensionParams, "params"),
  pagamentosController.gerarPixExtensao,
);

router.get(
  "/:id/extensoes/:extId/pix",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.extensionParams, "params"),
  pagamentosController.consultarPixExtensao,
);

router.post(
  "/:id/extensoes/:extId/pix/simular",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.extensionParams, "params"),
  pagamentosController.simularPixExtensao,
);

module.exports = router;