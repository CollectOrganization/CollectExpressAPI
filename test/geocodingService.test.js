process.env.NOMINATIM_MIN_INTERVAL_MS = "0";

const geocoding = require("../src/services/geocodingService");

function resposta(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

const brasilApiPaulista = {
  cep: "01310100",
  state: "SP",
  city: "São Paulo",
  neighborhood: "Bela Vista",
  street: "Avenida Paulista",
  location: {
    type: "Point",
    coordinates: { longitude: "-46.63611", latitude: "-23.5475" },
  },
};

/** Roteia as chamadas de fetch por trecho da URL. */
function simular(rotas) {
  global.fetch = jest.fn(async (url) => {
    const texto = String(url);

    for (const [trecho, responder] of rotas) {
      if (texto.includes(trecho)) {
        return typeof responder === "function"
          ? responder(texto)
          : responder;
      }
    }

    throw new Error(`URL não simulada: ${texto}`);
  });
}

const legivel = (url) => decodeURIComponent(String(url).replace(/\+/g, " "));

const chamadas = (trecho) =>
  global.fetch.mock.calls.filter(([url]) => String(url).includes(trecho));

describe("geocodingService", () => {
  beforeEach(() => {
    geocoding.limparCache();
  });

  describe("normalizarCep / separarCidadeEstado", () => {
    it("aceita CEP com máscara e recusa o resto", () => {
      expect(geocoding.normalizarCep("01310-100")).toBe("01310100");
      expect(geocoding.normalizarCep("01310100")).toBe("01310100");
      expect(geocoding.normalizarCep("123")).toBeNull();
      expect(geocoding.normalizarCep("")).toBeNull();
      expect(geocoding.normalizarCep(null)).toBeNull();
    });

    it("separa cidade e UF nos formatos usados pelo app", () => {
      expect(geocoding.separarCidadeEstado("São Paulo - SP")).toEqual({
        cidade: "São Paulo",
        uf: "SP",
      });
      expect(geocoding.separarCidadeEstado("São Paulo/SP")).toEqual({
        cidade: "São Paulo",
        uf: "SP",
      });
      expect(geocoding.separarCidadeEstado("Campinas, sp")).toEqual({
        cidade: "Campinas",
        uf: "SP",
      });
      expect(geocoding.separarCidadeEstado("Brasília")).toEqual({
        cidade: "Brasília",
        uf: "",
      });
    });
  });

  describe("buscarCep", () => {
    it("usa a BrasilAPI e devolve endereço com coordenadas", async () => {
      simular([["brasilapi.com.br", resposta(200, brasilApiPaulista)]]);

      const r = await geocoding.buscarCep("01310-100");

      expect(r).toEqual({
        cep: "01310100",
        logradouro: "Avenida Paulista",
        bairro: "Bela Vista",
        cidade: "São Paulo",
        uf: "SP",
        cidade_estado: "São Paulo - SP",
        latitude: -23.5475,
        longitude: -46.63611,
      });
      expect(chamadas("nominatim")).toHaveLength(0);
    });

    it("guarda em cache: o segundo pedido não chama ninguém", async () => {
      simular([["brasilapi.com.br", resposta(200, brasilApiPaulista)]]);

      await geocoding.buscarCep("01310100");
      await geocoding.buscarCep("01310-100");

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("sem coordenadas no CEP, acha pela rua no Nominatim", async () => {
      simular([
        [
          "brasilapi.com.br",
          resposta(200, { ...brasilApiPaulista, location: { coordinates: {} } }),
        ],
        [
          "nominatim",
          resposta(200, [{ lat: "-23.5649", lon: "-46.6519" }]),
        ],
      ]);

      const r = await geocoding.buscarCep("01310100");

      expect(r.latitude).toBe(-23.5649);
      expect(r.longitude).toBe(-46.6519);
      expect(legivel(chamadas("nominatim")[0][0])).toContain(
        "Avenida Paulista, Bela Vista, São Paulo, SP, Brasil",
      );
    });

    it("se a BrasilAPI não acha, tenta o ViaCEP", async () => {
      simular([
        ["brasilapi.com.br", resposta(404, { message: "não achei" })],
        [
          "viacep",
          resposta(200, {
            cep: "01310-100",
            logradouro: "Avenida Paulista",
            bairro: "Bela Vista",
            localidade: "São Paulo",
            uf: "SP",
          }),
        ],
        ["nominatim", resposta(200, [{ lat: "-23.56", lon: "-46.65" }])],
      ]);

      const r = await geocoding.buscarCep("01310100");

      expect(r.logradouro).toBe("Avenida Paulista");
      expect(r.latitude).toBe(-23.56);
    });

    it("CEP que nenhum serviço conhece devolve null", async () => {
      simular([
        ["brasilapi.com.br", resposta(404, {})],
        ["viacep", resposta(200, { erro: true })],
      ]);

      expect(await geocoding.buscarCep("00000000")).toBeNull();
    });

    it("CEP com formato inválido nem chama a rede", async () => {
      simular([]);

      expect(await geocoding.buscarCep("abc")).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("com os dois serviços fora do ar, avisa que está indisponível", async () => {
      simular([
        ["brasilapi.com.br", resposta(503, {})],
        ["viacep", resposta(500, {})],
      ]);

      await expect(geocoding.buscarCep("01310100")).rejects.toBeInstanceOf(
        geocoding.GeocodingUnavailableError,
      );
    });

    it("falha de rede não vira 'CEP inexistente' nem entra no cache", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("sem rede"));

      await expect(geocoding.buscarCep("01310100")).rejects.toBeInstanceOf(
        geocoding.GeocodingUnavailableError,
      );

      simular([["brasilapi.com.br", resposta(200, brasilApiPaulista)]]);

      expect((await geocoding.buscarCep("01310100")).logradouro).toBe(
        "Avenida Paulista",
      );
    });
  });

  describe("geocodificarEndereco", () => {
    const endereco = {
      cep: "01310100",
      logradouro: "Avenida Paulista",
      numero: "1000",
      bairro: "Bela Vista",
      cidade_estado: "São Paulo - SP",
    };

    it("acha rua e número no Nominatim, com User-Agent identificado", async () => {
      simular([
        ["nominatim", resposta(200, [{ lat: "-23.564886", lon: "-46.651918" }])],
      ]);

      const r = await geocoding.geocodificarEndereco(endereco);

      expect(r).toEqual({
        latitude: -23.564886,
        longitude: -46.651918,
        precisao: "numero",
      });

      const [url, opcoes] = chamadas("nominatim")[0];
      expect(legivel(url)).toContain(
        "Avenida Paulista, 1000, Bela Vista, São Paulo, SP, Brasil",
      );
      expect(url).toContain("countrycodes=br");
      expect(opcoes.headers["User-Agent"]).toMatch(/^CollectExpress\/1\.0 \(/);
    });

    it("sem o número, cai para a rua", async () => {
      let n = 0;
      simular([
        [
          "nominatim",
          () =>
            resposta(
              200,
              ++n === 1 ? [] : [{ lat: "-23.5564", lon: "-46.6618" }],
            ),
        ],
      ]);

      const r = await geocoding.geocodificarEndereco(endereco);

      expect(r.precisao).toBe("rua");
      expect(chamadas("nominatim")).toHaveLength(2);
    });

    it("sem rua, usa o ponto do CEP", async () => {
      simular([
        ["nominatim", resposta(200, [])],
        ["brasilapi.com.br", resposta(200, brasilApiPaulista)],
      ]);

      const r = await geocoding.geocodificarEndereco(endereco);

      expect(r).toEqual({
        latitude: -23.5475,
        longitude: -46.63611,
        precisao: "cep",
      });
    });

    it("não acha nada: devolve null e lembra para não repetir", async () => {
      simular([
        ["nominatim", resposta(200, [])],
        ["brasilapi.com.br", resposta(404, {})],
        ["viacep", resposta(200, { erro: true })],
      ]);

      expect(await geocoding.geocodificarEndereco(endereco)).toBeNull();

      const antes = global.fetch.mock.calls.length;
      expect(await geocoding.geocodificarEndereco(endereco)).toBeNull();
      expect(global.fetch.mock.calls.length).toBe(antes);
    });

    it("serviço fora do ar: nunca lança e não guarda a falha", async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error("sem rede"));

      await expect(
        geocoding.geocodificarEndereco(endereco),
      ).resolves.toBeNull();

      simular([
        ["nominatim", resposta(200, [{ lat: "-23.5", lon: "-46.6" }])],
      ]);

      expect((await geocoding.geocodificarEndereco(endereco)).precisao).toBe(
        "numero",
      );
    });

    it("respeita o intervalo mínimo entre chamadas ao Nominatim", async () => {
      process.env.NOMINATIM_MIN_INTERVAL_MS = "120";

      const momentos = [];
      global.fetch = jest.fn(async () => {
        momentos.push(Date.now());
        return resposta(200, [{ lat: "-23.5", lon: "-46.6" }]);
      });

      await Promise.all([
        geocoding.geocodificarEndereco({ ...endereco, numero: "1" }),
        geocoding.geocodificarEndereco({ ...endereco, numero: "2" }),
        geocoding.geocodificarEndereco({ ...endereco, numero: "3" }),
      ]);

      process.env.NOMINATIM_MIN_INTERVAL_MS = "0";

      expect(momentos).toHaveLength(3);
      expect(momentos[1] - momentos[0]).toBeGreaterThanOrEqual(100);
      expect(momentos[2] - momentos[1]).toBeGreaterThanOrEqual(100);
    });
  });
});
