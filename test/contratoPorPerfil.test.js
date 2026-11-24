jest.mock("../src/config/db", () => jest.fn());

const fs = require("fs");
const os = require("os");
const path = require("path");

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "collect-contrato-perfil-"));
  process.env.UPLOADS_DIR = raiz;
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
});

const sql = require("../src/config/db");
const contratosController = require("../src/controllers/contratosController");

const ALUGUEL = "11111111-2222-3333-4444-555555555555";
const CONSUMIDOR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CACAMBEIRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OUTRO = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const contrato = {
  id: "99999999-8888-7777-6666-555555555555",
  aluguel_id: ALUGUEL,
  versao_termos: "1.0",
  aceite_em: new Date("2026-10-31T21:34:00Z"),
  aceite_ip: "203.0.113.5",
  // Arquivo que se perdeu quando o disco do servidor foi apagado.
  assinatura_consumidor_path: "private/assinaturas/perdida.png",
  assinatura_cacambeiro_path: null,
  pdf_path: null,
  status: "PENDENTE",
};

const pedido = {
  id: ALUGUEL,
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

function simularBanco() {
  sql.mockReset();
  sql.mockImplementation((strings) => {
    const texto = strings.join("?");

    if (texto.includes("FROM alugueis") && texto.includes("consumidor_id, cacambeiro_id")) {
      return Promise.resolve([
        { id: ALUGUEL, consumidor_id: CONSUMIDOR, cacambeiro_id: CACAMBEIRO },
      ]);
    }

    if (texto.includes("FROM contratos_locacao")) {
      return Promise.resolve([contrato]);
    }

    if (texto.includes("FROM alugueis a")) {
      return Promise.resolve([pedido]);
    }

    if (texto.includes("FROM itens_aluguel")) {
      return Promise.resolve([
        {
          nome: "Caçamba 5m³",
          tamanho_m3: "5.00",
          quantidade: 2,
          dias: 7,
          preco_diaria: "150.00",
        },
      ]);
    }

    return Promise.resolve([]);
  });
}

function resposta() {
  const res = {
    headers: {},
    corpo: null,
    codigo: null,
    set: jest.fn((cabecalhos) => Object.assign(res.headers, cabecalhos)),
    status: jest.fn((codigo) => {
      res.codigo = codigo;
      return res;
    }),
    send: jest.fn((corpo) => {
      res.corpo = corpo;
      return res;
    }),
    json: jest.fn((corpo) => {
      res.corpo = corpo;
      return res;
    }),
  };

  return res;
}

beforeEach(() => {
  simularBanco();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("GET /api/alugueis/:id/contrato com a assinatura do cliente perdida", () => {
  it.each([
    ["fornecedor", CACAMBEIRO, "CACAMBEIRO"],
    ["administrador", ADMIN, "ADMIN"],
    ["cliente", CONSUMIDOR, "CONSUMIDOR"],
  ])("o %s recebe o PDF em vez de erro interno", async (_, usuario, perfil) => {
    const res = resposta();

    await contratosController.baixar(
      { params: { id: ALUGUEL }, usuario_id: usuario, tipo_perfil: perfil },
      res,
    );

    expect(res.codigo).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(Buffer.from(res.corpo).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("quem não participa do pedido continua recebendo 404", async () => {
    const res = resposta();

    await contratosController.baixar(
      { params: { id: ALUGUEL }, usuario_id: OUTRO, tipo_perfil: "CACAMBEIRO" },
      res,
    );

    expect(res.codigo).toBe(404);
    expect(res.corpo.code).toBe("ORDER_NOT_FOUND");
  });

  it("falha inesperada continua virando erro 500 com código", async () => {
    sql.mockImplementation((strings) => {
      if (strings.join("?").includes("consumidor_id, cacambeiro_id")) {
        return Promise.reject(new Error("banco fora do ar"));
      }

      return Promise.resolve([]);
    });

    const res = resposta();

    await contratosController.baixar(
      { params: { id: ALUGUEL }, usuario_id: ADMIN, tipo_perfil: "ADMIN" },
      res,
    );

    expect(res.codigo).toBe(500);
    expect(res.corpo.code).toBe("CONTRACT_INTERNAL_ERROR");
  });
});
