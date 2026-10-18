const express = require("express");
const router = express.Router();
const usuariosController = require("../controllers/usuariosController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

// Rotas de perfil (autenticadas) - devem vir antes de rotas com parâmetros
router.get(
  "/perfil",
  authMiddleware,
  usuariosController.getPerfil,
);
router.put(
  "/perfil",
  authMiddleware,
  usuariosController.updatePerfil,
);

// Rotas administrativas (ADMIN) - devem vir após /perfil e antes de POST /
router.get(
  "/",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  usuariosController.listarUsuarios,
);

router.get(
  "/:id",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  usuariosController.detalheUsuario,
);

// Rota: POST /api/usuarios
// Objetivo: Cadastrar um novo usuário
router.post("/",  authMiddleware,  roleMiddleware(["ADMIN"]),  usuariosController.criarAdmin,);

router.post(
  "/admin",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  usuariosController.criarAdmin,
);

// Espaço reservado para as próximas rotas:
// router.get("/:id", usuariosController.buscarPorId);
// router.put("/:id", usuariosController.atualizar);

module.exports = router;