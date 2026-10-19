const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");

// Todas as rotas deste arquivo exigem autenticação
// e perfil administrativo.
router.use(authMiddleware);
router.use(roleMiddleware(['ADMIN']));


// Retorna métricas gerais da plataforma.
router.get("/dashboard", adminController.dashboard);

// Categorias CRUD

// Lista categorias e a quantidade de caçambas associadas.
router.get("/categorias", adminController.listarCategorias);

// Cria uma categoria.
// O nome é obrigatório e deve ser único.
//router.post("/categorias", adminController.criarCategoria);
router.post(
  "/categorias",
  validationMiddleware(schemas.category),
  adminController.criarCategoria,
);

// Atualiza uma categoria existente.
//router.put("/categorias/:id", adminController.atualizarCategoria);
router.put(
  "/categorias/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  validationMiddleware(schemas.category),
  adminController.atualizarCategoria,
);

// Remove uma categoria.
// A remoção é bloqueada quando existem caçambas associadas.
//router.delete("/categorias/:id", adminController.removerCategoria);
router.delete(
  "/categorias/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  adminController.removerCategoria,
);

module.exports = router;
