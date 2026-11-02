jest.mock("../src/config/db", () => jest.fn());

// Usa o gerador real, mas deixa conferir os dados recebidos.
jest.mock("../src/services/contratoPdfService", () => {
  const actual = jest.requireActual("../src/services/contratoPdfService");

  return {
    ...actual,
    gerarContratoPdf: jest.fn(actual.gerarContratoPdf),
  };
});


const fs = require("fs");
const os = require("os");
const path = require("path");

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "collect-contrato-"));
  process.env.UPLOADS_DIR = raiz;
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});

const sql = require("../src/config/db");
const storage = require("../src/services/storageService");
const contratoService = require("../src/services/contratoService");
const { png } = require("./helpers/imagens");

const ALUGUEL_ID = "11111111-2222-3333-4444-555555555555";
const CONTRATO_ID = "99999999-8888-7777-6666-555555555555";

const pedido = {
  id: ALUGUEL_ID,
  data_inicio: "2026-11-02",
  dias_aluguel: 7,
  preco_final: "2140.00",
  consumidor_nome: "Maria Souza",
  consumidor_documento: "12345678901",
  consumidor_email: "maria@exemplo.com",
  cacambeiro_nome: "Locadora SP",
  cacambeiro_documento: "12345678000190",
  cacambeiro_assinatura_path: null,
  cep: "01001000",
  logradouro: "Rua das Flores",
  numero: "123",
  bairro: "Centro",
  cidade_estado: "São Paulo - SP",
};

const itens = [
  {
    nome: "Caçamba 5m³",
    tamanho_m3: "5.00",
    quantidade: 2,
    dias: 7,
    preco_diaria: "150.00",
  },
];

async function prepararAssinaturas({ empresa = false } = {}) {
  const consumidor = await storage.salvarArquivo(
    "private/assinaturas",
    "png",
    png(500, 200),
    `${CONTRATO_ID}-consumidor`,
  );

  let chaveEmpresa = null;

  if (empresa) {
    chaveEmpresa = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      png(600, 200),
    );
  }

  return { consumidor, chaveEmpresa };
}

function contratoPendente(assinaturaConsumidor, extra = {}) {
  return {
    id: CONTRATO_ID,
    aluguel_id: ALUGUEL_ID,
    versao_termos: "1.0",
    aceite_em: new Date("2026-10-31T21:34:00Z"),
    aceite_ip: "203.0.113.5",
    assinatura_consumidor_path: assinaturaConsumidor,
    assinatura_cacambeiro_path: null,
    pdf_path: null,
    status: "PENDENTE",
    ...extra,
  };
}

describe("contratoService.emitirContrato", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    fs.rmSync(path.join(raiz, "private"), { recursive: true, force: true });
    // As imagens de teste são só cabeçalhos; o PDF registra e segue.
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it("devolve null para pedido sem contrato (anterior ao recurso)", async () => {
    sql.mockResolvedValueOnce([]);

    expect(await contratoService.emitirContrato(ALUGUEL_ID)).toBeNull();
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("gera o PDF, grava em disco e registra caminho e hash", async () => {
    const { consumidor } = await prepararAssinaturas();

    sql
      .mockResolvedValueOnce([contratoPendente(consumidor)])
      .mockResolvedValueOnce([pedido])
      .mockResolvedValueOnce(itens)
      .mockResolvedValueOnce([]); // UPDATE

    const pdf = await contratoService.emitirContrato(ALUGUEL_ID);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const chave = `private/contratos/${ALUGUEL_ID}.pdf`;
    expect((await storage.lerArquivo(chave)).equals(pdf)).toBe(true);

    const update = sql.mock.calls[3];
    expect(update[0].join("?")).toContain("UPDATE contratos_locacao");

    const valores = update.slice(1);
    expect(valores).toContain(chave);
    expect(valores.some((v) => /^[0-9a-f]{64}$/.test(String(v)))).toBe(true);
  });

  it("guarda uma cópia da assinatura da empresa na primeira emissão", async () => {
    const { consumidor, chaveEmpresa } = await prepararAssinaturas({
      empresa: true,
    });

    sql
      .mockResolvedValueOnce([contratoPendente(consumidor)])
      .mockResolvedValueOnce([
        { ...pedido, cacambeiro_assinatura_path: chaveEmpresa },
      ])
      .mockResolvedValueOnce(itens)
      .mockResolvedValueOnce([]);

    await contratoService.emitirContrato(ALUGUEL_ID);

    const copia = `private/assinaturas/${CONTRATO_ID}-empresa.png`;
    expect(
      (await storage.lerArquivo(copia)).equals(
        await storage.lerArquivo(chaveEmpresa),
      ),
    ).toBe(true);
    expect(sql.mock.calls[3].slice(1)).toContain(copia);
  });

  it("depois de emitido, a troca da assinatura da empresa não altera o contrato", async () => {
    const { consumidor, chaveEmpresa } = await prepararAssinaturas({
      empresa: true,
    });

    const copia = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      png(600, 200, 10),
      `${CONTRATO_ID}-empresa`,
    );

    // A empresa troca a assinatura e apaga a antiga.
    await storage.removerArquivo(chaveEmpresa);

    sql
      .mockResolvedValueOnce([
        contratoPendente(consumidor, { assinatura_cacambeiro_path: copia }),
      ])
      .mockResolvedValueOnce([
        { ...pedido, cacambeiro_assinatura_path: "private/assinaturas/nova.png" },
      ])
      .mockResolvedValueOnce(itens)
      .mockResolvedValueOnce([]);

    await contratoService.emitirContrato(ALUGUEL_ID);

    // Continua usando a cópia, sem criar outra.
    expect(sql.mock.calls[3].slice(1)).toContain(copia);
  });

  it("é idempotente: contrato já gerado com arquivo presente não regera", async () => {
    const { consumidor } = await prepararAssinaturas();
    const chave = await storage.salvarArquivo(
      "private/contratos",
      "pdf",
      Buffer.from("%PDF-ja-existe"),
      ALUGUEL_ID,
    );

    sql.mockResolvedValueOnce([
      contratoPendente(consumidor, { status: "GERADO", pdf_path: chave }),
    ]);

    const pdf = await contratoService.emitirContrato(ALUGUEL_ID);

    expect(pdf.toString()).toBe("%PDF-ja-existe");
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("regera o PDF se o arquivo sumiu do disco", async () => {
    const { consumidor } = await prepararAssinaturas();

    sql
      .mockResolvedValueOnce([
        contratoPendente(consumidor, {
          status: "GERADO",
          pdf_path: `private/contratos/${ALUGUEL_ID}.pdf`,
        }),
      ])
      .mockResolvedValueOnce([pedido])
      .mockResolvedValueOnce(itens)
      .mockResolvedValueOnce([]);

    const pdf = await contratoService.emitirContrato(ALUGUEL_ID);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sql).toHaveBeenCalledTimes(4);
  });

  it("falha com clareza se a assinatura do consumidor sumiu", async () => {
    sql
      .mockResolvedValueOnce([
        contratoPendente("private/assinaturas/inexistente.png"),
      ])
      .mockResolvedValueOnce([pedido])
      .mockResolvedValueOnce(itens);

    await expect(
      contratoService.emitirContrato(ALUGUEL_ID),
    ).rejects.toThrow(/Assinatura do consumidor/);
  });

  it("calcula a taxa de entrega pelo que foi cobrado além das caçambas", async () => {
    const { consumidor } = await prepararAssinaturas();
    const { gerarContratoPdf } = require("../src/services/contratoPdfService");

    sql
      .mockResolvedValueOnce([contratoPendente(consumidor)])
      .mockResolvedValueOnce([pedido]) // total 2140; itens 2 x 7 x 150 = 2100
      .mockResolvedValueOnce(itens)
      .mockResolvedValueOnce([]);

    await contratoService.emitirContrato(ALUGUEL_ID);

    expect(gerarContratoPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        numero: "COL-1111111122",
        total: 2140,
        taxaEntrega: 40,
        aceite: expect.objectContaining({ ip: "203.0.113.5" }),
      }),
    );
  });
});

describe("codigoDoPedido", () => {
  it("segue o mesmo formato do detalhe do pedido", () => {
    expect(contratoService.codigoDoPedido(ALUGUEL_ID)).toBe(
      "COL-1111111122",
    );
  });
});
