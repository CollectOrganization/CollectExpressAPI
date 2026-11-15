jest.mock("../src/config/db", () => jest.fn());

const { EventEmitter } = require("events");
const jwt = require("jsonwebtoken");

const sql = require("../src/config/db");
const logService = require("../src/services/logService");
const logsController = require("../src/controllers/logsController");
const authMiddleware = require("../src/middlewares/authMiddleware");
const {
  errorMiddleware,
} = require("../src/middlewares/errorMiddleware");
const cacambeiroPerfilController = require("../src/controllers/cacambeiroPerfilController");
const ApiError = require("../src/utils/apiError");
const {
  dataDeHojeNoBrasil,
  diasAteADataNoBrasil,
} = require("../src/utils/dataBrasil");

const USUARIO = "11111111-1111-4111-8111-111111111111";

const ambienteOriginal = process.env.NODE_ENV;

/** Liga a gravação (o jest roda com NODE_ENV=test, que a desliga). */
function ligarLogs() {
  process.env.NODE_ENV = "development";
  logService.reiniciarControleDeVolume();
  sql.mockReset();
  sql.mockResolvedValue([]);
}

afterEach(() => {
  process.env.NODE_ENV = ambienteOriginal;
  jest.restoreAllMocks();
});

const insercoes = () =>
  sql.mock.calls.filter(([strings]) =>
    strings.join("?").includes("INSERT INTO logs_erros"),
  );

/** Valores do INSERT na ordem das colunas. */
const valoresDe = (chamada) => chamada.slice(1);

function esperarGravacao() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("sanitizar", () => {
  it("oculta campos sensíveis, arquivos e textos grandes", () => {
    const limpo = logService.sanitizar({
      email: "a@b.com",
      senha: "Segredo123",
      refresh_token: "abc",
      assinatura_base64: "data:image/png;base64,AAAA",
      foto: `data:image/png;base64,${"A".repeat(500)}`,
      descricao: "x".repeat(300),
      aninhado: { documento: "123", cidade: "SP" },
      itens: Array.from({ length: 12 }, (_, i) => i),
    });

    expect(limpo.email).toBe("a@b.com");
    expect(limpo.senha).toBe("[oculto]");
    expect(limpo.refresh_token).toBe("[oculto]");
    expect(limpo.assinatura_base64).toBe("[oculto]");
    expect(limpo.foto).toMatch(/^\[arquivo de \d+ caracteres\]$/);
    expect(limpo.descricao).toBe("[texto de 300 caracteres]");
    expect(limpo.aninhado).toEqual({ documento: "[oculto]", cidade: "SP" });
    expect(limpo.itens).toHaveLength(11);
    expect(limpo.itens[10]).toBe("[+2 itens]");
  });

  it("não quebra com valores nulos ou aninhamento profundo", () => {
    expect(logService.sanitizar(null)).toBeNull();
    expect(logService.sanitizar(undefined)).toBeNull();
    expect(
      logService.sanitizar({ a: { b: { c: { d: { e: 1 } } } } }).a.b.c.d,
    ).toBe("[...]");
  });
});

describe("normalizarRota e nivelDoStatus", () => {
  it("troca UUIDs por :id", () => {
    expect(
      logService.normalizarRota(`/api/alugueis/${USUARIO}/pix`),
    ).toBe("/api/alugueis/:id/pix");
  });

  it("5xx é erro, 401/404 informativo e o resto aviso", () => {
    expect(logService.nivelDoStatus(500)).toBe("ERRO");
    expect(logService.nivelDoStatus(503)).toBe("ERRO");
    expect(logService.nivelDoStatus(401)).toBe("INFO");
    expect(logService.nivelDoStatus(404)).toBe("INFO");
    expect(logService.nivelDoStatus(400)).toBe("AVISO");
    expect(logService.nivelDoStatus(429)).toBe("AVISO");
  });
});

describe("registrar", () => {
  it("não grava nada nos testes (NODE_ENV=test)", async () => {
    sql.mockReset();

    await logService.registrar({ nivel: "ERRO", mensagem: "x" });

    expect(sql).not.toHaveBeenCalled();
  });

  it("grava com os campos limpos e UUID inválido vira nulo", async () => {
    ligarLogs();

    await logService.registrar({
      origem: "APP",
      nivel: "ERRO",
      codigo: "TESTE",
      mensagem: "falhou",
      usuarioId: "nao-e-uuid",
      rota: `/api/x/${USUARIO}`,
      detalhes: { senha: "123", ok: 1 },
    });

    const [chamada] = insercoes();
    const valores = valoresDe(chamada);

    expect(valores[0]).toBe("APP");
    expect(valores[1]).toBe("ERRO");
    expect(valores[2]).toBe("TESTE");
    expect(valores[5]).toBe("/api/x/:id");
    expect(valores[8]).toBeNull();
    expect(JSON.parse(valores[15])).toEqual({ senha: "[oculto]", ok: 1 });
  });

  it("origem e nível desconhecidos viram API e ERRO", async () => {
    ligarLogs();

    await logService.registrar({ origem: "X", nivel: "Y", mensagem: "m" });

    const valores = valoresDe(insercoes()[0]);

    expect(valores[0]).toBe("API");
    expect(valores[1]).toBe("ERRO");
  });

  it("ocorrência repetida em seguida é descartada", async () => {
    ligarLogs();

    const entrada = { nivel: "ERRO", codigo: "A", mensagem: "igual" };

    await logService.registrar(entrada);
    await logService.registrar(entrada);
    await logService.registrar({ ...entrada, mensagem: "outra" });

    expect(insercoes()).toHaveLength(2);
  });

  it("limita a quantidade por minuto", async () => {
    ligarLogs();

    for (let i = 0; i < logService.LIMITE_POR_MINUTO + 20; i += 1) {
      await logService.registrar({
        nivel: "ERRO",
        codigo: "RAJADA",
        mensagem: `erro ${i}`,
      });
    }

    expect(insercoes()).toHaveLength(logService.LIMITE_POR_MINUTO);
  });

  it("falha do banco não lança erro", async () => {
    ligarLogs();
    sql.mockRejectedValue(new Error("tabela não existe"));
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      logService.registrar({ nivel: "ERRO", mensagem: "x" }),
    ).resolves.toBe(false);
  });
});

describe("logMiddleware", () => {
  function requisicao(extra = {}) {
    return {
      method: "POST",
      originalUrl: `/api/alugueis/checkout?x=1`,
      baseUrl: "/api/alugueis",
      route: { path: "/checkout" },
      headers: { "user-agent": "teste" },
      ip: "1.2.3.4",
      body: { endereco_id: "e1", senha: "123" },
      query: {},
      usuario_id: USUARIO,
      tipo_perfil: "CONSUMIDOR",
      ...extra,
    };
  }

  function resposta(status, corpo) {
    const res = new EventEmitter();
    res.statusCode = status;
    res.json = (dados) => dados;
    res.simular = () => {
      res.json(corpo);
      res.emit("finish");
    };
    return res;
  }

  it("grava respostas 400 com código, campos e corpo sem dados sensíveis", async () => {
    ligarLogs();

    const res = resposta(400, {
      success: false,
      message: "Dados inválidos.",
      code: "VALIDATION_ERROR",
      fields: { data_inicio: "Informe uma data válida." },
    });
    const next = jest.fn();

    logService.logMiddleware(requisicao(), res, next);
    res.simular();
    await esperarGravacao();

    expect(next).toHaveBeenCalled();

    const valores = valoresDe(insercoes()[0]);

    expect(valores[0]).toBe("API");
    expect(valores[1]).toBe("AVISO");
    expect(valores[2]).toBe("VALIDATION_ERROR");
    expect(valores[3]).toBe("Dados inválidos.");
    expect(valores[4]).toBe("POST");
    expect(valores[5]).toBe("/api/alugueis/checkout");
    expect(valores[6]).toBe(400);
    expect(valores[8]).toBe(USUARIO);

    const detalhes = JSON.parse(valores[15]);

    expect(detalhes.resposta.fields).toEqual({
      data_inicio: "Informe uma data válida.",
    });
    expect(detalhes.corpo.senha).toBe("[oculto]");
  });

  it("5xx é nível ERRO e 200 rápido não grava", async () => {
    ligarLogs();

    const falha = resposta(500, { message: "Erro interno", code: "BOOM" });
    logService.logMiddleware(requisicao(), falha, jest.fn());
    falha.simular();

    const ok = resposta(200, { success: true });
    logService.logMiddleware(requisicao({ route: { path: "/ok" } }), ok, jest.fn());
    ok.simular();

    await esperarGravacao();

    expect(insercoes()).toHaveLength(1);
    expect(valoresDe(insercoes()[0])[1]).toBe("ERRO");
  });

  it("registra requisição lenta", async () => {
    ligarLogs();

    const relogio = jest.spyOn(Date, "now");
    relogio.mockReturnValueOnce(1_000_000);
    relogio.mockReturnValue(1_000_000 + logService.LIMITE_LENTA_MS + 10);

    const res = resposta(200, { success: true });
    logService.logMiddleware(requisicao({ method: "GET" }), res, jest.fn());
    res.simular();
    await esperarGravacao();

    const valores = valoresDe(insercoes()[0]);

    expect(valores[2]).toBe("SLOW_REQUEST");
    expect(valores[1]).toBe("AVISO");
  });

  it("não registra a própria rota de logs nem OPTIONS", async () => {
    ligarLogs();

    const a = resposta(400, { message: "x" });
    logService.logMiddleware(
      requisicao({ route: { path: "/app" }, baseUrl: "/api/logs" }),
      a,
      jest.fn(),
    );
    a.simular();

    const b = resposta(400, { message: "x" });
    logService.logMiddleware(requisicao({ method: "OPTIONS" }), b, jest.fn());
    b.simular();

    await esperarGravacao();

    expect(insercoes()).toHaveLength(0);
  });
});

describe("POST /api/logs/app", () => {
  function res() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  }

  it("exige a mensagem", async () => {
    const r = res();

    await logsController.registrarDoApp(
      { body: {}, headers: {}, ip: "1.1.1.1" },
      r,
    );

    expect(r.status).toHaveBeenCalledWith(400);
  });

  it("aceita sem login, responde 202 e grava como APP", async () => {
    ligarLogs();
    const r = res();

    await logsController.registrarDoApp(
      {
        body: {
          nivel: "ERRO",
          codigo: "CHECKOUT_FALHOU",
          mensagem: "Dados inválidos",
          tela: "/cliente/agendar",
          app_versao: "1.0.0",
          plataforma: "android",
          detalhes: { senha: "x", campo: "data_inicio" },
        },
        headers: { "user-agent": "dart" },
        ip: "1.1.1.1",
      },
      r,
    );
    await esperarGravacao();

    expect(r.status).toHaveBeenCalledWith(202);

    const valores = valoresDe(insercoes()[0]);

    expect(valores[0]).toBe("APP");
    expect(valores[2]).toBe("CHECKOUT_FALHOU");
    expect(valores[12]).toBe("/cliente/agendar");
    expect(JSON.parse(valores[15]).senha).toBe("[oculto]");
  });

  it("usa o usuário do token quando ele é válido", async () => {
    ligarLogs();
    process.env.JWT_SECRET = "segredo-de-teste";
    const token = jwt.sign({ id: USUARIO }, process.env.JWT_SECRET);

    await logsController.registrarDoApp(
      {
        body: { mensagem: "falha" },
        headers: { authorization: `Bearer ${token}` },
        ip: "1.1.1.1",
      },
      res(),
    );
    await esperarGravacao();

    expect(valoresDe(insercoes()[0])[8]).toBe(USUARIO);
  });

  it("nível inválido vira ERRO e token inválido é ignorado", async () => {
    ligarLogs();
    process.env.JWT_SECRET = "segredo-de-teste";

    await logsController.registrarDoApp(
      {
        body: { mensagem: "falha", nivel: "OUTRO" },
        headers: { authorization: "Bearer lixo" },
        ip: "1.1.1.1",
      },
      res(),
    );
    await esperarGravacao();

    const valores = valoresDe(insercoes()[0]);

    expect(valores[1]).toBe("ERRO");
    expect(valores[8]).toBeNull();
  });
});

describe("authMiddleware: falha do banco não derruba a sessão", () => {
  function res() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  }

  beforeEach(() => {
    process.env.JWT_SECRET = "segredo-de-teste";
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  it("responde 503 (e não 401) quando o banco falha", async () => {
    sql.mockReset();
    sql.mockRejectedValue(new Error("connection terminated"));

    const token = jwt.sign({ id: USUARIO, token_version: 0 }, "segredo-de-teste");
    const r = res();
    const next = jest.fn();

    await authMiddleware(
      { headers: { authorization: `Bearer ${token}` } },
      r,
      next,
    );

    expect(r.status).toHaveBeenCalledWith(503);
    expect(r.json.mock.calls[0][0].code).toBe("AUTH_UNAVAILABLE");
    expect(next).not.toHaveBeenCalled();
  });

  it("token vencido ou adulterado continua sendo 401", async () => {
    sql.mockReset();

    const vencido = jwt.sign({ id: USUARIO }, "segredo-de-teste", {
      expiresIn: -10,
    });
    const r1 = res();
    await authMiddleware(
      { headers: { authorization: `Bearer ${vencido}` } },
      r1,
      jest.fn(),
    );

    const r2 = res();
    await authMiddleware(
      { headers: { authorization: "Bearer abc.def.ghi" } },
      r2,
      jest.fn(),
    );

    expect(r1.status).toHaveBeenCalledWith(401);
    expect(r2.status).toHaveBeenCalledWith(401);
    expect(sql).not.toHaveBeenCalled();
  });
});

describe("errorMiddleware", () => {
  function res() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  }

  it("JSON malformado é 400, não 500", () => {
    const r = res();
    jest.spyOn(console, "error").mockImplementation(() => {});

    errorMiddleware({ type: "entity.parse.failed" }, {}, r, jest.fn());

    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json.mock.calls[0][0].code).toBe("INVALID_JSON");
  });

  it("erro de regra (4xx) não vai para o console, erro inesperado vai", () => {
    const erro = jest.spyOn(console, "error").mockImplementation(() => {});

    errorMiddleware(new ApiError(404, "Não achei", "NAO_ACHEI"), {}, res(), jest.fn());
    expect(erro).not.toHaveBeenCalled();

    const r = res();
    errorMiddleware(new Error("boom"), {}, r, jest.fn());
    expect(erro).toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(500);
  });
});

describe("data de Brasília", () => {
  it("às 22h30 em Brasília o servidor (UTC) já está no dia seguinte", () => {
    // 2026-11-12 01:30 UTC = 2026-11-11 22:30 em Brasília.
    const agora = new Date("2026-11-12T01:30:00Z");

    expect(dataDeHojeNoBrasil(agora)).toBe("2026-11-11");
    // "Amanhã" para o cliente tem de contar 1 dia, não 0.
    expect(diasAteADataNoBrasil("2026-11-12", agora)).toBe(1);
    expect(diasAteADataNoBrasil("2026-11-11", agora)).toBe(0);
    expect(diasAteADataNoBrasil("2027-01-10", agora)).toBe(60);
  });

  it("durante o dia os dois relógios concordam", () => {
    const agora = new Date("2026-11-11T15:00:00Z");

    expect(dataDeHojeNoBrasil(agora)).toBe("2026-11-11");
    expect(diasAteADataNoBrasil("2026-11-12", agora)).toBe(1);
  });
});

describe("PUT /api/cacambeiros/me", () => {
  function res() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  }

  function requisicao(body) {
    return { usuario_id: USUARIO, body };
  }

  beforeEach(() => sql.mockReset());

  it("atualiza horário e taxa", async () => {
    sql
      .mockResolvedValueOnce([
        { horario_inicio: "08:00:00", horario_fim: "18:00:00", taxa_entrega: "50" },
      ])
      .mockResolvedValueOnce([
        {
          horario_inicio: "07:00:00",
          horario_fim: "18:00:00",
          raio_entrega_km: null,
          taxa_entrega: "60",
        },
      ]);
    const r = res();
    const next = jest.fn();

    await cacambeiroPerfilController.atualizar(
      requisicao({ horario_inicio: "07:00", taxa_entrega: 60 }),
      r,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(200);

    const update = sql.mock.calls[1];

    expect(update.slice(1)).toEqual(["07:00", "18:00", 60, USUARIO]);
  });

  it("recusa horário final antes do inicial usando o valor já gravado", async () => {
    sql.mockResolvedValueOnce([
      { horario_inicio: "08:00:00", horario_fim: "18:00:00", taxa_entrega: "50" },
    ]);
    const next = jest.fn();

    await cacambeiroPerfilController.atualizar(
      requisicao({ horario_inicio: "19:00" }),
      res(),
      next,
    );

    const erro = next.mock.calls[0][0];

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.statusCode).toBe(400);
    expect(erro.fields.horario_fim).toBeDefined();
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("404 quando o usuário não tem detalhes de fornecedor", async () => {
    sql.mockResolvedValueOnce([]);
    const next = jest.fn();

    await cacambeiroPerfilController.atualizar(
      requisicao({ taxa_entrega: 10 }),
      res(),
      next,
    );

    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });
});
