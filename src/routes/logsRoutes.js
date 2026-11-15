const express = require("express");
const rateLimit = require("express-rate-limit");

const logsController = require("../controllers/logsController");

const router = express.Router();

// Rota pública: limitada por IP para ninguém encher a tabela de logs.
const limiteDeLogs = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    return res.status(202).json({
      success: true,
      data: { registrado: false },
    });
  },
});

router.post("/app", limiteDeLogs, logsController.registrarDoApp);

module.exports = router;
