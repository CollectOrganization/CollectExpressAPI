jest.mock("../src/config/db", () => jest.fn());

const sql = require("../src/config/db");
const analise = require("../src/services/analiseCnpjService");
const controller = require("../src/controllers/analiseCnpjController");

const ID = "7b0c3a52-1f7e-4c55-9d7a-2a7f2f9f0a11";

const fornecedor = {
  id: ID,
  nome_completo: "JR Caçambas",
  tipo_perfil: "CACAMBEIRO",
  documento: "11222333000181",
};

function criarRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

/**
 * Banco falso: responde cada consulta pelo trecho do SQL e guarda
 * as consultas recebidas.
 */
function simularBanco({ usuario = fornecedor, salva = null, erroAoSalvar = null } = {}) {
  const consultas = [];

  sql.mockImplementation(async (partes) => {
    const texto = partes.join("?");
    consultas.push(texto);

    if (texto.includes("FROM usuarios")) return usuario ? [usuario] : [];
    if (texto.includes("FROM analises_cnpj")) return salva ? [{ resultado: salva }] : [];
    if (texto.includes("INSERT INTO analises_cnpj")) {
      if (erroAoSalvar) throw erroAoSalvar;
      return [];
    }

    throw new Error(`SQL não simulado: ${texto}`);
  });

  return consultas;
}

function brasilApiRespondendo(status, corpo) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  }));
}

const empresaAtiva = {
  razao_social: "JR LOCACAO DE CACAMBAS LTDA",
  nome_fantasia: "JR CACAMBAS",
  descricao_situacao_cadastral: "ATIVA",
  data_inicio_atividade: "2019-03-10",
  cnae_fiscal: 3811400,
  cnae_fiscal_descricao: "Coleta de resíduos não-perigosos",
  cnaes_secundarios: [],
};

beforeEach(() => {
  sql.mockReset();
  process.env.ANALISE_CNPJ_IA = "false";
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.ANALISE_CNPJ_IA;
  jest.restoreAllMocks();
});

describe("GET /usuarios/:id/analise-cnpj", () => {
  it("devolve a análise salva", async () => {
    simularBanco({ salva: { nota: 8.5, recomendacao: "APROVAR" } });
    const res = criarRes();

    await controller.obter({ params: { id: ID } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toMatchObject({
      nota: 8.5,
      usuario_id: ID,
      salva: true,
    });
  });

  it("404 quando ainda não há análise", async () => {
    simularBanco();
    const res = criarRes();

    await controller.obter({ params: { id: ID } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe("ANALISE_NAO_ENCONTRADA");
  });

  it("422 para cliente (CPF)", async () => {
    simularBanco({
      usuario: { ...fornecedor, tipo_perfil: "CONSUMIDOR", documento: "12345678909" },
    });
    const res = criarRes();

    await controller.obter({ params: { id: ID } }, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0].code).toBe("PERFIL_SEM_ANALISE_CNPJ");
  });

  it("404 para usuário inexistente", async () => {
    simularBanco({ usuario: null });
    const res = criarRes();

    await controller.obter({ params: { id: ID } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe("USER_NOT_FOUND");
  });
});

describe("POST /usuarios/:id/analise-cnpj", () => {
  it("gera, salva e devolve a análise", async () => {
    const consultas = simularBanco();
    brasilApiRespondendo(200, empresaAtiva);
    const res = criarRes();

    await controller.gerar({ params: { id: ID } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0].data;
    expect(data).toMatchObject({ usuario_id: ID, salva: true, recomendacao: "REVISAR" });
    expect(data.dados_receita.razao_social).toBe("JR LOCACAO DE CACAMBAS LTDA");
    expect(consultas.some((q) => q.includes("INSERT INTO analises_cnpj"))).toBe(true);
  });

  it("sem a tabela no banco, responde a análise sem salvar", async () => {
    simularBanco({ erroAoSalvar: Object.assign(new Error("relation does not exist"), { code: "42P01" }) });
    brasilApiRespondendo(200, empresaAtiva);
    const res = criarRes();

    await controller.gerar({ params: { id: ID } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.salva).toBe(false);
  });

  it("503 quando as fontes de CNPJ estão fora do ar", async () => {
    simularBanco();
    brasilApiRespondendo(502, null);
    const res = criarRes();

    await controller.gerar({ params: { id: ID } }, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe("CNPJ_CONSULTA_INDISPONIVEL");
  });

  it("dois pedidos ao mesmo tempo dividem a mesma análise", async () => {
    simularBanco();
    brasilApiRespondendo(200, empresaAtiva);

    const [a, b] = await Promise.all([
      analise.gerarESalvarAnalise(fornecedor),
      analise.gerarESalvarAnalise(fornecedor),
    ]);

    expect(a).toBe(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
