const express = require("express");
const router = express.Router();
const coletasController = require("../controllers/coletasController");
const authMiddleware = require("../middlewares/authMiddleware");

// --- Rotas protegidas (Requerem autenticação) ---
router.use(authMiddleware);

// Rota: POST /api/coletas
// Objetivo: Consumidor agenda uma nova coleta
router.post("/", coletasController.agendar);

// Rota: GET /api/coletas
// Objetivo: Listar as coletas do usuário logado (consumidor ou parceiro)
router.get("/", coletasController.listar);

// Rota: PUT /api/coletas/:id/status
// Objetivo: Atualizar o status de uma coleta (parceiro)
router.put("/:id/status", coletasController.atualizarStatus);

module.exports = router;
