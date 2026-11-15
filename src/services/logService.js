/*
 * Registro de erros e pontos de falha na tabela logs_erros.
 *
 * Regras de ouro:
 * - gravar log nunca pode quebrar nem atrasar uma requisição: tudo aqui
 *   é "dispare e esqueça" e nenhuma função lança erro;
 * - nada sensível vai para o banco (senhas, tokens, assinaturas,
 *   documentos, telefones): os valores são trocados por [oculto];
 * - o volume é limitado (repetições seguidas e rajadas são descartadas)
 *   para uma falha em massa não encher o banco.
 *
 * O que é registrado:
 * - toda resposta com status 400 ou maior (código, mensagem, campos
 *   inválidos e o corpo da requisição já sem dados sensíveis);
 * - requisições lentas (mais de 4 s);
 * - tudo que o código já manda para console.error / console.warn
 *   (os catch dos controllers), com a rota e o usuário da requisição;
 * - exceções e promessas rejeitadas sem tratamento;
 * - configuração ausente na inicialização;
 * - relatos do app Flutter (POST /api/logs/app).
 */

const { AsyncLocalStorage } = require("async_hooks");
const util = require("util");

const sql = require("../config/db");

const consoleOriginal = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

const contexto = new AsyncLocalStorage();

const ORIGENS = ["API", "APP"];
const NIVEIS = ["ERRO", "AVISO", "INFO"];

const LIMITE_LENTA_MS = 4000;
const LIMITE_POR_MINUTO = 120;
const JANELA_REPETICAO_MS = 10 * 1000;
const RETENCAO_DIAS_PADRAO = 30;

const SENSIVEL =
  /senha|password|token|authorization|assinatura|signature|secret|cookie|cartao|card|cvv|documento|cpf|cnpj|telefone|phone|api[_-]?key/i;

const UUID_NA_ROTA =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

let janelaInicio = 0;
let gravadosNaJanela = 0;
let descartadosNaJanela = 0;
const ultimasOcorrencias = new Map();
let avisouTabelaAusente = 0;

function desativado() {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.LOGS_DESATIVADOS === "true"
  );
}

/* ------------------------------------------------------------------ */
/* Limpeza dos dados                                                   */
/* ------------------------------------------------------------------ */

function cortar(texto, limite) {
  const valor = String(texto ?? "");
  return valor.length > limite ? `${valor.slice(0, limite - 1)}…` : valor;
}

/**
 * Copia [valor] sem dados sensíveis e com tamanho limitado, para caber
 * num campo JSON de log.
 */
function sanitizar(valor, chave = "", profundidade = 0) {
  if (chave && SENSIVEL.test(chave)) {
    return "[oculto]";
  }

  if (valor === null || valor === undefined) {
    return valor ?? null;
  }

  if (typeof valor === "string") {
    if (/^data:[\w/+.-]+;base64,/i.test(valor)) {
      return `[arquivo de ${valor.length} caracteres]`;
    }

    return valor.length > 200
      ? `[texto de ${valor.length} caracteres]`
      : valor;
  }

  if (typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }

  if (profundidade >= 4) {
    return "[...]";
  }

  if (Array.isArray(valor)) {
    const itens = valor
      .slice(0, 10)
      .map((item) => sanitizar(item, "", profundidade + 1));

    if (valor.length > 10) {
      itens.push(`[+${valor.length - 10} itens]`);
    }

    return itens;
  }

  if (typeof valor === "object") {
    const copia = {};

    for (const [campo, item] of Object.entries(valor).slice(0, 40)) {
      copia[campo] = sanitizar(item, campo, profundidade + 1);
    }

    return copia;
  }

  return String(valor);
}

/** `/api/alugueis/<uuid>/pix` vira `/api/alugueis/:id/pix`. */
function normalizarRota(caminho) {
  return cortar(String(caminho ?? "").replace(UUID_NA_ROTA, ":id"), 300);
}

function resumoDaResposta(corpo) {
  if (!corpo || typeof corpo !== "object") {
    return null;
  }

  return {
    message: typeof corpo.message === "string" ? corpo.message : null,
    code: typeof corpo.code === "string" ? corpo.code : null,
    fields:
      corpo.fields && typeof corpo.fields === "object"
        ? sanitizar(corpo.fields)
        : null,
    error: typeof corpo.error === "string" ? corpo.error : null,
  };
}

/* ------------------------------------------------------------------ */
/* Controle de volume                                                  */
/* ------------------------------------------------------------------ */

function permitirGravacao(chave, agora = Date.now()) {
  if (agora - janelaInicio >= 60 * 1000) {
    const descartados = descartadosNaJanela;

    janelaInicio = agora;
    gravadosNaJanela = 0;
    descartadosNaJanela = 0;

    if (descartados > 0) {
      // Avisa que houve rajada, sem passar pelo limite de novo.
      gravadosNaJanela += 1;
      gravar({
        origem: "API",
        nivel: "AVISO",
        codigo: "LOGS_DESCARTADOS",
        mensagem: `${descartados} logs foram descartados no último minuto por excesso de volume.`,
      });
    }
  }

  const anterior = ultimasOcorrencias.get(chave);

  if (anterior !== undefined && agora - anterior < JANELA_REPETICAO_MS) {
    return false;
  }

  if (gravadosNaJanela >= LIMITE_POR_MINUTO) {
    descartadosNaJanela += 1;
    return false;
  }

  ultimasOcorrencias.set(chave, agora);
  gravadosNaJanela += 1;

  // Evita o mapa crescer sem limite.
  if (ultimasOcorrencias.size > 500) {
    for (const [codigo, quando] of ultimasOcorrencias) {
      if (agora - quando >= JANELA_REPETICAO_MS) {
        ultimasOcorrencias.delete(codigo);
      }
    }
  }

  return true;
}

/* ------------------------------------------------------------------ */
/* Gravação                                                            */
/* ------------------------------------------------------------------ */

function limparEntrada(entrada) {
  const origem = ORIGENS.includes(entrada.origem) ? entrada.origem : "API";
  const nivel = NIVEIS.includes(entrada.nivel) ? entrada.nivel : "ERRO";

  const detalhes =
    entrada.detalhes === undefined || entrada.detalhes === null
      ? null
      : sanitizar(entrada.detalhes);

  let detalhesJson = null;

  if (detalhes !== null) {
    detalhesJson = JSON.stringify(detalhes);

    if (detalhesJson.length > 6000) {
      detalhesJson = JSON.stringify({
        aviso: "detalhes grandes demais",
        tamanho: detalhesJson.length,
      });
    }
  }

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return {
    origem,
    nivel,
    codigo: entrada.codigo ? cortar(entrada.codigo, 80) : null,
    mensagem: cortar(entrada.mensagem || "(sem mensagem)", 2000),
    metodo: entrada.metodo ? cortar(entrada.metodo, 10) : null,
    rota: entrada.rota ? normalizarRota(entrada.rota) : null,
    statusHttp: Number.isInteger(entrada.statusHttp)
      ? entrada.statusHttp
      : null,
    duracaoMs: Number.isInteger(entrada.duracaoMs) ? entrada.duracaoMs : null,
    usuarioId: uuid.test(entrada.usuarioId ?? "") ? entrada.usuarioId : null,
    perfil: entrada.perfil ? cortar(entrada.perfil, 20) : null,
    ip: entrada.ip ? cortar(entrada.ip, 64) : null,
    userAgent: entrada.userAgent ? cortar(entrada.userAgent, 300) : null,
    tela: entrada.tela ? cortar(entrada.tela, 120) : null,
    appVersao: entrada.appVersao ? cortar(entrada.appVersao, 40) : null,
    plataforma: entrada.plataforma ? cortar(entrada.plataforma, 40) : null,
    detalhesJson,
  };
}

/** Grava sem esperar e sem nunca lançar erro. */
function gravar(entrada) {
  if (desativado()) {
    return Promise.resolve(false);
  }

  let linha;

  try {
    linha = limparEntrada(entrada);
  } catch (_) {
    return Promise.resolve(false);
  }

  return Promise.resolve()
    .then(
      () => sql`
        INSERT INTO logs_erros (
          origem, nivel, codigo, mensagem, metodo, rota, status_http,
          duracao_ms, usuario_id, perfil, ip, user_agent, tela,
          app_versao, plataforma, detalhes
        )
        VALUES (
          ${linha.origem}, ${linha.nivel}, ${linha.codigo},
          ${linha.mensagem}, ${linha.metodo}, ${linha.rota},
          ${linha.statusHttp}, ${linha.duracaoMs}, ${linha.usuarioId},
          ${linha.perfil}, ${linha.ip}, ${linha.userAgent}, ${linha.tela},
          ${linha.appVersao}, ${linha.plataforma},
          ${linha.detalhesJson}::jsonb
        )
      `,
    )
    .then(() => true)
    .catch((erro) => {
      // Só avisa de vez em quando, pelo console original, para não
      // virar um ciclo (log do erro do log).
      const agora = Date.now();

      if (agora - avisouTabelaAusente > 10 * 60 * 1000) {
        avisouTabelaAusente = agora;
        consoleOriginal.warn(
          "[logs] Não foi possível gravar em logs_erros " +
            "(rode npm run migrate:logs):",
          erro?.message,
        );
      }

      return false;
    });
}

/**
 * Registra um log. [chaveDeRepeticao] agrupa ocorrências iguais: a
 * mesma chave não é gravada de novo por 10 segundos.
 */
function registrar(entrada, chaveDeRepeticao) {
  if (desativado()) {
    return Promise.resolve(false);
  }

  const chave =
    chaveDeRepeticao ??
    [
      entrada.origem,
      entrada.codigo,
      entrada.metodo,
      normalizarRota(entrada.rota),
      entrada.usuarioId,
      cortar(entrada.mensagem, 120),
    ].join("|");

  if (!permitirGravacao(chave)) {
    return Promise.resolve(false);
  }

  return gravar(entrada);
}

/* ------------------------------------------------------------------ */
/* Contexto da requisição                                              */
/* ------------------------------------------------------------------ */

function dadosDaRequisicao(req) {
  if (!req) {
    return {};
  }

  return {
    metodo: req.method,
    usuarioId: req.usuario_id,
    perfil: req.tipo_perfil,
    ip: req.ip,
    userAgent: req.headers?.["user-agent"],
  };
}

/**
 * Rota para agrupar: a rota do Express quando existe (já com :id), senão
 * o caminho pedido sem a query.
 */
function rotaDe(req) {
  if (req.route?.path !== undefined) {
    return `${req.baseUrl ?? ""}${req.route.path}`;
  }

  return String(req.originalUrl ?? req.url ?? "").split("?")[0];
}

function nivelDoStatus(status) {
  if (status >= 500) return "ERRO";
  if (status === 401 || status === 404) return "INFO";
  return "AVISO";
}

/**
 * Middleware: guarda o contexto da requisição para os logs feitos
 * durante ela e registra respostas com erro e requisições lentas.
 */
function logMiddleware(req, res, next) {
  const inicio = Date.now();
  const store = { req };
  const jsonOriginal = res.json.bind(res);

  res.json = (corpo) => {
    store.resposta = resumoDaResposta(corpo);
    return jsonOriginal(corpo);
  };

  res.on("finish", () => {
    try {
      const status = res.statusCode;
      const duracao = Date.now() - inicio;
      const rota = rotaDe(req);

      if (req.method === "OPTIONS" || rota.startsWith("/api/logs")) {
        return;
      }

      const base = {
        origem: "API",
        metodo: req.method,
        rota,
        statusHttp: status,
        duracaoMs: duracao,
        usuarioId: req.usuario_id,
        perfil: req.tipo_perfil,
        ip: req.ip,
        userAgent: req.headers?.["user-agent"],
      };

      if (status >= 400) {
        const resposta = store.resposta;

        registrar({
          ...base,
          nivel: nivelDoStatus(status),
          codigo: resposta?.code || `HTTP_${status}`,
          mensagem: resposta?.message || resposta?.error || `HTTP ${status}`,
          detalhes: {
            resposta,
            corpo: req.body && Object.keys(req.body).length ? req.body : null,
            query: req.query && Object.keys(req.query).length ? req.query : null,
          },
        });

        return;
      }

      if (duracao >= LIMITE_LENTA_MS && !rota.startsWith("/api/health")) {
        registrar({
          ...base,
          nivel: "AVISO",
          codigo: "SLOW_REQUEST",
          mensagem: `Requisição lenta: ${duracao} ms.`,
        });
      }
    } catch (_) {
      // Log nunca pode afetar a resposta.
    }
  });

  return contexto.run(store, next);
}

/* ------------------------------------------------------------------ */
/* console.error, exceções e configuração                              */
/* ------------------------------------------------------------------ */

function textoDosArgumentos(args) {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }

      return typeof arg === "string" ? arg : util.inspect(arg, { depth: 1 });
    })
    .join(" ");
}

function registrarDoConsole(nivel, args) {
  if (desativado()) {
    return;
  }

  const erro = args.find((arg) => arg instanceof Error);
  const store = contexto.getStore();
  const req = store?.req;

  registrar({
    origem: "API",
    nivel,
    codigo:
      erro?.code && typeof erro.code === "string"
        ? erro.code
        : nivel === "ERRO"
          ? "CONSOLE_ERROR"
          : "CONSOLE_WARN",
    mensagem: textoDosArgumentos(args),
    ...dadosDaRequisicao(req),
    rota: req ? rotaDe(req) : undefined,
    detalhes: erro ? { stack: cortar(erro.stack, 3000) } : null,
  });
}

let capturaInstalada = false;

/**
 * Faz console.error e console.warn também gravarem em logs_erros. Assim
 * todos os catch que já registram no console passam a deixar rastro no
 * banco, com a rota e o usuário da requisição.
 */
function instalarCapturaDoConsole() {
  if (capturaInstalada || desativado()) {
    return;
  }

  capturaInstalada = true;

  console.error = (...args) => {
    consoleOriginal.error(...args);
    registrarDoConsole("ERRO", args);
  };

  console.warn = (...args) => {
    consoleOriginal.warn(...args);
    registrarDoConsole("AVISO", args);
  };

  process.on("unhandledRejection", (motivo) => {
    consoleOriginal.error("Promessa rejeitada sem tratamento:", motivo);
    registrar({
      origem: "API",
      nivel: "ERRO",
      codigo: "UNHANDLED_REJECTION",
      mensagem: textoDosArgumentos([motivo]),
      detalhes:
        motivo instanceof Error ? { stack: cortar(motivo.stack, 3000) } : null,
    });
  });

  process.on("uncaughtException", (erro) => {
    consoleOriginal.error("Exceção não tratada:", erro);

    // Grava antes de encerrar; o Render reinicia o processo.
    gravar({
      origem: "API",
      nivel: "ERRO",
      codigo: "UNCAUGHT_EXCEPTION",
      mensagem: textoDosArgumentos([erro]),
      detalhes: { stack: cortar(erro?.stack, 3000) },
    }).finally(() => process.exit(1));

    setTimeout(() => process.exit(1), 2000).unref();
  });
}

const VARIAVEIS_RECOMENDADAS = [
  ["DATABASE_URL", "ERRO", "Sem banco de dados a API não funciona."],
  ["JWT_SECRET", "ERRO", "Sem JWT_SECRET nenhum login é válido."],
  ["FRONTEND_URL", "AVISO", "Links dos e-mails e CORS usam FRONTEND_URL."],
  ["PUBLIC_API_URL", "AVISO", "Link da resposta de extensão usa PUBLIC_API_URL."],
  ["BREVO_API_KEY", "AVISO", "Sem BREVO_API_KEY os e-mails só vão para o log."],
  ["ABACATEPAY_API_KEY", "AVISO", "Sem ABACATEPAY_API_KEY o PIX não funciona."],
  ["JOBS_SECRET", "AVISO", "Sem JOBS_SECRET as rotas de cron ficam desativadas."],
  ["GEOCODING_CONTACT", "AVISO", "O Nominatim exige um contato nas consultas."],
  ["DOCUMENT_SIGNING_SECRET", "INFO", "Vazio: o termo de coleta usa o JWT_SECRET."],
];

/** Registra variáveis de ambiente ausentes e o início do servidor. */
function registrarInicializacao(env = process.env) {
  registrar(
    {
      origem: "API",
      nivel: "INFO",
      codigo: "SERVER_START",
      mensagem: "API iniciada.",
      detalhes: { node: process.version, ambiente: env.NODE_ENV ?? null },
    },
    "SERVER_START",
  );

  for (const [nome, nivel, explicacao] of VARIAVEIS_RECOMENDADAS) {
    if (!env[nome]?.trim()) {
      registrar(
        {
          origem: "API",
          nivel,
          codigo: "CONFIG_AUSENTE",
          mensagem: `${nome} não está definida. ${explicacao}`,
        },
        `CONFIG|${nome}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Limpeza                                                             */
/* ------------------------------------------------------------------ */

async function limparLogsAntigos() {
  if (desativado()) {
    return 0;
  }

  const dias = Math.max(
    1,
    Number(process.env.LOGS_RETENCAO_DIAS) || RETENCAO_DIAS_PADRAO,
  );

  try {
    const apagados = await sql`
      DELETE FROM logs_erros
      WHERE criado_em < NOW() - make_interval(days => ${dias})
      RETURNING id
    `;

    return apagados.length;
  } catch (_) {
    return 0;
  }
}

function iniciarLimpezaDosLogs() {
  if (desativado()) {
    return;
  }

  limparLogsAntigos();

  setInterval(limparLogsAntigos, 24 * 60 * 60 * 1000).unref();
}

/** Zera o controle de volume (usado nos testes). */
function reiniciarControleDeVolume() {
  janelaInicio = 0;
  gravadosNaJanela = 0;
  descartadosNaJanela = 0;
  ultimasOcorrencias.clear();
}

module.exports = {
  registrar,
  gravar,
  sanitizar,
  normalizarRota,
  nivelDoStatus,
  logMiddleware,
  instalarCapturaDoConsole,
  registrarInicializacao,
  iniciarLimpezaDosLogs,
  limparLogsAntigos,
  reiniciarControleDeVolume,
  LIMITE_LENTA_MS,
  LIMITE_POR_MINUTO,
};
