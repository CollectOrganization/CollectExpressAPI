const express = require("express");

const router = express.Router();
const cacambasController = require("../controllers/cacambasController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require("../middlewares/validationMiddleware");

const schemas = require("../validators/requestSchemas");

// Schema de validação para criação de caçamba
const criarCacambaSchema = {
  nome: {
    required: true,
    type: "string",
    minLength: 1,
    maxLength: 100
  },
  foto_url: {
    required: false,
    type: "string",
    pattern: "^https:\\/\\/.*"
  },
  tipo_residuo: {
    required: true,
    type: "string",
    minLength: 1,
    maxLength: 50
  },
  tamanho_m3: {
    required: true,
    type: "number",
    min: 0.01,
    max: 999.99
  },
  preco_diaria: {
    required: true,
    type: "number",
    min: 0.01,
    max: 99999999.99
  }
};

// --- Rotas públicas (leitura) ---

// Rota: GET /api/cacambas
// Objetivo: Listar caçambas disponíveis no marketplace (público)
router.get(
  "/", 
  cacambasController.listar
);

// Rota: GET /api/cacambas/:id
// Objetivo: Detalhes completos da caçamba com info do cacambeiro e avaliações (público)
/*router.get(
  "/:id", 
  cacambasController.detalhe
);*/
router.get(
  "/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  cacambasController.detalhe,
);

// --- Rotas protegidas (Requerem autenticação) ---
router.use(authMiddleware);

router.get(
  "/minhas",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  cacambasController.minhas,
);


// --- Rotas que requerem perfil CACAMBEIRO ---

// Rota: POST /api/cacambas
// Objetivo: Criar nova caçamba
/*router.post(
  "/",
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(criarCacambaSchema),
  cacambasController.criar
);*/
// Cadastra uma nova caçamba.
// Exclusivo para fornecedores autenticados.
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(schemas.createDumpster),
  cacambasController.criar,
);

// Rota: PUT /api/cacambas/:id
// Objetivo: Atualizar caçamba (apenas dono)
/*router.put(
  "/:id",
  roleMiddleware(["CACAMBEIRO"]),
  cacambasController.atualizar
);*/
// Atualiza uma caçamba.
// O controller também verifica se ela pertence ao fornecedor.
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(schemas.uuidParam, "params"),
  validationMiddleware(
    schemas.updateDumpster,
    "body",
    {
      atLeastOne: [
        "nome",
        "foto_url",
        "tipo_residuo",
        "tamanho_m3",
        "preco_diaria",
        "disponivel",
      ],
    },
  ),
  cacambasController.atualizar,
);


// Rota: DELETE /api/cacambas/:id
// Objetivo: Remover caçamba (apenas dono, sem pedidos ativos)
/*router.delete(
  "/:id",
  roleMiddleware(["CACAMBEIRO"]),
  cacambasController.remover
);*/
// Remove uma caçamba pertencente ao fornecedor.
// A remoção é bloqueada quando existem pedidos ativos.
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  validationMiddleware(schemas.uuidParam, "params"),
  cacambasController.remover,
);


// Lista todas as caçambas do fornecedor autenticado,
// incluindo indisponíveis e em manutenção.
/*router.get(
  "/minhas",
  authMiddleware,
  roleMiddleware(["CACAMBEIRO"]),
  cacambasController.minhas,
);*/

// Retorna os detalhes públicos de uma caçamba.
// Deve ficar depois de /minhas para evitar conflito de rotas.
router.get(
  "/:id",
  validationMiddleware(schemas.uuidParam, "params"),
  cacambasController.detalhe,
);

module.exports = router;
