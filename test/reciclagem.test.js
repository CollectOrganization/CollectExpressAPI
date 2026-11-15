jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/emailService", () => ({
  enviarEmail: jest.fn(),
}));

const sql = require("../src/config/db");
const reciclagem = require("../src/services/reciclagemService");
const documento = require("../src/services/documentoColetaService");
const validatePartnerRegistration = require("../src/middlewares/validatePartnerRegistration");
const reciclagemJobController = require("../src/controllers/reciclagemJobController");

const HORA = 60 * 60 * 1000;
const agora = new Date("2026-11-10T12:00:00.000Z");
const em = (horas) => new Date(agora.getTime() + horas * HORA).toISOString();

const maria = { id: "11111111-1111-4111-8111-111111111111", perfil: "CONSUMIDOR" };
const parceiro = { id: "22222222-2222-4222-8222-222222222222", perfil: "PARCEIRO" };
const MATERIAL = "33333333-3333-4333-8333-333333333333";
const ENDERECO = "44444444-4444-4444-8444-444444444444";
const OFERTA = "55555555-5555-4555-8555-555555555555";

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function corpoValido(extra = {}) {
  return {
    materiais_ids: [MATERIAL],
    descricao: "Garrafas PET separadas",
    quantidade_estimada: "30 kg",
    endereco_id: ENDERECO,
    janela_inicio: em(20),
    janela_fim: em(100),
    aceite_termos: true,
    assinatura_base64: "data:image/png;base64,AAAA",
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  sql.mockReset();
  sql.mockResolvedValue([]);
});

describe("janela de uma sinalização", () => {
  it("aceita uma janela longa o bastante e que termina daqui a mais de 25 h", () => {
    const { inicio, fim } = reciclagem.validarJanela(em(20), em(100), agora);

    expect(inicio.toISOString()).toBe(em(20));
    expect(fim.toISOString()).toBe(em(100));
  });

  it.each([
    ["menos de 2 horas", em(30), em(31), /pelo menos 2 horas/],
    ["termina em menos de 25 horas", em(1), em(24.5), /mais de 25 horas/],
    ["passa de 60 dias", em(20), em(24 * 61), /60 dias/],
  ])("recusa janela que %s", (_, inicio, fim, mensagem) => {
    expect(() => reciclagem.validarJanela(inicio, fim, agora)).toThrow(
      mensagem,
    );
  });

  it("recusa datas que não são datas", () => {
    expect(() => reciclagem.validarJanela("amanhã", em(40), agora)).toThrow(
      /data e hora válidas/,
    );
    expect(() => reciclagem.validarJanela(null, null, agora)).toThrow();
  });

  it("o primeiro horário possível respeita as 24 h de antecedência", () => {
    expect(
      reciclagem.primeiroHorarioPossivel(em(5), agora).toISOString(),
    ).toBe(em(24));
    expect(
      reciclagem.primeiroHorarioPossivel(em(40), agora).toISOString(),
    ).toBe(em(40));
  });
});

describe("criar sinalização (validações antes do banco)", () => {
  it.each([
    ["sem aceite do termo", { aceite_termos: false }, "TERMS_NOT_ACCEPTED"],
    ["sem tipos de material", { materiais_ids: [] }, "VALIDATION_ERROR"],
    ["com material mal formado", { materiais_ids: ["x"] }, "VALIDATION_ERROR"],
    ["com descrição curta", { descricao: "ok" }, "VALIDATION_ERROR"],
    ["sem quantidade", { quantidade_estimada: "  " }, "VALIDATION_ERROR"],
    ["sem endereço", { endereco_id: undefined }, "VALIDATION_ERROR"],
    ["com janela curta", { janela_fim: em(21) }, "VALIDATION_ERROR"],
  ])("recusa %s", async (_, extra, codigo) => {
    await expect(
      reciclagem.criarOferta(maria, corpoValido(extra), { agora }),
    ).rejects.toMatchObject({ code: codigo, statusCode: 400 });

    expect(sql).not.toHaveBeenCalled();
  });

  it("parceiro não sinaliza", async () => {
    await expect(
      reciclagem.criarOferta(parceiro, corpoValido(), { agora }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });
});

describe("agendar coleta (validações antes do banco)", () => {
  it("recusa retirada com menos de 24 h de antecedência", async () => {
    await expect(
      reciclagem.agendarColeta(
        parceiro,
        { oferta_id: OFERTA, data_agendada: em(23.9) },
        { agora },
      ),
    ).rejects.toMatchObject({ code: "PICKUP_TOO_SOON", statusCode: 400 });

    expect(sql).not.toHaveBeenCalled();
  });

  it("aceita exatamente 24 h e segue para as próximas checagens", async () => {
    // Sem assinatura cadastrada para o parceiro: para aí, sem reservar nada.
    await expect(
      reciclagem.agendarColeta(
        parceiro,
        { oferta_id: OFERTA, data_agendada: em(24) },
        { agora },
      ),
    ).rejects.toMatchObject({ code: "SIGNATURE_REQUIRED" });
  });

  it("exige sinalização e data válidas", async () => {
    await expect(
      reciclagem.agendarColeta(parceiro, { oferta_id: "x" }, { agora }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      reciclagem.agendarColeta(
        parceiro,
        { oferta_id: OFERTA, data_agendada: "amanhã" },
        { agora },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("documento de coleta", () => {
  const base = {
    codigo: "COL-REC-AAAA1111",
    versao: "1.0",
    geradorId: "g",
    parceiroId: "p",
    agendadaEm: agora,
    dataAgendada: new Date(em(48)),
    materiais: ["Metal", "Plástico"],
    assinaturaGerador: Buffer.from("a"),
    assinaturaParceiro: Buffer.from("b"),
  };

  beforeAll(() => {
    process.env.DOCUMENT_SIGNING_SECRET = "segredo-de-teste";
  });

  it("o código da coleta vem do id", () => {
    expect(
      documento.codigoDaColeta("0a1b2c3d-1111-4111-8111-111111111111"),
    ).toBe("COL-REC-0A1B2C3D");
  });

  it("o código de autenticação é estável e muda com qualquer dado", () => {
    const hash = documento.calcularAutenticacao(base);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(documento.calcularAutenticacao({ ...base })).toBe(hash);
    expect(
      documento.calcularAutenticacao({
        ...base,
        materiais: ["Plástico", "Metal"],
      }),
    ).toBe(hash);
    expect(
      documento.calcularAutenticacao({ ...base, parceiroId: "q" }),
    ).not.toBe(hash);
    expect(
      documento.calcularAutenticacao({
        ...base,
        assinaturaParceiro: Buffer.from("c"),
      }),
    ).not.toBe(hash);
  });

  it("depende do segredo do servidor", () => {
    const hash = documento.calcularAutenticacao(base);

    process.env.DOCUMENT_SIGNING_SECRET = "outro-segredo";
    expect(documento.calcularAutenticacao(base)).not.toBe(hash);
    process.env.DOCUMENT_SIGNING_SECRET = "segredo-de-teste";
  });

  it("confere o código curto, com ou sem hífens, e recusa o resto", () => {
    const hash = documento.calcularAutenticacao(base);
    const curto = documento.autenticacaoCurta(hash);

    expect(curto).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(documento.autenticacaoConfere(hash, curto)).toBe(true);
    expect(documento.autenticacaoConfere(hash, curto.replaceAll("-", ""))).toBe(
      true,
    );
    expect(documento.autenticacaoConfere(hash, hash)).toBe(true);
    expect(documento.autenticacaoConfere(hash, "ABCD-1234")).toBe(false);
    expect(documento.autenticacaoConfere(hash, undefined)).toBe(false);
    expect(
      documento.autenticacaoConfere(hash, `${"0".repeat(16)}`),
    ).toBe(false);
  });

  it("sem segredo configurado, não gera código", () => {
    const antes = {
      doc: process.env.DOCUMENT_SIGNING_SECRET,
      jwt: process.env.JWT_SECRET,
    };

    delete process.env.DOCUMENT_SIGNING_SECRET;
    delete process.env.JWT_SECRET;

    expect(() => documento.calcularAutenticacao(base)).toThrow(/Defina/);

    process.env.DOCUMENT_SIGNING_SECRET = antes.doc;
    if (antes.jwt) process.env.JWT_SECRET = antes.jwt;
  });
});

describe("cadastro de parceiro (validatePartnerRegistration)", () => {
  const valido = {
    tipo_perfil: "PARCEIRO",
    documento: "77.777.777/0001-00",
    responsavel_nome: "Paulo Silva",
    endereco_coleta: "Rua X, 1 - Centro, Santos - SP",
    capacidade_diaria_kg: 500,
    materiais_ids: [MATERIAL],
  };

  function executar(body) {
    const res = createResponse();
    const next = jest.fn();

    validatePartnerRegistration({ body }, res, next);

    return { res, next };
  }

  it("ignora os outros perfis", () => {
    const { next } = executar({ tipo_perfil: "CONSUMIDOR" });
    expect(next).toHaveBeenCalled();
  });

  it("aceita um cadastro completo", () => {
    const { next, res } = executar(valido);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("aceita sem capacidade informada", () => {
    const { next } = executar({ ...valido, capacidade_diaria_kg: undefined });
    expect(next).toHaveBeenCalled();
  });

  it.each([
    ["documento", { documento: "123" }],
    ["responsavel_nome", { responsavel_nome: "x" }],
    ["endereco_coleta", { endereco_coleta: "" }],
    ["capacidade_diaria_kg", { capacidade_diaria_kg: -4 }],
    ["materiais_ids", { materiais_ids: [] }],
    ["materiais_ids", { materiais_ids: ["abc"] }],
  ])("recusa %s inválido", (campo, extra) => {
    const { res, next } = executar({ ...valido, ...extra });

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].fields).toHaveProperty(campo);
  });
});

describe("POST /api/internal/jobs/reciclagem", () => {
  const original = process.env.JOBS_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.JOBS_SECRET;
    else process.env.JOBS_SECRET = original;
  });

  it("recusa sem o segredo", async () => {
    process.env.JOBS_SECRET = "segredo";
    const res = createResponse();

    await reciclagemJobController.rodarVarredura({ get: () => "outro" }, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(sql).not.toHaveBeenCalled();
  });

  it("roda a varredura com o segredo", async () => {
    process.env.JOBS_SECRET = "segredo";
    const res = createResponse();

    await reciclagemJobController.rodarVarredura({ get: () => "segredo" }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      data: { expiradas: 0, lembretes: 0 },
    });
  });
});
