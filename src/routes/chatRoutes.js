const express = require("express");
const rateLimit = require("express-rate-limit");

const chatController = require("../controllers/chatController");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const validationMiddleware = require("../middlewares/validationMiddleware");
const schemas = require("../validators/requestSchemas");

const router = express.Router();

/*
 * Limite por usuário (a rota já exige login), para o chat não virar
 * canal de spam. Folgado para uma conversa normal.
 */
const limiteDeMensagens = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => String(req.usuario_id),
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    return res.status(429).json({
      success: false,
      message: "Muitas mensagens em pouco tempo. Aguarde um instante.",
      code: "CHAT_RATE_LIMIT_EXCEEDED",
    });
  },
});

const uuid = validationMiddleware(schemas.uuidParam, "params");

router.use(authMiddleware);

router.get(
  "/conversas",
  validationMiddleware(schemas.chatListQuery, "query"),
  chatController.listar,
);

router.get("/nao-lidas", chatController.naoLidas);

router.get("/conversas/:id", uuid, chatController.detalhe);

router.get("/conversas/:id/mensagens", uuid, chatController.mensagens);

router.post(
  "/conversas/:id/mensagens",
  uuid,
  limiteDeMensagens,
  validationMiddleware(schemas.chatSendMessage),
  chatController.enviar,
);

router.post(
  "/conversas/:id/denunciar",
  uuid,
  validationMiddleware(schemas.chatReport),
  chatController.denunciar,
);

router.patch(
  "/conversas/:id/denuncia",
  roleMiddleware(["ADMIN"]),
  uuid,
  chatController.resolverDenuncia,
);

router.post(
  "/pedidos/:id/conversa",
  roleMiddleware(["CONSUMIDOR", "CACAMBEIRO", "ADMIN"]),
  uuid,
  chatController.conversaDoPedido,
);

router.post(
  "/chamados",
  roleMiddleware(["CONSUMIDOR"]),
  validationMiddleware(schemas.chatOpenTicket),
  chatController.abrirChamado,
);

router.patch(
  "/chamados/:id/fechar",
  roleMiddleware(["ADMIN"]),
  uuid,
  chatController.fecharChamado,
);

module.exports = router;
