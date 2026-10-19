const express = require("express");
const router = express.Router();
const carrinhoController = require("../controllers/carrinhoController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");

// Todas as rotas do carrinho requerem autenticação + perfil CONSUMIDOR
router.use(authMiddleware);
router.use(roleMiddleware(["CONSUMIDOR"]));

// GET /api/carrinho - Obter carrinho do consumidor
router.get("/", carrinhoController.obter);

// POST /api/carrinho/itens - Adicionar item ao carrinho
// Adiciona uma caçamba ao carrinho.
// Valida UUID, quantidade e período de aluguel.
/*router.post("/itens", carrinhoController.adicionarItem);*/
router.post(
  "/itens",
  validationMiddleware(schemas.createCartItem),
  carrinhoController.adicionarItem,
);

// PUT /api/carrinho/itens/:id - Atualizar quantidade de um item
// Atualiza quantidade e/ou dias de aluguel.
// Exige pelo menos um dos dois campos.
/*router.put("/itens/:id", carrinhoController.atualizarItem);*/
router.put(
  "/itens/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  validationMiddleware(
    schemas.updateCartItem,
    "body",
    {
      atLeastOne: ["quantidade", "dias_aluguel"],
    },
  ),
  carrinhoController.atualizarItem,
);

// DELETE /api/carrinho/itens/:id - Remover item específico do carrinho
/*router.delete("/itens/:id", carrinhoController.removerItem);*/
router.delete(
  "/itens/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  carrinhoController.removerItem,
);

// DELETE /api/carrinho - Limpar carrinho
/*router.delete("/", carrinhoController.limpar);*/
router.delete(
  "/",
  carrinhoController.limpar,
);

module.exports = router;
