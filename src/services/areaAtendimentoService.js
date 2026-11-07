/*
 * Cerca virtual (área de atendimento) do caçambeiro.
 *
 * A cerca é um círculo: centro (latitude/longitude) + raio em km.
 * Fica em detalhes_cacambeiro (centro_lat, centro_lng, raio_entrega_km).
 * Quem ainda não definiu a cerca atende todo mundo (período de transição).
 *
 * Tudo aqui é conta local; nenhum serviço externo é chamado.
 */

const RAIO_TERRA_KM = 6371;

const RAIO_MIN_KM = 1;
const RAIO_MAX_KM = 200;

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  const numero = Number(valor);

  return Number.isFinite(numero) ? numero : null;
}

/** Latitude e longitude dentro dos limites do planeta. */
function coordenadasValidas(latitude, longitude) {
  const lat = numeroOuNull(latitude);
  const lng = numeroOuNull(longitude);

  return (
    lat !== null &&
    lng !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Distância em km entre dois pontos (fórmula de Haversine). */
function distanciaKm(a, b) {
  const rad = (graus) => (graus * Math.PI) / 180;

  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * RAIO_TERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Normaliza a cerca vinda do banco. `definida` só é verdadeira com
 * centro e raio completos e válidos.
 */
function lerArea(linha) {
  const latitude = numeroOuNull(linha?.centro_lat);
  const longitude = numeroOuNull(linha?.centro_lng);
  const raioKm = numeroOuNull(linha?.raio_entrega_km);

  const definida =
    coordenadasValidas(latitude, longitude) &&
    raioKm !== null &&
    raioKm > 0;

  return {
    definida,
    latitude,
    longitude,
    raioKm,
  };
}

/**
 * Confere se um ponto está dentro da cerca.
 *
 * - Cerca não definida: `dentro` é true (atende todos) e a distância é null.
 * - Ponto sem coordenadas válidas: `dentro` é null (não dá para saber).
 *
 * @returns {{definida: boolean, dentro: boolean|null, distanciaKm: number|null}}
 */
function avaliarPonto(area, ponto) {
  if (!area.definida) {
    return { definida: false, dentro: true, distanciaKm: null };
  }

  if (!coordenadasValidas(ponto?.latitude, ponto?.longitude)) {
    return { definida: true, dentro: null, distanciaKm: null };
  }

  const distancia = distanciaKm(
    { latitude: area.latitude, longitude: area.longitude },
    {
      latitude: Number(ponto.latitude),
      longitude: Number(ponto.longitude),
    },
  );

  return {
    definida: true,
    dentro: distancia <= area.raioKm,
    distanciaKm: Math.round(distancia * 10) / 10,
  };
}

module.exports = {
  RAIO_MIN_KM,
  RAIO_MAX_KM,
  coordenadasValidas,
  distanciaKm,
  lerArea,
  avaliarPonto,
};
