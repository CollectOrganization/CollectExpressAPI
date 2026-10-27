const express = require("express");
const router = express.Router();
const materiaisController = require("../controllers/materiaisController");
const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");

// Lista pública de materiais.
router.get("/", materiaisController.listar);

// Detalhe público de um material.
// O uuidParam é validado antes de chegar ao controller.
router.get(
  "/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  materiaisController.detalhe,
);

module.exports = router;