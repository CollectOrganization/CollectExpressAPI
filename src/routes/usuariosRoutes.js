const express = require("express");
const router = express.Router();

const usuariosController = require("../controllers/usuariosController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");

const validationMiddleware = require("../middlewares/validationMiddleware",);

const schemas = require("../validators/requestSchemas");

// Rotas de perfil (autenticadas) - devem vir antes de rotas com parâmetros
router.get(
  "/perfil",
  authMiddleware,
  usuariosController.getPerfil,
);
/*
router.put(
  "/perfil",
  authMiddleware,
  usuariosController.updatePerfil,
);*/
router.put(
  "/perfil",
  authMiddleware,
  validationMiddleware(
    schemas.updateProfile,
    "body",
    {
      atLeastOne: ["nome_completo", "telefone"],
    },
  ),
  usuariosController.updatePerfil,
);

/**
 * Somente o proprietário autenticado pode alterar sua senha.
 *
 * Não existe parâmetro de usuário na URL para evitar alteração
 * da senha de terceiros.
 */
router.patch(
  "/senha",
  authMiddleware,
  validationMiddleware(schemas.changePassword),
  usuariosController.alterarSenha,
);

// Rotas administrativas (ADMIN) - devem vir após /perfil e antes de POST /
router.get(
  "/",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  usuariosController.listarUsuarios,
);

// Rota: POST /api/usuarios
// Objetivo: Cadastrar um novo usuário
/*router.post(
  "/",  
  authMiddleware,  
  roleMiddleware(["ADMIN"]),  
  usuariosController.criarAdmin,
);
router.post(
  "/admin",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  usuariosController.criarAdmin,
);
*/
router.post(
  "/admin",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  validationMiddleware(schemas.createAdmin),
  usuariosController.criarAdmin,
);

/*
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  usuariosController.detalheUsuario,
);
*/
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware(["ADMIN"]),
  validationMiddleware(schemas.uuidParam, "params"),
  usuariosController.detalheUsuario,
);

// Espaço reservado para as próximas rotas:
// router.get("/:id", usuariosController.buscarPorId);
// router.put("/:id", usuariosController.atualizar);

module.exports = router;