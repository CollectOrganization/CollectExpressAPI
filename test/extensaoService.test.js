jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/notificacaoService", () => ({
  EVENTOS: {
    EXTENSAO_SOLICITADA: "EXTENSAO_SOLICITADA",
    EXTENSAO_ACEITA: "EXTENSAO_ACEITA",
    EXTENSAO_RECUSADA: "EXTENSAO_RECUSADA",
    EXTENSAO_SEM_RESPOSTA: "EXTENSAO_SEM_RESPOSTA",
    EXTENSAO_PAGAMENTO_EXPIRADO: "EXTENSAO_PAGAMENTO_EXPIRADO",
  },
  notificar: jest.fn(),
}));

const sql = require("../src/config/db");
const { notificar } = require("../src/services/notificacaoService");
const ApiError = require("../src/utils/apiError");
const extensaoService = require("../src/services/extensaoService");

const pedidoElegivel = {
  id: "ped-1",
  consumidor_id: "cons-1",
  cacambeiro_id: "cacb-1",
  status_aluguel: "EM_USO",
  status_pagamento: "PAGO",
  dias_aluguel: 7,
  dias_extra: 0,
  permite_extensao: true,
  diaria_total: "300.00",
};

function textoDaConsulta(chamada) {
  return chamada[0].join("?");
}

async function erroDe(promessa) {
  try {
    await promessa;
  } catch (error) {
    return error;
  }

  throw new Error("Era esperado um erro.");
}

describe("extensaoService.impedimento", () => {
  it("libera pedido em uso, pago e que permite extensão", () => {
    expect(extensaoService.impedimento(pedidoElegivel, 5)).toBeNull();
  });

  it("bloqueia quando a caçamba não permite extensão", () => {
    expect(
      extensaoService.impedimento(
        { ...pedidoElegivel, permite_extensao: false },
        5,
      ),
    ).toMatchObject({ status: 422, code: "EXTENSION_NOT_ALLOWED" });
  });

  it("bloqueia fora de EM_USO", () => {
    for (const status of [
      "AGUARDANDO_ENTREGA",
      "AGUARDANDO_RETIRADA",
      "FINALIZADO",
    ]) {
      expect(
        extensaoService.impedimento(
          { ...pedidoElegivel, status_aluguel: status },
          5,
        ),
      ).toMatchObject({ code: "EXTENSION_INVALID_STATUS" });
    }
  });

  it("bloqueia pedido não pago", () => {
    expect(
      extensaoService.impedimento(
        { ...pedidoElegivel, status_pagamento: "PENDENTE" },
        5,
      ),
    ).toMatchObject({ status: 409, code: "ORDER_NOT_PAID" });
  });

  it("limita o prazo total a 90 dias", () => {
    expect(
      extensaoService.impedimento(
        { ...pedidoElegivel, dias_aluguel: 60, dias_extra: 25 },
        5,
      ),
    ).toBeNull();

    expect(
      extensaoService.impedimento(
        { ...pedidoElegivel, dias_aluguel: 60, dias_extra: 25 },
        6,
      ),
    ).toMatchObject({ code: "EXTENSION_LIMIT_EXCEEDED" });

    expect(
      extensaoService.impedimento({
        ...pedidoElegivel,
        dias_aluguel: 60,
        dias_extra: 30,
      }),
    ).toMatchObject({ code: "EXTENSION_LIMIT_EXCEEDED" });
  });
});

describe("extensaoService.solicitar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    process.env.PUBLIC_API_URL = "https://api.teste.com";
  });

  afterEach(() => {
    delete process.env.PUBLIC_API_URL;
  });

  it("calcula o valor no servidor, grava o token como hash e avisa o caçambeiro", async () => {
    sql
      .mockResolvedValueOnce([]) // expirarVencidas
      .mockResolvedValueOnce([pedidoElegivel]) // carregarPedido
      .mockImplementationOnce(async (_partes, ...valores) => [
        {
          id: "ext-1",
          aluguel_id: "ped-1",
          dias_adicionais: valores[1],
          valor: valores[2],
          status: "SOLICITADA",
          token_hash: valores[4],
        },
      ]);

    const resultado = await extensaoService.solicitar({
      aluguelId: "ped-1",
      consumidorId: "cons-1",
      dias: 4,
    });

    // 300,00 de diária somada x 4 dias.
    expect(resultado).toMatchObject({
      id: "ext-1",
      dias_adicionais: 4,
      valor: 1200,
      status: "SOLICITADA",
    });
    expect(resultado).not.toHaveProperty("token_hash");

    // Valores do INSERT: aluguel, dias, valor, horas de validade, hash.
    const insert = sql.mock.calls[2];
    expect(insert[4]).toBe(48);
    const tokenHash = insert[5];
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const [evento, aluguelId, contexto] = notificar.mock.calls[0];
    expect(evento).toBe("EXTENSAO_SOLICITADA");
    expect(aluguelId).toBe("ped-1");

    const link = contexto.linkResposta;
    expect(link).toMatch(
      /^https:\/\/api\.teste\.com\/api\/extensoes\/resposta\/[0-9a-f]{64}$/,
    );

    // O link leva o token puro; o banco guarda só o hash dele.
    const token = link.split("/").pop();
    expect(token).not.toBe(tokenHash);
    expect(
      require("crypto").createHash("sha256").update(token).digest("hex"),
    ).toBe(tokenHash);
  });

  it("não revela pedido de outro consumidor", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...pedidoElegivel, consumidor_id: "outro" }]);

    const erro = await erroDe(
      extensaoService.solicitar({
        aluguelId: "ped-1",
        consumidorId: "cons-1",
        dias: 3,
      }),
    );

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro).toMatchObject({ statusCode: 404, code: "ORDER_NOT_FOUND" });
    expect(notificar).not.toHaveBeenCalled();
  });

  it("recusa quando a regra do pedido não permite, sem gravar", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...pedidoElegivel, permite_extensao: false },
      ]);

    const erro = await erroDe(
      extensaoService.solicitar({
        aluguelId: "ped-1",
        consumidorId: "cons-1",
        dias: 3,
      }),
    );

    expect(erro).toMatchObject({
      statusCode: 422,
      code: "EXTENSION_NOT_ALLOWED",
    });
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("converte violação do índice único em 409", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pedidoElegivel])
      .mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "23505" }));

    const erro = await erroDe(
      extensaoService.solicitar({
        aluguelId: "ped-1",
        consumidorId: "cons-1",
        dias: 3,
      }),
    );

    expect(erro).toMatchObject({
      statusCode: 409,
      code: "EXTENSION_ALREADY_OPEN",
    });
  });
});

describe("extensaoService.responder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
  });

  const linhaAceita = {
    id: "ext-1",
    aluguel_id: "ped-1",
    dias_adicionais: 4,
    valor: "1200.00",
    status: "AGUARDANDO_PAGAMENTO",
    pagamento_expira_em: "2026-11-02T10:00:00.000Z",
  };

  it("aceita pelo app: atualiza e avisa o consumidor", async () => {
    sql.mockResolvedValueOnce([linhaAceita]);

    const resultado = await extensaoService.responder({
      aluguelId: "ped-1",
      extensaoId: "ext-1",
      cacambeiroId: "cacb-1",
      aceitar: true,
    });

    expect(resultado.status).toBe("AGUARDANDO_PAGAMENTO");
    expect(textoDaConsulta(sql.mock.calls[0])).toContain(
      "e.status = 'SOLICITADA'",
    );
    expect(textoDaConsulta(sql.mock.calls[0])).toContain(
      "e.solicitacao_expira_em > NOW()",
    );
    expect(notificar).toHaveBeenCalledWith(
      "EXTENSAO_ACEITA",
      "ped-1",
      expect.objectContaining({
        extensao: expect.objectContaining({ id: "ext-1" }),
      }),
    );
  });

  it("recusa e avisa o consumidor", async () => {
    sql.mockResolvedValueOnce([{ ...linhaAceita, status: "RECUSADA" }]);

    await extensaoService.responder({
      aluguelId: "ped-1",
      extensaoId: "ext-1",
      cacambeiroId: "cacb-1",
      aceitar: false,
    });

    expect(notificar.mock.calls[0][0]).toBe("EXTENSAO_RECUSADA");
  });

  it("pelo e-mail, procura pelo hash do token e nunca pelo token puro", async () => {
    sql.mockResolvedValueOnce([linhaAceita]);

    const token = "a".repeat(64);

    await extensaoService.responder({ token, aceitar: true });

    const valores = sql.mock.calls[0].slice(1);
    expect(valores).not.toContain(token);
    expect(valores.some((v) => /^[0-9a-f]{64}$/.test(String(v)))).toBe(true);
  });

  it("explica por que não respondeu", async () => {
    const consulta = (linha) => {
      sql.mockReset();
      sql.mockResolvedValueOnce([]).mockResolvedValueOnce(linha);
    };

    const argumentos = {
      aluguelId: "ped-1",
      extensaoId: "ext-1",
      cacambeiroId: "cacb-1",
      aceitar: true,
    };

    consulta([]);
    expect(await erroDe(extensaoService.responder(argumentos))).toMatchObject({
      statusCode: 404,
      code: "EXTENSION_NOT_FOUND",
    });

    consulta([{ status: "RECUSADA" }]);
    expect(await erroDe(extensaoService.responder(argumentos))).toMatchObject({
      statusCode: 409,
      code: "EXTENSION_ALREADY_ANSWERED",
    });

    consulta([
      {
        status: "SOLICITADA",
        solicitacao_expira_em: "2020-01-01T00:00:00Z",
        status_aluguel: "EM_USO",
      },
    ]);
    expect(await erroDe(extensaoService.responder(argumentos))).toMatchObject({
      statusCode: 410,
      code: "EXTENSION_EXPIRED",
    });

    consulta([
      {
        status: "SOLICITADA",
        solicitacao_expira_em: "2999-01-01T00:00:00Z",
        status_aluguel: "AGUARDANDO_RETIRADA",
      },
    ]);
    expect(await erroDe(extensaoService.responder(argumentos))).toMatchObject({
      statusCode: 409,
      code: "EXTENSION_INVALID_STATUS",
    });
  });

  it("exige identificação: nunca atualiza tudo sem filtro", async () => {
    await expect(
      extensaoService.responder({ aceitar: true }),
    ).rejects.toThrow(/Informe/);

    await expect(
      extensaoService.responder({ extensaoId: "ext-1", aceitar: true }),
    ).rejects.toThrow(/caçambeiro/);

    expect(sql).not.toHaveBeenCalled();
  });
});

describe("extensaoService.expirarVencidas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
  });

  it("avisa cada caso com o evento certo", async () => {
    sql.mockResolvedValueOnce([
      {
        motivo: "SEM_RESPOSTA",
        id: "e1",
        aluguel_id: "p1",
        dias_adicionais: 2,
        valor: "100",
      },
      {
        motivo: "SEM_PAGAMENTO",
        id: "e2",
        aluguel_id: "p2",
        dias_adicionais: 3,
        valor: "150",
      },
    ]);

    const total = await extensaoService.expirarVencidas();

    expect(total).toBe(2);
    expect(notificar.mock.calls[0][0]).toBe("EXTENSAO_SEM_RESPOSTA");
    expect(notificar.mock.calls[0][1]).toBe("p1");
    expect(notificar.mock.calls[1][0]).toBe("EXTENSAO_PAGAMENTO_EXPIRADO");
  });

  it("não avisa ninguém quando nada venceu", async () => {
    sql.mockResolvedValueOnce([]);

    expect(await extensaoService.expirarVencidas("p1")).toBe(0);
    expect(notificar).not.toHaveBeenCalled();
  });
});

describe("extensaoService.resumoDoPedido", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
  });

  it("indica que pode estender quando não há nada em aberto", async () => {
    sql
      .mockResolvedValueOnce([]) // expirarVencidas
      .mockResolvedValueOnce([]) // lista
      .mockResolvedValueOnce([pedidoElegivel]);

    const resumo = await extensaoService.resumoDoPedido("ped-1");

    expect(resumo).toMatchObject({
      permite_extensao: true,
      pode_estender: true,
      motivo_bloqueio: null,
      max_dias_por_extensao: 30,
      atual: null,
    });
  });

  it("não deixa pedir outra enquanto há uma em aberto", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "ext-1",
          aluguel_id: "ped-1",
          dias_adicionais: 2,
          valor: "100",
          status: "AGUARDANDO_PAGAMENTO",
        },
      ])
      .mockResolvedValueOnce([pedidoElegivel]);

    const resumo = await extensaoService.resumoDoPedido("ped-1");

    expect(resumo.pode_estender).toBe(false);
    expect(resumo.motivo_bloqueio).toBe("EXTENSION_ALREADY_OPEN");
    expect(resumo.atual.status).toBe("AGUARDANDO_PAGAMENTO");
  });

  it("reduz o máximo de dias perto do teto de 90", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...pedidoElegivel, dias_aluguel: 60, dias_extra: 20 },
      ]);

    const resumo = await extensaoService.resumoDoPedido("ped-1");

    expect(resumo.max_dias_por_extensao).toBe(10);
  });
});
