require("dotenv").config();

// Antes de tudo: o que o código mandar para console.error/warn também vai
// para a tabela logs_erros (veja services/logService.js).
const logService = require("./services/logService");
logService.instalarCapturaDoConsole();

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
const materiaisRoutes = require("./routes/materiaisRoutes");
const parceirosRoutes = require("./routes/parceirosRoutes");
const coletasRoutes = require("./routes/coletasRoutes");
const extensoesRoutes = require("./routes/extensoesRoutes");
const localizacaoRoutes = require("./routes/localizacaoRoutes");
const chatRoutes = require("./routes/chatRoutes");
const ofertasColetaRoutes = require("./routes/ofertasColetaRoutes");
const logsRoutes = require("./routes/logsRoutes");
const reciclagemController = require("./controllers/reciclagemJobController");
const { iniciarVarreduraDeReciclagem } = require("./services/reciclagemService");
const chatController = require("./controllers/chatController");
const { iniciarVarreduraDoChat } = require("./services/chatService");
const extensoesController = require("./controllers/extensoesController");

// Cria a limpeza dos tokens
const {startTokenCleanup,} = require("./services/tokenCleanupService");
const {
  pastaPublica,
  servirUploadDoBanco,
  sincronizarDiscoComBanco,
} = require("./services/storageService");
const {
  iniciarVarreduraDeExtensoes,
} = require("./services/extensaoService");
const { criarParserGlobal } = require("./middlewares/uploadBody");

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
 * Registra respostas com erro (400 ou mais) e requisições lentas em
 * logs_erros, e guarda o contexto da requisição para os demais logs.
 */
app.use(logService.logMiddleware);

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
  // A página de resposta de extensão envia um formulário da própria API.
  process.env.PUBLIC_API_URL,
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
    origin.startsWith("http://127.0.0.1:") ||
    origin.endsWith(".onrender.com")
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
 * Cada IP poderá realizar no máximo 300 requisições por minuto (ajuste
 * com GLOBAL_RATE_LIMIT). O limite é por IP e várias pessoas na mesma
 * rede dividem a cota; o app consulta o chat e as não lidas de tempos
 * em tempos, então 100 por minuto estourava com poucos usuários juntos.
 * Login, cadastro e recuperação de senha também terão limitadores
 * específicos definidos em authRoutes.js.
 */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.GLOBAL_RATE_LIMIT) || 300,
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
app.use(criarParserGlobal("100kb"));

/**
 * Fotos de caçamba e outros arquivos públicos.
 *
 * Os nomes dos arquivos são UUIDs gerados pelo servidor e nunca mudam
 * de conteúdo, então o cache longo é seguro. Assinaturas e contratos
 * ficam em outra pasta e só saem por rotas autenticadas.
 */
app.use(
  "/uploads",
  express.static(pastaPublica(), {
    index: false,
    dotfiles: "deny",
    maxAge: "7d",
    immutable: true,
    fallthrough: true,
  }),
);

// Foto que sumiu do disco (deploy) é servida da cópia guardada no banco.
app.use("/uploads", servirUploadDoBanco);

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

app.get("/api", (req, res) => {
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
app.use("/api/materiais", materiaisRoutes);
app.use("/api/parceiros", parceirosRoutes);
app.use("/api/coletas", coletasRoutes);
app.use("/api/extensoes", extensoesRoutes);
app.use("/api/localizacao", localizacaoRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/ofertas-coleta", ofertasColetaRoutes);
app.use("/api/logs", logsRoutes);

// Chamada por um cron externo (header x-jobs-secret = JOBS_SECRET).
app.post(
  "/api/internal/jobs/extensoes",
  extensoesController.rodarVarredura,
);

// Avisa por e-mail quem deixou mensagens do chat sem ler por 8 horas.
app.post("/api/internal/jobs/chat", chatController.rodarVarredura);

// Expira sinalizações vencidas e envia lembretes das coletas de amanhã.
app.post("/api/internal/jobs/reciclagem", reciclagemController.rodarVarredura);

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

// Expira pedidos de extensão sem resposta e pagamentos fora do prazo.
iniciarVarreduraDeExtensoes();

// Avisa por e-mail mensagens do chat sem leitura há mais de 8 horas.
iniciarVarreduraDoChat();

// Expira sinalizações de reciclagem vencidas e lembra das coletas próximas.
iniciarVarreduraDeReciclagem();

// Registra variáveis ausentes e apaga logs antigos (padrão: 30 dias).
logService.registrarInicializacao();
logService.iniciarLimpezaDosLogs();

// Copia para o banco os arquivos que ainda só existem no disco.
sincronizarDiscoComBanco().then((copiados) => {
  if (copiados > 0) {
    console.log(`${copiados} arquivo(s) copiado(s) do disco para o banco.`);
  }
});

app.listen(PORT, () => {
  console.log(`API disponível em http://localhost:${PORT}/api`);
});