jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/geocodingService", () => {
  const actual = jest.requireActual("../src/services/geocodingService");

  return {
    ...actual,
    buscarCep: jest.fn(),
  };
});

const sql = require("../src/config/db");
const geocoding = require("../src/services/geocodingService");
const localizacaoController = require("../src/controllers/localizacaoController");
const areaController = require("../src/controllers/areaAtendimentoController");

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("GET /api/localizacao/cep/:cep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("devolve endereço e coordenadas", async () => {
    geocoding.buscarCep.mockResolvedValueOnce({
      cep: "01310100",
      logradouro: "Avenida Paulista",
      cidade_estado: "São Paulo - SP",
      latitude: -23.5475,
      longitude: -46.63611,
    });

    const res = createResponse();
    await localizacaoController.buscarCep(
      { params: { cep: "01310-100" } },
      res,
    );

    // A API consulta com o CEP já normalizado.
    expect(geocoding.buscarCep).toHaveBeenCalledWith("01310100");
    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: true,
      data: { latitude: -23.5475, longitude: -46.63611 },
    });
  });

  it("CEP com formato inválido: 400 sem consultar ninguém", async () => {
    const res = createResponse();
    await localizacaoController.buscarCep({ params: { cep: "12ab" } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe("INVALID_CEP");
    expect(geocoding.buscarCep).not.toHaveBeenCalled();
  });

  it("CEP inexistente: 404", async () => {
    geocoding.buscarCep.mockResolvedValueOnce(null);

    const res = createResponse();
    await localizacaoController.buscarCep(
      { params: { cep: "00000000" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].code).toBe("CEP_NOT_FOUND");
  });

  it("serviços de CEP fora do ar: 503 (não confunde com CEP inexistente)", async () => {
    geocoding.buscarCep.mockRejectedValueOnce(
      new geocoding.GeocodingUnavailableError(),
    );

    const res = createResponse();
    await localizacaoController.buscarCep(
      { params: { cep: "01310100" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe("GEOCODING_UNAVAILABLE");
  });

  it("erro inesperado: 500 sem vazar detalhes", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    geocoding.buscarCep.mockRejectedValueOnce(new Error("segredo interno"));

    const res = createResponse();
    await localizacaoController.buscarCep(
      { params: { cep: "01310100" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain(
      "segredo interno",
    );
    console.error.mockRestore();
  });
});

describe("área de atendimento do caçambeiro", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe("obter", () => {
    it("devolve a cerca definida", async () => {
      sql.mockResolvedValueOnce([
        {
          centro_lat: "-23.550500",
          centro_lng: "-46.633300",
          raio_entrega_km: "15.00",
          area_atualizada_em: "2026-11-01T10:00:00Z",
        },
      ]);

      const res = createResponse();
      await areaController.obter({ usuario_id: "c1" }, res);

      expect(sql.mock.calls[0].slice(1)).toEqual(["c1"]);
      expect(res.json.mock.calls[0][0].data).toEqual({
        definida: true,
        latitude: -23.5505,
        longitude: -46.6333,
        raio_km: 15,
        atualizada_em: "2026-11-01T10:00:00Z",
      });
    });

    it("caçambeiro antigo (só raio): não definida, mas sugere o raio", async () => {
      sql.mockResolvedValueOnce([
        {
          centro_lat: null,
          centro_lng: null,
          raio_entrega_km: "25.00",
          area_atualizada_em: null,
        },
      ]);

      const res = createResponse();
      await areaController.obter({ usuario_id: "c1" }, res);

      expect(res.json.mock.calls[0][0].data).toMatchObject({
        definida: false,
        latitude: null,
        raio_km: 25,
      });
    });

    it("sem perfil de fornecedor: 404", async () => {
      sql.mockResolvedValueOnce([]);

      const res = createResponse();
      await areaController.obter({ usuario_id: "c1" }, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("salvar", () => {
    it("grava centro e raio só do caçambeiro logado", async () => {
      sql.mockResolvedValueOnce([
        {
          centro_lat: "-23.550500",
          centro_lng: "-46.633300",
          raio_entrega_km: "12.50",
          area_atualizada_em: "2026-11-01T10:00:00Z",
        },
      ]);

      const res = createResponse();
      await areaController.salvar(
        {
          usuario_id: "c1",
          body: { latitude: -23.5505, longitude: -46.6333, raio_km: 12.5 },
        },
        res,
      );

      const consulta = sql.mock.calls[0];
      expect(consulta[0].join("?")).toContain("UPDATE detalhes_cacambeiro");
      expect(consulta.slice(1)).toEqual([-23.5505, -46.6333, 12.5, "c1"]);
      expect(res.json.mock.calls[0][0].data).toMatchObject({
        definida: true,
        raio_km: 12.5,
      });
    });

    it("sem perfil de fornecedor: 404", async () => {
      sql.mockResolvedValueOnce([]);

      const res = createResponse();
      await areaController.salvar(
        {
          usuario_id: "c1",
          body: { latitude: -23, longitude: -46, raio_km: 5 },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("erro de banco: 500", async () => {
      sql.mockRejectedValueOnce(new Error("banco"));

      const res = createResponse();
      await areaController.salvar(
        {
          usuario_id: "c1",
          body: { latitude: -23, longitude: -46, raio_km: 5 },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("pendencias", () => {
    it("tudo pendente quando não há área nem assinatura", async () => {
      sql.mockResolvedValueOnce([
        {
          centro_lat: null,
          centro_lng: null,
          raio_entrega_km: "20.00",
          assinatura_path: null,
        },
      ]);

      const res = createResponse();
      await areaController.pendencias({ usuario_id: "c1" }, res);

      expect(res.json.mock.calls[0][0].data).toEqual({
        area_definida: false,
        assinatura_cadastrada: false,
        pendencias: ["AREA_ATENDIMENTO", "ASSINATURA"],
      });
    });

    it("só a assinatura pendente", async () => {
      sql.mockResolvedValueOnce([
        {
          centro_lat: "-23.55",
          centro_lng: "-46.63",
          raio_entrega_km: "10",
          assinatura_path: null,
        },
      ]);

      const res = createResponse();
      await areaController.pendencias({ usuario_id: "c1" }, res);

      expect(res.json.mock.calls[0][0].data.pendencias).toEqual(["ASSINATURA"]);
    });

    it("sem pendências quando está completo", async () => {
      sql.mockResolvedValueOnce([
        {
          centro_lat: "-23.55",
          centro_lng: "-46.63",
          raio_entrega_km: "10",
          assinatura_path: "private/assinaturas/x.png",
        },
      ]);

      const res = createResponse();
      await areaController.pendencias({ usuario_id: "c1" }, res);

      expect(res.json.mock.calls[0][0].data).toEqual({
        area_definida: true,
        assinatura_cadastrada: true,
        pendencias: [],
      });
    });

    it("sem perfil de fornecedor, as duas ficam pendentes", async () => {
      sql.mockResolvedValueOnce([]);

      const res = createResponse();
      await areaController.pendencias({ usuario_id: "c1" }, res);

      expect(res.json.mock.calls[0][0].data.pendencias).toEqual([
        "AREA_ATENDIMENTO",
        "ASSINATURA",
      ]);
    });
  });
});
