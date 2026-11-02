jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/contratoService", () => ({
  VERSAO_TERMOS: "1.0",
  buscarContrato: jest.fn(),
  emitirContrato: jest.fn(),
}));

jest.mock("../src/services/notificacaoService", () => ({
  EVENTOS: { PEDIDO_CRIADO: "PEDIDO_CRIADO" },
  EVENTO_POR_STATUS: {
    EM_USO: "ENTREGUE",
    AGUARDANDO_RETIRADA: "RETIRADA_SOLICITADA",
    FINALIZADO: "FINALIZADO",
  },
  notificar: jest.fn(),
}));

jest.mock("../src/services/extensaoService", () => ({
  resumoDoPedido: jest.fn(),
  cancelarSolicitacoesAbertas: jest.fn().mockResolvedValue(undefined),
}));

const fs = require("fs");
const os = require("os");
const path = require("path");

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "collect-checkout-"));
  process.env.UPLOADS_DIR = raiz;
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});

const sql = require("../src/config/db");
const contratoService = require("../src/services/contratoService");
const { notificar } = require("../src/services/notificacaoService");
const alugueisController = require("../src/controllers/alugueisController");
const { png, dataUri } = require("./helpers/imagens");

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function dataFutura(dias) {
  const data = new Date();
  data.setDate(data.getDate() + dias);

  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

function criarRequisicao(corpo = {}) {
  return {
    usuario_id: "cons-1",
    ip: "203.0.113.5",
    get: (nome) => (nome === "user-agent" ? "jest" : undefined),
    body: {
      endereco_id: "end-1",
      data_inicio: dataFutura(3),
      aceite_termos: true,
      assinatura_base64: dataUri(png(500, 200)),
      ...corpo,
    },
  };
}

function arquivosDeAssinatura() {
  const pasta = path.join(raiz, "private", "assinaturas");

  return fs.existsSync(pasta) ? fs.readdirSync(pasta) : [];
}

const pedidoCriado = {
  id: "11111111-2222-3333-4444-555555555555",
  consumidor_id: "cons-1",
  preco_final: "450.00",
};

describe("checkout com aceite e assinatura", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    fs.rmSync(path.join(raiz, "private"), { recursive: true, force: true });
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it("cria o pedido, grava a assinatura, gera o contrato e avisa por e-mail", async () => {
    sql
      .mockResolvedValueOnce([{ id: "end-1" }]) // endereço
      .mockResolvedValueOnce([{ id: "carrinho-1" }]) // carrinho
      .mockResolvedValueOnce([pedidoCriado]); // checkout atômico

    const pdf = Buffer.from("%PDF-1.3");
    contratoService.emitirContrato.mockResolvedValueOnce(pdf);

    const res = createResponse();
    await alugueisController.checkout(criarRequisicao(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      id: pedidoCriado.id,
      contrato_disponivel: true,
    });

    // A assinatura ficou em disco com o nome do contrato.
    const arquivos = arquivosDeAssinatura();
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0]).toMatch(/^[0-9a-f-]{36}-consumidor\.png$/);

    // O INSERT do contrato está na mesma instrução do pedido.
    const checkout = sql.mock.calls[2];
    const textoSql = checkout[0].join("?");
    expect(textoSql).toContain("novo_pedido AS");
    expect(textoSql).toContain("INSERT INTO contratos_locacao");
    // O pedido só é devolvido se o contrato também foi criado.
    expect(textoSql).toMatch(/FROM novo_contrato/);

    const valores = checkout.slice(1);
    expect(valores).toContain("1.0"); // versão dos termos
    expect(valores).toContain("203.0.113.5"); // IP do aceite
    expect(valores).toContain(`private/assinaturas/${arquivos[0]}`);

    expect(contratoService.emitirContrato).toHaveBeenCalledWith(
      pedidoCriado.id,
    );
    expect(notificar).toHaveBeenCalledWith("PEDIDO_CRIADO", pedidoCriado.id, {
      contratoPdf: pdf,
    });
  });

  it("o pedido continua válido se o PDF falhar (contrato fica pendente)", async () => {
    sql
      .mockResolvedValueOnce([{ id: "end-1" }])
      .mockResolvedValueOnce([{ id: "carrinho-1" }])
      .mockResolvedValueOnce([pedidoCriado]);

    contratoService.emitirContrato.mockRejectedValueOnce(
      new Error("falha no PDF"),
    );

    const res = createResponse();
    await alugueisController.checkout(criarRequisicao(), res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data.contrato_disponivel).toBe(false);
    expect(arquivosDeAssinatura()).toHaveLength(1);
  });

  it("assinatura inválida: 400, sem tocar no banco nem gravar arquivo", async () => {
    const res = createResponse();

    await alugueisController.checkout(
      criarRequisicao({
        assinatura_base64: dataUri(Buffer.from("não sou uma imagem 1234")),
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      code: "INVALID_IMAGE",
      fields: { assinatura_base64: expect.any(String) },
    });
    expect(sql).not.toHaveBeenCalled();
    expect(arquivosDeAssinatura()).toHaveLength(0);
  });

  it("assinatura ausente: 400", async () => {
    const res = createResponse();

    await alugueisController.checkout(
      criarRequisicao({ assinatura_base64: undefined }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(sql).not.toHaveBeenCalled();
  });

  it("carrinho vazio: apaga a assinatura que ainda nem foi gravada", async () => {
    sql
      .mockResolvedValueOnce([{ id: "end-1" }])
      .mockResolvedValueOnce([]); // sem carrinho

    const res = createResponse();
    await alugueisController.checkout(criarRequisicao(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(arquivosDeAssinatura()).toHaveLength(0);
    expect(contratoService.emitirContrato).not.toHaveBeenCalled();
  });

  it("checkout que não cria pedido apaga a assinatura gravada", async () => {
    sql
      .mockResolvedValueOnce([{ id: "end-1" }])
      .mockResolvedValueOnce([{ id: "carrinho-1" }])
      .mockResolvedValueOnce([]); // CTE não criou o pedido

    const res = createResponse();
    await alugueisController.checkout(criarRequisicao(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("CHECKOUT_FAILED");
    expect(arquivosDeAssinatura()).toHaveLength(0);
    expect(notificar).not.toHaveBeenCalled();
  });

  it("erro no banco apaga a assinatura gravada", async () => {
    sql
      .mockResolvedValueOnce([{ id: "end-1" }])
      .mockResolvedValueOnce([{ id: "carrinho-1" }])
      .mockRejectedValueOnce(new Error("banco caiu"));

    const res = createResponse();
    await alugueisController.checkout(criarRequisicao(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(arquivosDeAssinatura()).toHaveLength(0);
  });
});

describe("atualizarStatus", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
  });

  it("avisa o consumidor da nova etapa e cancela extensões abertas ao sair de EM_USO", async () => {
    const extensaoService = require("../src/services/extensaoService");

    sql.mockResolvedValueOnce([{ id: "ped-1", status_aluguel: "AGUARDANDO_RETIRADA" }]);

    const res = createResponse();

    await alugueisController.atualizarStatus(
      {
        usuario_id: "cacb-1",
        params: { id: "ped-1" },
        body: { status_aluguel: "AGUARDANDO_RETIRADA" },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(notificar).toHaveBeenCalledWith("RETIRADA_SOLICITADA", "ped-1");
    expect(extensaoService.cancelarSolicitacoesAbertas).toHaveBeenCalledWith(
      "ped-1",
    );
  });

  it("entrega (EM_USO) avisa mas não cancela extensões", async () => {
    const extensaoService = require("../src/services/extensaoService");

    sql.mockResolvedValueOnce([{ id: "ped-1", status_aluguel: "EM_USO" }]);

    const res = createResponse();

    await alugueisController.atualizarStatus(
      {
        usuario_id: "cacb-1",
        params: { id: "ped-1" },
        body: { status_aluguel: "EM_USO" },
      },
      res,
    );

    expect(notificar).toHaveBeenCalledWith("ENTREGUE", "ped-1");
    expect(extensaoService.cancelarSolicitacoesAbertas).not.toHaveBeenCalled();
  });

  it("transição inválida não envia e-mail", async () => {
    sql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "ped-1", status_aluguel: "AGUARDANDO_ENTREGA" }]);

    const res = createResponse();

    await alugueisController.atualizarStatus(
      {
        usuario_id: "cacb-1",
        params: { id: "ped-1" },
        body: { status_aluguel: "FINALIZADO" },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(409);
    expect(notificar).not.toHaveBeenCalled();
  });
});
