jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/emailService", () => ({
  enviarEmail: jest.fn(),
}));

const sql = require("../src/config/db");
const { enviarEmail } = require("../src/services/emailService");
const chat = require("../src/services/chatService");
const chatController = require("../src/controllers/chatController");

const MARIA = "11111111-1111-4111-8111-111111111111";
const ALFA = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const PEDIDO = "44444444-4444-4444-8444-444444444444";
const CONVERSA = "55555555-5555-4555-8555-555555555555";

const maria = { id: MARIA, perfil: "CONSUMIDOR" };
const alfa = { id: ALFA, perfil: "CACAMBEIRO" };
const admin = { id: ADMIN, perfil: "ADMIN" };

/**
 * `sql` é um mock: cada crase (inclusive os fragmentos aninhados) chama
 * a função. Respondemos pelo texto da consulta.
 */
function responder(regras) {
  sql.mockImplementation((strings, ...valores) => {
    const texto = strings.join("?");

    for (const [padrao, resposta] of regras) {
      if (padrao.test(texto)) {
        return Promise.resolve(
          typeof resposta === "function" ? resposta(valores) : resposta,
        );
      }
    }

    return Promise.resolve([]);
  });
}

function linhaDaConversa(extra = {}) {
  return {
    id: CONVERSA,
    tipo: "PEDIDO",
    aluguel_id: PEDIDO,
    consumidor_id: MARIA,
    cacambeiro_id: ALFA,
    assunto: null,
    status: "ABERTA",
    fechada_em: null,
    ultima_mensagem_em: null,
    denunciada_em: null,
    criada_em: new Date("2026-11-01T12:00:00Z"),
    encerrada_efetiva: null,
    consumidor_nome: "Maria Cliente",
    cacambeiro_nome: "Caçambas Alfa",
    ultima_texto: null,
    nao_lidas: 0,
    ...extra,
  };
}

const consultasDe = (padrao) =>
  sql.mock.calls.filter(([strings]) => padrao.test(strings.join("?")));

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
});

describe("regras de acesso", () => {
  const pedido = linhaDaConversa();
  const suporte = linhaDaConversa({
    tipo: "SUPORTE_CACAMBEIRO",
    aluguel_id: null,
    consumidor_id: null,
  });
  const chamado = linhaDaConversa({
    tipo: "CHAMADO",
    cacambeiro_id: null,
    assunto: "Cobrança",
  });

  it("cliente e caçambeiro participam só do que é deles", () => {
    expect(chat.acessoA(pedido, maria)).toEqual({
      lado: "CLIENTE",
      observador: false,
    });
    expect(chat.acessoA(pedido, alfa)).toEqual({
      lado: "CACAMBEIRO",
      observador: false,
    });
    expect(
      chat.acessoA(pedido, { id: "outro", perfil: "CONSUMIDOR" }),
    ).toBeNull();
    expect(
      chat.acessoA(pedido, { id: "outro", perfil: "CACAMBEIRO" }),
    ).toBeNull();
    // Mesmo id em outro perfil não vale.
    expect(chat.acessoA(pedido, { id: MARIA, perfil: "CACAMBEIRO" })).toBeNull();
    expect(chat.acessoA(suporte, maria)).toBeNull();
    expect(chat.acessoA(chamado, alfa)).toBeNull();
  });

  it("admin responde suporte e chamado, mas só observa pedido", () => {
    expect(chat.acessoA(suporte, admin)).toEqual({
      lado: "ADMIN",
      observador: false,
    });
    expect(chat.acessoA(chamado, admin)).toEqual({
      lado: "ADMIN",
      observador: false,
    });
    expect(chat.acessoA(pedido, admin)).toEqual({
      lado: null,
      observador: true,
    });
  });

  it("chamado fechado e pedido vencido bloqueiam o envio", () => {
    const aberto = { lado: "CLIENTE", observador: false };

    expect(chat.motivoBloqueio(chamado, aberto)).toBeNull();
    expect(
      chat.motivoBloqueio({ ...chamado, status: "FECHADA" }, aberto).codigo,
    ).toBe("CONVERSATION_CLOSED");
    expect(
      chat.motivoBloqueio(pedido, { lado: null, observador: true }).codigo,
    ).toBe("ADMIN_READ_ONLY");
  });

  it("pedido finalizado aceita mensagens por 7 dias", () => {
    const acesso = { lado: "CLIENTE", observador: false };
    const finalizado = {
      ...pedido,
      encerrada_efetiva: new Date("2026-11-01T12:00:00Z"),
    };

    expect(
      chat.motivoBloqueio(finalizado, acesso, new Date("2026-11-08T11:00:00Z")),
    ).toBeNull();
    expect(
      chat.motivoBloqueio(finalizado, acesso, new Date("2026-11-08T13:00:00Z"))
        .codigo,
    ).toBe("CONVERSATION_CLOSED");
  });

  it("o destino de cada mensagem é o outro lado", () => {
    expect(chat.ladoDestino("PEDIDO", "CLIENTE")).toBe("CACAMBEIRO");
    expect(chat.ladoDestino("PEDIDO", "CACAMBEIRO")).toBe("CLIENTE");
    expect(chat.ladoDestino("SUPORTE_CACAMBEIRO", "CACAMBEIRO")).toBe("ADMIN");
    expect(chat.ladoDestino("SUPORTE_CACAMBEIRO", "ADMIN")).toBe("CACAMBEIRO");
    expect(chat.ladoDestino("CHAMADO", "CLIENTE")).toBe("ADMIN");
    expect(chat.ladoDestino("CHAMADO", "ADMIN")).toBe("CLIENTE");
  });

  it("cada perfil vê o contato certo no topo da conversa", () => {
    expect(chat.contatoVisto(pedido, "CONSUMIDOR").nome).toBe("Caçambas Alfa");
    expect(chat.contatoVisto(pedido, "CACAMBEIRO").nome).toBe("Maria Cliente");
    expect(chat.contatoVisto(pedido, "ADMIN").nome).toBe(
      "Maria Cliente × Caçambas Alfa",
    );
    expect(chat.contatoVisto(chamado, "CONSUMIDOR").nome).toBe(
      chat.NOME_SUPORTE,
    );
    expect(chat.contatoVisto(chamado, "ADMIN")).toEqual({
      nome: "Maria Cliente",
      detalhe: "Cobrança",
    });
    expect(chat.contatoVisto(suporte, "CACAMBEIRO").nome).toBe(
      chat.NOME_SUPORTE,
    );
    expect(chat.contatoVisto(suporte, "ADMIN").nome).toBe("Caçambas Alfa");
  });
});

describe("enviarMensagem", () => {
  it("grava a mensagem do lado de quem escreveu", async () => {
    responder([
      [/FROM conversas c/, [linhaDaConversa()]],
      [
        /INSERT INTO mensagens/,
        [
          {
            id: 7,
            texto: "Olá",
            lado: "CLIENTE",
            criada_em: new Date(),
            lida_em: null,
          },
        ],
      ],
    ]);

    const mensagem = await chat.enviarMensagem(maria, CONVERSA, "  Olá  ");

    expect(mensagem).toMatchObject({ id: 7, texto: "Olá", minha: true });

    const insercao = consultasDe(/INSERT INTO mensagens/)[0];
    // Os dois últimos são da atualização de ultima_mensagem_em, no mesmo CTE.
    expect(insercao.slice(1)).toEqual([
      CONVERSA,
      MARIA,
      "CLIENTE",
      "Olá",
      CONVERSA,
    ]);
  });

  it("recusa texto vazio ou grande sem consultar o banco", async () => {
    for (const texto of ["", "   ", "x".repeat(1001), undefined]) {
      await expect(
        chat.enviarMensagem(maria, CONVERSA, texto),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
    }

    expect(sql).not.toHaveBeenCalled();
  });

  it("admin não escreve em conversa de pedido", async () => {
    responder([[/FROM conversas c/, [linhaDaConversa()]]]);

    await expect(
      chat.enviarMensagem(admin, CONVERSA, "oi"),
    ).rejects.toMatchObject({ code: "ADMIN_READ_ONLY", statusCode: 403 });
    expect(consultasDe(/INSERT INTO mensagens/)).toHaveLength(0);
  });

  it("chamado fechado devolve 409", async () => {
    responder([
      [
        /FROM conversas c/,
        [
          linhaDaConversa({
            tipo: "CHAMADO",
            cacambeiro_id: null,
            status: "FECHADA",
            assunto: "x",
          }),
        ],
      ],
    ]);

    await expect(
      chat.enviarMensagem(maria, CONVERSA, "oi"),
    ).rejects.toMatchObject({ code: "CONVERSATION_CLOSED", statusCode: 409 });
  });

  it("quem não participa recebe 404", async () => {
    responder([[/FROM conversas c/, [linhaDaConversa()]]]);

    await expect(
      chat.enviarMensagem({ id: "x", perfil: "CONSUMIDOR" }, CONVERSA, "oi"),
    ).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
      statusCode: 404,
    });

    responder([]);

    await expect(
      chat.enviarMensagem(maria, CONVERSA, "oi"),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
});

describe("abrirChamado", () => {
  it("cliente com chamado aberto recebe 409 com a conversa existente", async () => {
    const duplicado = Object.assign(new Error("unique"), { code: "23505" });

    responder([
      [
        /WITH nova AS/,
        () => {
          throw duplicado;
        },
      ],
      [/FROM conversas\s+WHERE tipo = 'CHAMADO'/, [{ id: CONVERSA }]],
    ]);

    await expect(
      chat.abrirChamado(maria, { assunto: "Cobrança", mensagem: "Oi" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CHAMADO_ALREADY_OPEN",
      fields: { conversa_id: CONVERSA },
    });
  });

  it("exige assunto e mensagem", async () => {
    await expect(
      chat.abrirChamado(maria, { assunto: " ", mensagem: "Oi" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      chat.abrirChamado(maria, { assunto: "x".repeat(121), mensagem: "Oi" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      chat.abrirChamado(maria, { assunto: "Ok", mensagem: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("avisarMensagensNaoLidas", () => {
  const grupo = {
    conversa_id: CONVERSA,
    lado: "CLIENTE",
    total: 2,
    tipo: "PEDIDO",
    aluguel_id: PEDIDO,
    assunto: null,
    status: "ABERTA",
    consumidor_id: MARIA,
    cacambeiro_id: ALFA,
    consumidor_nome: "Maria Cliente",
    consumidor_email: "maria@x.com",
    consumidor_status: "ATIVO",
    cacambeiro_nome: "Caçambas Alfa",
    cacambeiro_email: "alfa@x.com",
    cacambeiro_status: "ATIVO",
  };

  it("sem mensagens atrasadas não envia nada", async () => {
    responder([]);

    await expect(chat.avisarMensagensNaoLidas()).resolves.toEqual({
      conversas: 0,
      emails: 0,
    });
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("avisa o destinatário e marca o grupo como avisado", async () => {
    responder([[/FROM mensagens m\s+INNER JOIN conversas c/, [grupo]]]);
    enviarEmail.mockResolvedValue(undefined);

    const resultado = await chat.avisarMensagensNaoLidas();

    expect(resultado).toEqual({ conversas: 1, emails: 1 });
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    expect(enviarEmail.mock.calls[0][0]).toMatchObject({
      para: "alfa@x.com",
    });
    expect(enviarEmail.mock.calls[0][0].texto).toContain("2 mensagens");

    const marcacao = consultasDe(/SET aviso_email_em = NOW\(\)/);
    expect(marcacao).toHaveLength(1);
    expect(marcacao[0].slice(1)).toEqual([CONVERSA, "CLIENTE"]);
  });

  it("e-mail que falha não marca: tenta de novo na próxima rodada", async () => {
    responder([[/FROM mensagens m\s+INNER JOIN conversas c/, [grupo]]]);
    enviarEmail.mockRejectedValue(new Error("Brevo fora do ar"));
    jest.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await chat.avisarMensagensNaoLidas();

    expect(resultado).toEqual({ conversas: 0, emails: 1 });
    expect(consultasDe(/SET aviso_email_em = NOW\(\)/)).toHaveLength(0);

    console.error.mockRestore();
  });

  it("não envia à conta suspensa, mas não insiste nas mensagens", async () => {
    responder([
      [
        /FROM mensagens m\s+INNER JOIN conversas c/,
        [{ ...grupo, cacambeiro_status: "SUSPENSO" }],
      ],
    ]);

    await chat.avisarMensagensNaoLidas();

    expect(enviarEmail).not.toHaveBeenCalled();
    expect(consultasDe(/SET aviso_email_em = NOW\(\)/)).toHaveLength(1);
  });

  it("mensagem do cliente ao suporte avisa todos os admins", async () => {
    responder([
      [
        /FROM mensagens m\s+INNER JOIN conversas c/,
        [
          {
            ...grupo,
            tipo: "CHAMADO",
            aluguel_id: null,
            cacambeiro_id: null,
            assunto: "Cobrança",
          },
        ],
      ],
      [
        /FROM usuarios\s+WHERE tipo_perfil = 'ADMIN'/,
        [
          { id: "a1", nome_completo: "Admin Um", email: "a1@x.com" },
          { id: "a2", nome_completo: "Admin Dois", email: "a2@x.com" },
        ],
      ],
    ]);
    enviarEmail.mockResolvedValue(undefined);

    await chat.avisarMensagensNaoLidas();

    expect(enviarEmail.mock.calls.map(([m]) => m.para).sort()).toEqual([
      "a1@x.com",
      "a2@x.com",
    ]);
  });
});

describe("POST /api/internal/jobs/chat", () => {
  const original = process.env.JOBS_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.JOBS_SECRET;
    else process.env.JOBS_SECRET = original;
  });

  it("sem o segredo correto responde 403", async () => {
    process.env.JOBS_SECRET = "segredo";

    const res = createResponse();
    await chatController.rodarVarredura({ get: () => "outro" }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(sql).not.toHaveBeenCalled();
  });

  it("rota desativada quando JOBS_SECRET está vazio", async () => {
    delete process.env.JOBS_SECRET;

    const res = createResponse();
    await chatController.rodarVarredura({ get: () => "" }, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("com o segredo, roda a varredura", async () => {
    process.env.JOBS_SECRET = "segredo";
    responder([]);

    const res = createResponse();
    await chatController.rodarVarredura({ get: () => "segredo" }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      data: { conversas: 0, emails: 0 },
    });
  });
});

describe("denunciar", () => {
  it("duas denúncias do mesmo usuário em 24 h: segunda recusada", async () => {
    responder([
      [/FROM conversas c/, [linhaDaConversa()]],
      [/FROM denuncias_chat/, [{ id: "d1" }]],
    ]);

    await expect(
      chat.denunciar(maria, CONVERSA, "abuso"),
    ).rejects.toMatchObject({ code: "ALREADY_REPORTED", statusCode: 409 });
    expect(consultasDe(/INSERT INTO denuncias_chat/)).toHaveLength(0);
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("denunciar registra, marca a conversa e avisa os admins", async () => {
    responder([
      [/FROM conversas c/, [linhaDaConversa()]],
      [/SELECT nome_completo FROM usuarios/, [{ nome_completo: "Maria" }]],
      [
        /FROM usuarios\s+WHERE tipo_perfil = 'ADMIN'/,
        [{ id: "a1", nome_completo: "Admin Um", email: "a1@x.com" }],
      ],
    ]);
    enviarEmail.mockResolvedValue(undefined);

    await chat.denunciar(maria, CONVERSA, "  Linguagem ofensiva  ");

    expect(consultasDe(/INSERT INTO denuncias_chat/)).toHaveLength(1);
    expect(consultasDe(/SET denunciada_em = COALESCE/)).toHaveLength(1);
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    expect(enviarEmail.mock.calls[0][0].texto).toContain("Linguagem ofensiva");
  });
});
