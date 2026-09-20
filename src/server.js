require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

// Inicializa o aplicativo Express
const app = express();

// --- Middlewares Globais ---
// Permite que o front-end faça requisições para a API (Restrito + Localhost para Dev)
const allowedOrigins = [
  'https://collectexpress.onrender.com',
  'http://localhost:8081',
  'http://localhost:3000'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:') || origin.startsWith('http://192.168.')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Rate Limiting Global: máximo 100 requisições por minuto por IP
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 100, // Limite de cada IP para 100 reqs por janela
  message: { error: "Muitas requisições deste IP. Tente novamente em 1 minuto." }
});
app.use(globalLimiter);

app.use(express.json()); // Permite que a API receba e envie dados no formato JSON

app.get("/", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "CollectExpress API online",
    health: "/api/health"
  });
});

// --- Rota de Health Check ---
// Rota simples para verificar se o servidor está no ar
app.get("/api/health", (req, res) => {
  res.status(200).json({ 
    status: "ok", 
    message: "API de Caçambas operando normalmente! 🚀",
    timestamp: new Date().toISOString()
  });
});

// --- Importação das Rotas (Vamos criar nos próximos passos) ---
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

// --- Definição dos Endpoints ---
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

// --- Middleware para Rotas Não Encontradas (404) ---
app.use((req, res, next) => {
  res.status(404).json({ error: "Endpoint não encontrado." });
});

// --- Inicialização do Servidor ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Api: http://localhost:${PORT}/api/`);
});
