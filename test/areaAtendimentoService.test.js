const fc = require("fast-check");

const {
  coordenadasValidas,
  distanciaKm,
  lerArea,
  avaliarPonto,
} = require("../src/services/areaAtendimentoService");

const SE = { latitude: -23.5505, longitude: -46.6333 }; // Praça da Sé, SP
const PAULISTA = { latitude: -23.5649, longitude: -46.6519 };
const CAMPINAS = { latitude: -22.9099, longitude: -47.0626 };

describe("distanciaKm", () => {
  it("é zero entre o mesmo ponto", () => {
    expect(distanciaKm(SE, SE)).toBeCloseTo(0, 6);
  });

  it("bate com distâncias conhecidas", () => {
    // Sé -> Av. Paulista, cerca de 2,5 km.
    expect(distanciaKm(SE, PAULISTA)).toBeGreaterThan(2);
    expect(distanciaKm(SE, PAULISTA)).toBeLessThan(2.7);

    // São Paulo -> Campinas, cerca de 83 km em linha reta.
    expect(distanciaKm(SE, CAMPINAS)).toBeGreaterThan(80);
    expect(distanciaKm(SE, CAMPINAS)).toBeLessThan(90);
  });

  it("é simétrica e nunca negativa", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: -90, max: 90, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (lat1, lng1, lat2, lng2) => {
          const a = { latitude: lat1, longitude: lng1 };
          const b = { latitude: lat2, longitude: lng2 };
          const ida = distanciaKm(a, b);
          const volta = distanciaKm(b, a);

          return (
            ida >= 0 &&
            Math.abs(ida - volta) < 1e-6 &&
            // O maior arco possível é meia volta ao mundo.
            ida <= 20040
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("coordenadasValidas", () => {
  it("aceita números e textos numéricos dentro dos limites", () => {
    expect(coordenadasValidas(-23.55, -46.63)).toBe(true);
    expect(coordenadasValidas("-23.55", "-46.63")).toBe(true);
    expect(coordenadasValidas(90, 180)).toBe(true);
    expect(coordenadasValidas(-90, -180)).toBe(true);
  });

  it("recusa fora dos limites, vazio e lixo", () => {
    expect(coordenadasValidas(91, 0)).toBe(false);
    expect(coordenadasValidas(0, 181)).toBe(false);
    expect(coordenadasValidas(null, null)).toBe(false);
    expect(coordenadasValidas("", "")).toBe(false);
    expect(coordenadasValidas("abc", 1)).toBe(false);
    expect(coordenadasValidas(NaN, 1)).toBe(false);
    expect(coordenadasValidas(undefined, undefined)).toBe(false);
  });
});

describe("lerArea", () => {
  it("lê os valores que o driver devolve como texto", () => {
    expect(
      lerArea({
        centro_lat: "-23.550500",
        centro_lng: "-46.633300",
        raio_entrega_km: "15.00",
      }),
    ).toEqual({
      definida: true,
      latitude: -23.5505,
      longitude: -46.6333,
      raioKm: 15,
    });
  });

  it("só considera definida com centro E raio", () => {
    expect(lerArea({ centro_lat: -23, centro_lng: -46 }).definida).toBe(false);
    expect(lerArea({ raio_entrega_km: 10 }).definida).toBe(false);
    expect(lerArea({ centro_lat: -23, raio_entrega_km: 10 }).definida).toBe(
      false,
    );
    expect(
      lerArea({ centro_lat: -23, centro_lng: -46, raio_entrega_km: 0 })
        .definida,
    ).toBe(false);
    expect(lerArea(null).definida).toBe(false);
    expect(lerArea(undefined).definida).toBe(false);
  });
});

describe("avaliarPonto", () => {
  const area = lerArea({
    centro_lat: SE.latitude,
    centro_lng: SE.longitude,
    raio_entrega_km: 10,
  });

  it("dentro do raio", () => {
    expect(avaliarPonto(area, PAULISTA)).toEqual({
      definida: true,
      dentro: true,
      distanciaKm: 2.5,
    });
  });

  it("fora do raio", () => {
    const resultado = avaliarPonto(area, CAMPINAS);

    expect(resultado.dentro).toBe(false);
    expect(resultado.distanciaKm).toBeGreaterThan(80);
  });

  it("no limite exato do raio ainda conta como dentro", () => {
    const distancia = distanciaKm(SE, PAULISTA);
    const justa = lerArea({
      centro_lat: SE.latitude,
      centro_lng: SE.longitude,
      raio_entrega_km: distancia,
    });

    expect(avaliarPonto(justa, PAULISTA).dentro).toBe(true);
  });

  it("sem cerca definida atende todo mundo, sem distância", () => {
    expect(avaliarPonto(lerArea({}), CAMPINAS)).toEqual({
      definida: false,
      dentro: true,
      distanciaKm: null,
    });
  });

  it("com cerca definida e ponto desconhecido, não dá para afirmar", () => {
    expect(avaliarPonto(area, {})).toEqual({
      definida: true,
      dentro: null,
      distanciaKm: null,
    });
    expect(avaliarPonto(area, null).dentro).toBeNull();
    expect(
      avaliarPonto(area, { latitude: 200, longitude: 0 }).dentro,
    ).toBeNull();
  });

  it("raio maior sempre inclui o que um raio menor incluía", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -33, max: 5, noNaN: true }),
        fc.double({ min: -73, max: -35, noNaN: true }),
        fc.double({ min: 1, max: 100, noNaN: true }),
        (lat, lng, raio) => {
          const ponto = { latitude: lat, longitude: lng };
          const menor = lerArea({
            centro_lat: SE.latitude,
            centro_lng: SE.longitude,
            raio_entrega_km: raio,
          });
          const maior = lerArea({
            centro_lat: SE.latitude,
            centro_lng: SE.longitude,
            raio_entrega_km: raio + 50,
          });

          return (
            !avaliarPonto(menor, ponto).dentro ||
            avaliarPonto(maior, ponto).dentro
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
