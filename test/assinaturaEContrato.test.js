jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/acessoPedido", () => ({
  buscarPedidoDoUsuario: jest.fn(),
}));

jest.mock("../src/services/contratoService", () => ({
  buscarContrato: jest.fn(),
  emitirContrato: jest.fn(),
  codigoDoPedido: (id) => `COL-${id.slice(0, 4)}`,
}));

const fs = require("fs");
const os = require("os");
const path = require("path");

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "collect-assin-"));
  process.env.UPLOADS_DIR = raiz;
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});

const sql = require("../src/config/db");
const storage = require("../src/services/storageService");
const { buscarPedidoDoUsuario } = require("../src/services/acessoPedido");
const contratoService = require("../src/services/contratoService");
const assinaturasController = require("../src/controllers/assinaturasController");
const contratosController = require("../src/controllers/contratosController");
const { png, jpeg, dataUri } = require("./helpers/imagens");

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
}

function arquivosDeAssinatura() {
  const pasta = path.join(raiz, "private", "assinaturas");

  return fs.existsSync(pasta) ? fs.readdirSync(pasta) : [];
}

describe("assinatura da empresa", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    fs.rmSync(path.join(raiz, "private"), { recursive: true, force: true });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it("salva o PNG 3:1, grava o caminho e não devolve a imagem", async () => {
    sql.mockResolvedValueOnce([
      { assinatura_atualizada_em: "2026-11-01T10:00:00Z", anterior: null },
    ]);

    const res = createResponse();
    await assinaturasController.salvar(
      {
        usuario_id: "cacb-1",
        body: { assinatura_base64: dataUri(png(600, 200)) },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual({
      tem_assinatura: true,
      atualizada_em: "2026-11-01T10:00:00Z",
    });

    const arquivos = arquivosDeAssinatura();
    expect(arquivos).toHaveLength(1);
    expect(sql.mock.calls[0].slice(1)).toContain(
      `private/assinaturas/${arquivos[0]}`,
    );
  });

  it("apaga o arquivo antigo depois de salvar o novo", async () => {
    const antiga = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      png(600, 200),
    );

    sql.mockResolvedValueOnce([
      { assinatura_atualizada_em: "2026-11-01T10:00:00Z", anterior: antiga },
    ]);

    await assinaturasController.salvar(
      {
        usuario_id: "cacb-1",
        body: { assinatura_base64: dataUri(png(900, 300)) },
      },
      createResponse(),
    );

    const arquivos = arquivosDeAssinatura();
    expect(arquivos).toHaveLength(1);
    expect(antiga.endsWith(arquivos[0])).toBe(false);
  });

  it("rejeita proporção errada, formato errado e tamanho fora do limite", async () => {
    const casos = [
      dataUri(png(600, 400)), // não é 3:1
      dataUri(jpeg(600, 200), "image/jpeg"), // não é PNG
      dataUri(png(150, 50)), // pequena demais
      dataUri(png(600, 200, 400 * 1024)), // maior que 300 KB
    ];

    for (const assinatura_base64 of casos) {
      const res = createResponse();
      await assinaturasController.salvar(
        { usuario_id: "cacb-1", body: { assinatura_base64 } },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].code).toBe("INVALID_IMAGE");
    }

    expect(sql).not.toHaveBeenCalled();
    expect(arquivosDeAssinatura()).toHaveLength(0);
  });

  it("sem perfil de fornecedor: 404 e nenhum arquivo sobra", async () => {
    sql.mockResolvedValueOnce([]);

    const res = createResponse();
    await assinaturasController.salvar(
      {
        usuario_id: "cacb-1",
        body: { assinatura_base64: dataUri(png(600, 200)) },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(arquivosDeAssinatura()).toHaveLength(0);
  });

  it("apaga o arquivo novo se o banco falhar", async () => {
    sql.mockRejectedValueOnce(new Error("banco caiu"));

    const res = createResponse();
    await assinaturasController.salvar(
      {
        usuario_id: "cacb-1",
        body: { assinatura_base64: dataUri(png(600, 200)) },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(arquivosDeAssinatura()).toHaveLength(0);
  });

  it("obter devolve a imagem só para o dono, sem cache", async () => {
    const chave = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      png(600, 200),
    );

    sql.mockResolvedValueOnce([{ assinatura_path: chave }]);

    const res = createResponse();
    await assinaturasController.obter({ usuario_id: "cacb-1" }, res);

    expect(sql.mock.calls[0].slice(1)).toEqual(["cacb-1"]);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
      }),
    );
    expect(Buffer.isBuffer(res.send.mock.calls[0][0])).toBe(true);
  });

  it("obter responde 404 sem assinatura cadastrada ou com arquivo ausente", async () => {
    sql.mockResolvedValueOnce([{ assinatura_path: null }]);
    let res = createResponse();
    await assinaturasController.obter({ usuario_id: "cacb-1" }, res);
    expect(res.status).toHaveBeenCalledWith(404);

    sql.mockResolvedValueOnce([
      { assinatura_path: "private/assinaturas/sumiu.png" },
    ]);
    res = createResponse();
    await assinaturasController.obter({ usuario_id: "cacb-1" }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("remover limpa o banco e apaga o arquivo", async () => {
    const chave = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      png(600, 200),
    );

    sql.mockResolvedValueOnce([{ anterior: chave }]);

    const res = createResponse();
    await assinaturasController.remover({ usuario_id: "cacb-1" }, res);

    expect(res.json.mock.calls[0][0].data).toEqual({ tem_assinatura: false });
    expect(arquivosDeAssinatura()).toHaveLength(0);
  });
});

describe("contratosController.baixar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  const requisicao = {
    usuario_id: "cons-1",
    tipo_perfil: "CONSUMIDOR",
    params: { id: "abcd0000-0000-0000-0000-000000000000" },
  };

  it("entrega o PDF inline, privado e sem cache", async () => {
    buscarPedidoDoUsuario.mockResolvedValueOnce({ id: requisicao.params.id });
    contratoService.buscarContrato.mockResolvedValueOnce({ id: "c1" });
    contratoService.emitirContrato.mockResolvedValueOnce(Buffer.from("%PDF-1.3"));

    const res = createResponse();
    await contratosController.baixar(requisicao, res);

    expect(buscarPedidoDoUsuario).toHaveBeenCalledWith(
      requisicao.params.id,
      "cons-1",
      "CONSUMIDOR",
    );
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'inline; filename="contrato-COL-abcd.pdf"',
      }),
    );
    expect(res.send.mock.calls[0][0].toString()).toBe("%PDF-1.3");
  });

  it("pedido de outra pessoa responde 404, sem tocar no contrato", async () => {
    buscarPedidoDoUsuario.mockResolvedValueOnce(null);

    const res = createResponse();
    await contratosController.baixar(requisicao, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(contratoService.buscarContrato).not.toHaveBeenCalled();
    expect(contratoService.emitirContrato).not.toHaveBeenCalled();
  });

  it("pedido anterior ao recurso não tem contrato", async () => {
    buscarPedidoDoUsuario.mockResolvedValueOnce({ id: requisicao.params.id });
    contratoService.buscarContrato.mockResolvedValueOnce(null);

    const res = createResponse();
    await contratosController.baixar(requisicao, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe("CONTRACT_NOT_FOUND");
  });

  it("erro ao gerar vira 500 sem vazar detalhes", async () => {
    buscarPedidoDoUsuario.mockResolvedValueOnce({ id: requisicao.params.id });
    contratoService.buscarContrato.mockResolvedValueOnce({ id: "c1" });
    contratoService.emitirContrato.mockRejectedValueOnce(
      new Error("caminho secreto /srv/x"),
    );

    const res = createResponse();
    await contratosController.baixar(requisicao, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("/srv/x");
  });
});
