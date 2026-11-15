const express = require("express");

const ofertasColetaController = require("../controllers/ofertasColetaController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");
const { uploadJson } = require("../middlewares/uploadBody");

const router = express.Router();

router.use(authMiddleware);

const uuid = validationMiddleware(schemas.uuidParam, "params");
const quemEntrega = roleMiddleware(["CONSUMIDOR", "CACAMBEIRO"]);
const parceiro = roleMiddleware(["PARCEIRO"]);

// Quem tem o material sinaliza (cliente ou caçambeiro).
router.post(
  "/",
  quemEntrega,
  uploadJson,
  validationMiddleware(schemas.recyclingOffer),
  ofertasColetaController.criar,
);
router.get("/minhas", quemEntrega, ofertasColetaController.minhas);
router.patch(
  "/:id/cancelar",
  quemEntrega,
  uuid,
  ofertasColetaController.cancelar,
);

// O parceiro aprovado escolhe.
router.get("/", parceiro, ofertasColetaController.disponiveis);
router.get("/:id", parceiro, uuid, ofertasColetaController.detalhe);

module.exports = router;
