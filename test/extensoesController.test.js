jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/extensaoService", () => {
  const actual = jest.requireActual("../src/services/extensaoService");

  return {
    ...actual,
    expirarVencidas: jest.fn().mockResolvedValue(0),
    buscarPorToken: jest.fn(),
    responder: jest.fn(),
    solicitar: jest.fn(),
    listarDoPedido: jest.fn(),
    resumoDoPedido: jest.fn(),
  };
});

jest.mock("../src/services/acessoPedido", () => ({
  buscarPedidoDoUsuario: jest.fn(),
}));

const extensaoService = require("../src/services/extensaoService");
const { buscarPedidoDoUsuario } = require("../src/services/acessoPedido");
const ApiError = require("../src/utils/apiError");
const controller = require("../src/controllers/extensoesController");

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
}

const TOKEN = "a".repeat(64);

const dadosDaExtensao = {
  id: "ext-1",
  status: "SOLICITADA",
  dias_adicionais: 4,
  valor: "1200.00",
  pedido_id: "11111111-2222-3333-4444-555555555555",
  data_inicio: "2026-11-02",
  consumidor_nome: 'Maria <script>alert("x")</script>',
};

describe("página pública de resposta (link do e-mail)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it("GET só mostra os dados e NUNCA decide: aceitar exige POST", async () => {
    extensaoService.buscarPorToken.mockResolvedValueOnce(dadosDaExtensao);

    const res = createResponse();
    await controller.paginaResposta({ params: { token: TOKEN } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(extensaoService.responder).not.toHaveBeenCalled();

    const html = res.send.mock.calls[0][0];
    expect(html).toContain('method="post"');
    expect(html).toContain('value="ACEITAR"');
    expect(html).toContain('value="RECUSAR"');
    expect(html).toContain("COL-1111111122");
    expect(html).toContain("02/11/2026");
  });

  it("escapa o nome vindo do banco e bloqueia indexação e cache", async () => {
    extensaoService.buscarPorToken.mockResolvedValueOnce(dadosDaExtensao);

    const res = createResponse();
    await controller.paginaResposta({ params: { token: TOKEN } }, res);

    const html = res.send.mock.calls[0][0];
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      }),
    );
  });

  it("link inválido responde 404 sem detalhes", async () => {
    extensaoService.buscarPorToken.mockResolvedValueOnce(null);

    const res = createResponse();
    await controller.paginaResposta({ params: { token: "x" } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("pedido já respondido não mostra os botões", async () => {
    extensaoService.buscarPorToken.mockResolvedValueOnce({
      ...dadosDaExtensao,
      status: "AGUARDANDO_PAGAMENTO",
    });

    const res = createResponse();
    await controller.paginaResposta({ params: { token: TOKEN } }, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.send.mock.calls[0][0]).not.toContain("<form");
  });

  it("POST aceita usando o token (sem login)", async () => {
    extensaoService.responder.mockResolvedValueOnce({ id: "ext-1" });

    const res = createResponse();
    await controller.confirmarResposta(
      { params: { token: TOKEN }, body: { acao: "ACEITAR" } },
      res,
    );

    expect(extensaoService.responder).toHaveBeenCalledWith({
      token: TOKEN,
      aceitar: true,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send.mock.calls[0][0]).toContain("24 horas");
  });

  it("POST recusa", async () => {
    extensaoService.responder.mockResolvedValueOnce({ id: "ext-1" });

    const res = createResponse();
    await controller.confirmarResposta(
      { params: { token: TOKEN }, body: { acao: "RECUSAR" } },
      res,
    );

    expect(extensaoService.responder).toHaveBeenCalledWith({
      token: TOKEN,
      aceitar: false,
    });
  });

  it("POST com ação desconhecida não chama o serviço", async () => {
    const res = createResponse();
    await controller.confirmarResposta(
      { params: { token: TOKEN }, body: { acao: "APAGAR" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(extensaoService.responder).not.toHaveBeenCalled();

    const semCorpo = createResponse();
    await controller.confirmarResposta({ params: { token: TOKEN } }, semCorpo);
    expect(semCorpo.status).toHaveBeenCalledWith(400);
  });

  it("POST mostra o motivo quando o prazo acabou", async () => {
    extensaoService.responder.mockRejectedValueOnce(
      new ApiError(410, "O prazo para responder a este pedido terminou.", "EXTENSION_EXPIRED"),
    );

    const res = createResponse();
    await controller.confirmarResposta(
      { params: { token: TOKEN }, body: { acao: "ACEITAR" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.send.mock.calls[0][0]).toContain("prazo");
  });
});

describe("rotas autenticadas", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it("solicitar devolve 201 com a extensão", async () => {
    extensaoService.solicitar.mockResolvedValueOnce({ id: "ext-1" });

    const res = createResponse();
    await controller.solicitar(
      {
        usuario_id: "cons-1",
        params: { id: "ped-1" },
        body: { dias_adicionais: 4 },
      },
      res,
    );

    expect(extensaoService.solicitar).toHaveBeenCalledWith({
      aluguelId: "ped-1",
      consumidorId: "cons-1",
      dias: 4,
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("repassa o código de erro de regra de negócio", async () => {
    extensaoService.solicitar.mockRejectedValueOnce(
      new ApiError(422, "Esta caçamba não permite extensão do aluguel.", "EXTENSION_NOT_ALLOWED"),
    );

    const res = createResponse();
    await controller.solicitar(
      {
        usuario_id: "cons-1",
        params: { id: "ped-1" },
        body: { dias_adicionais: 4 },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0]).toEqual({
      success: false,
      message: "Esta caçamba não permite extensão do aluguel.",
      code: "EXTENSION_NOT_ALLOWED",
    });
  });

  it("responder passa o pedido, a extensão e o caçambeiro logado", async () => {
    extensaoService.responder.mockResolvedValueOnce({ id: "ext-1" });

    const res = createResponse();
    await controller.responder(
      {
        usuario_id: "cacb-1",
        params: { id: "ped-1", extId: "ext-1" },
        body: { acao: "RECUSAR" },
      },
      res,
    );

    expect(extensaoService.responder).toHaveBeenCalledWith({
      aluguelId: "ped-1",
      extensaoId: "ext-1",
      cacambeiroId: "cacb-1",
      aceitar: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("listar não revela pedido de terceiros", async () => {
    buscarPedidoDoUsuario.mockResolvedValueOnce(null);

    const res = createResponse();
    await controller.listar(
      { usuario_id: "x", tipo_perfil: "CONSUMIDOR", params: { id: "ped-1" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(extensaoService.listarDoPedido).not.toHaveBeenCalled();
  });

  it("listar devolve o resumo e as extensões ao dono", async () => {
    buscarPedidoDoUsuario.mockResolvedValueOnce({ id: "ped-1" });
    extensaoService.listarDoPedido.mockResolvedValueOnce([{ id: "ext-1" }]);
    extensaoService.resumoDoPedido.mockResolvedValueOnce({ pode_estender: false });

    const res = createResponse();
    await controller.listar(
      { usuario_id: "cons-1", tipo_perfil: "CONSUMIDOR", params: { id: "ped-1" } },
      res,
    );

    expect(res.json.mock.calls[0][0].data).toEqual({
      resumo: { pode_estender: false },
      extensoes: [{ id: "ext-1" }],
    });
  });
});

describe("job de varredura (cron externo)", () => {
  const ambiente = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JOBS_SECRET = "segredo-do-cron";
  });

  afterEach(() => {
    process.env = { ...ambiente };
  });

  const requisicao = (valor) => ({
    get: (nome) => (nome === "x-jobs-secret" ? valor : undefined),
  });

  it("roda com o segredo correto", async () => {
    extensaoService.expirarVencidas.mockResolvedValueOnce(3);

    const res = createResponse();
    await controller.rodarVarredura(requisicao("segredo-do-cron"), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({ expiradas: 3 });
  });

  it("nega segredo errado, ausente ou de outro tamanho", async () => {
    for (const valor of ["errado-errado-x", "", undefined, "x"]) {
      const res = createResponse();
      await controller.rodarVarredura(requisicao(valor), res);

      expect(res.status).toHaveBeenCalledWith(403);
    }

    expect(extensaoService.expirarVencidas).not.toHaveBeenCalled();
  });

  it("nega tudo quando JOBS_SECRET não está configurado", async () => {
    delete process.env.JOBS_SECRET;

    const res = createResponse();
    await controller.rodarVarredura(requisicao(""), res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
