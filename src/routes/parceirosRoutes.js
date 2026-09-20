const express = require("express");
const router = express.Router();
const parceirosController = require("../controllers/parceirosController");
const authMiddleware = require("../middlewares/authMiddleware");

// --- Rotas públicas ---
// Rota: GET /api/parceiros
// Objetivo: Listar parceiros de reciclagem disponíveis
router.get("/", parceirosController.listar);

// Rota: GET /api/parceiros/:id
// Objetivo: Ver detalhes de um parceiro de reciclagem específico
router.get("/:id", parceirosController.detalhes);

// --- Rotas protegidas (Requerem autenticação) ---
router.use(authMiddleware);

// Rota: POST /api/parceiros/perfil
// Objetivo: Criar ou atualizar perfil de parceiro para o usuário logado
router.post("/perfil", parceirosController.salvarPerfil);

module.exports = router;
