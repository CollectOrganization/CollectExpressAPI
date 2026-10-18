require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const ApiError = require("./utils/apiError");

const {
  notFoundMiddleware,
  errorMiddleware,
} = require("./middlewares/errorMiddleware");

// Importação das rotas

const authRoutes = require("./routes/authRoutes");
const usuariosRoutes = require("./routes/usuariosRoutes");
const cacambasRoutes = require("./routes/cacambasRoutes");
const enderecosRoutes = require("./routes/enderecosRoutes");
const cacambeirosRoutes = require("./routes/cacambeirosRoutes");
const carrinhoRoutes = require("./routes/carrinhoRoutes");
const alugueisRoutes = require("./routes/alugueisRoutes");
const avaliacoesRoutes = require("./routes/avaliacoesRoutes");
const adminRoutes = require("./routes/adminRoutes");
const parceirosRoutes = require("./routes/parceirosRoutes");
const coletasRoutes = require("./routes/coletasRoutes");

// Cria a limpeza dos tokens
const {startTokenCleanup,} = require("./services/tokenCleanupService");

// Inicializa o Express
const app = express();

/**
 * Remove o header "X-Powered-By".
 *
 * Isso evita expor desnecessariamente que o servidor utiliza Express.
 */
app.disable("x-powered-by");

/**
 * Informa ao Express que a aplicação poderá executar atrás de um proxy,
 * como acontece no Render e no GitHub Codespaces.
 *
 * Isso é importante para:
 * - identificação correta do IP;
 * - rate limit;
 * - protocolo HTTPS atrás de proxy.
 */
app.set("trust proxy", 1);

/**
 * Adiciona headers HTTP de segurança.
 *
 * A política cross-origin permite carregar recursos, como imagens,
 * em origens diferentes quando necessário.
 */
app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  }),
);

/**
 * Configuração de CORS.
 *
 * Apenas origens explicitamente permitidas, rede local e URLs do
 * GitHub Codespaces poderão acessar a API pelo navegador.
 */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  "https://collectexpress.onrender.com",
  "http://localhost:8081",
  "http://localhost:3000",
].filter(Boolean);

function isAllowedOrigin(origin) {
  // Requisições feitas por curl, Postman e aplicações mobile
  // normalmente não enviam o header Origin.
  if (!origin) {
    return true;
  }

  if (
    allowedOrigins.includes(origin) ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")
  ) {
    return true;
  }

  // Permite desenvolvimento em dispositivos da rede local.
  const isLocalNetwork =
    /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/.test(origin);

  if (isLocalNetwork) {
    return true;
  }

  // Permite URLs encaminhadas pelo GitHub Codespaces.
  const isGitHubCodespaces =
    /^https:\/\/[a-zA-Z0-9-]+-\d+\.app\.github\.dev$/.test(origin);

  return isGitHubCodespaces;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(
        new ApiError(
          403,
          "Origem não permitida pelo servidor.",
          "CORS_ORIGIN_DENIED",
        ),
      );
    },
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  }),
);

/**
 * Rate limit global.
 *
 * Cada IP poderá realizar no máximo 100 requisições por minuto.
 * Login, cadastro e recuperação de senha também terão limitadores
 * específicos definidos em authRoutes.js.
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    return res.status(429).json({
      success: false,
      message:
        "Muitas requisições deste IP. Tente novamente em 1 minuto.",
      code: "GLOBAL_RATE_LIMIT_EXCEEDED",
    });
  },
});

app.use(globalLimiter);

/**
 * Permite receber JSON, mas limita o corpo a 100 KB.
 *
 * Isso reduz o risco de consumo excessivo de memória por payloads
 * muito grandes.
 */
app.use(
  express.json({
    limit: "100kb",
  }),
);

/**
 * Rota raiz.
 */
app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      status: "ok",
      message: "CollectExpress API online",
      health: "/api/health",
    },
  });
});

/**
 * Health check.
 */
app.get("/api/health", (req, res) => {
  return res.status(200).json({
    success: true,
    data: {
      status: "ok",
      message: "API de Caçambas operando normalmente! 🚀",
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * Definição dos endpoints.
 */
app.use("/api/auth", authRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/cacambas", cacambasRoutes);
app.use("/api/enderecos", enderecosRoutes);
app.use("/api/cacambeiros", cacambeirosRoutes);
app.use("/api/carrinho", carrinhoRoutes);
app.use("/api/alugueis", alugueisRoutes);
app.use("/api/avaliacoes", avaliacoesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/parceiros", parceirosRoutes);
app.use("/api/coletas", coletasRoutes);

/**
 * Estes middlewares devem permanecer depois de todas as rotas.
 */

// Resposta para endpoint inexistente.
app.use(notFoundMiddleware);

// Tratamento global de erros.
app.use(errorMiddleware);

/**
 * Inicialização do servidor.
 */
const PORT = Number(process.env.PORT) || 3000;

// Inicializa o token cleanup
startTokenCleanup();

app.listen(PORT, () => {
  console.log(`API disponível em http://localhost:${PORT}/api`);
});