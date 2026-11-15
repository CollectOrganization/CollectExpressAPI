const express = require("express");

const parceirosController = require("../controllers/parceirosController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");
const { uploadJson } = require("../middlewares/uploadBody");

const router = express.Router();

// Perfil do parceiro de reciclagem (aprovado por um admin).
router.use(authMiddleware, roleMiddleware(["PARCEIRO"]));

router.get("/me", parceirosController.obter);
router.put("/me", parceirosController.atualizar);

router.get("/me/area", parceirosController.obterArea);
router.put(
  "/me/area",
  validationMiddleware(schemas.updateServiceArea),
  parceirosController.salvarArea,
);

router.get("/me/pendencias", parceirosController.pendencias);

router.get("/me/assinatura", parceirosController.obterAssinatura);
router.put(
  "/me/assinatura",
  uploadJson,
  validationMiddleware(schemas.uploadAssinatura),
  parceirosController.salvarAssinatura,
);
router.delete("/me/assinatura", parceirosController.removerAssinatura);

module.exports = router;
