/*
 * Endereço -> coordenadas, só com serviços gratuitos:
 *
 * - BrasilAPI (CEP v2): endereço e coordenadas por CEP.
 * - ViaCEP: endereço por CEP quando a BrasilAPI falha.
 * - Nominatim (OpenStreetMap): coordenadas de rua e número.
 *
 * A política do Nominatim pede no máximo 1 requisição por segundo e um
 * User-Agent que identifique o app. As chamadas ao Nominatim entram numa
 * fila com intervalo mínimo, e os resultados ficam em cache na memória.
 * Para uso comercial pesado, troque por um provedor pago ou hospede o seu.
 */

const BRASIL_API = "https://brasilapi.com.br/api/cep/v2";
const VIA_CEP = "https://viacep.com.br/ws";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

const TIMEOUT_MS = 6000;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX = 1000;

class GeocodingUnavailableError extends Error {
  constructor(message = "Serviço de endereços indisponível.") {
    super(message);
    this.name = "GeocodingUnavailableError";
  }
}

function intervaloNominatim() {
  const configurado = Number(process.env.NOMINATIM_MIN_INTERVAL_MS);

  return Number.isFinite(configurado) && configurado >= 0
    ? configurado
    : 1100;
}

function userAgent() {
  const contato =
    process.env.GEOCODING_CONTACT ||
    process.env.EMAIL_FROM ||
    "collectexpress.app@gmail.com";

  return `CollectExpress/1.0 (${contato})`;
}

/* ---------------------------- cache ---------------------------- */

const cache = new Map();

function lerCache(chave) {
  const item = cache.get(chave);

  if (!item) {
    return undefined;
  }

  if (item.expiraEm < Date.now()) {
    cache.delete(chave);
    return undefined;
  }

  return item.valor;
}

function gravarCache(chave, valor) {
  if (cache.size >= CACHE_MAX) {
    // Descarta o mais antigo (Map mantém a ordem de inserção).
    cache.delete(cache.keys().next().value);
  }

  cache.set(chave, { valor, expiraEm: Date.now() + CACHE_TTL_MS });
}

function limparCache() {
  cache.clear();
}

/* ------------------- fila do Nominatim (1 req/s) ------------------- */

let filaNominatim = Promise.resolve();
let ultimaChamadaNominatim = 0;

function dormir(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function naFilaDoNominatim(tarefa) {
  const execucao = filaNominatim.then(async () => {
    const espera =
      ultimaChamadaNominatim + intervaloNominatim() - Date.now();

    if (espera > 0) {
      await dormir(espera);
    }

    ultimaChamadaNominatim = Date.now();

    return tarefa();
  });

  // A fila segue mesmo se uma tarefa falhar.
  filaNominatim = execucao.catch(() => {});

  return execucao;
}

/* ---------------------------- helpers ---------------------------- */

function normalizarCep(cep) {
  const digitos = String(cep ?? "").replace(/\D/g, "");

  return digitos.length === 8 ? digitos : null;
}

function numero(valor) {
  const n = Number(valor);

  return valor !== null && valor !== undefined && valor !== "" && Number.isFinite(n)
    ? n
    : null;
}

function arredondar(valor) {
  return Math.round(valor * 1e6) / 1e6;
}

/** Aceita "São Paulo - SP", "São Paulo/SP" e "São Paulo, SP". */
function separarCidadeEstado(cidadeEstado) {
  const texto = String(cidadeEstado ?? "").trim();
  const partes = texto.match(/^(.*?)\s*[-/,]\s*([A-Za-z]{2})$/);

  return partes
    ? { cidade: partes[1].trim(), uf: partes[2].toUpperCase() }
    : { cidade: texto, uf: "" };
}

async function pedirJson(url, opcoes = {}) {
  let resposta;

  try {
    resposta = await fetch(url, {
      ...opcoes,
      headers: { Accept: "application/json", ...(opcoes.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (_) {
    throw new GeocodingUnavailableError();
  }

  // 404 e 400 significam "não achei"; o resto é falha do serviço.
  if (resposta.status === 404 || resposta.status === 400) {
    return null;
  }

  if (!resposta.ok) {
    throw new GeocodingUnavailableError();
  }

  try {
    return await resposta.json();
  } catch (_) {
    throw new GeocodingUnavailableError();
  }
}

/* ------------------------- provedores ------------------------- */

async function cepNaBrasilApi(cep) {
  const dados = await pedirJson(`${BRASIL_API}/${cep}`);

  if (!dados) {
    return null;
  }

  const coordenadas = dados.location?.coordinates;

  return {
    cep,
    logradouro: dados.street || "",
    bairro: dados.neighborhood || "",
    cidade: dados.city || "",
    uf: dados.state || "",
    latitude: numero(coordenadas?.latitude),
    longitude: numero(coordenadas?.longitude),
  };
}

async function cepNoViaCep(cep) {
  const dados = await pedirJson(`${VIA_CEP}/${cep}/json/`);

  if (!dados || dados.erro) {
    return null;
  }

  return {
    cep,
    logradouro: dados.logradouro || "",
    bairro: dados.bairro || "",
    cidade: dados.localidade || "",
    uf: dados.uf || "",
    latitude: null,
    longitude: null,
  };
}

async function procurarNoNominatim(consulta) {
  const parametros = new URLSearchParams({
    format: "jsonv2",
    limit: "1",
    countrycodes: "br",
    q: consulta,
  });

  const resultados = await naFilaDoNominatim(() =>
    pedirJson(`${NOMINATIM}?${parametros}`, {
      headers: { "User-Agent": userAgent(), "Accept-Language": "pt-BR" },
    }),
  );

  const primeiro = Array.isArray(resultados) ? resultados[0] : null;
  const latitude = numero(primeiro?.lat);
  const longitude = numero(primeiro?.lon);

  return latitude !== null && longitude !== null
    ? { latitude, longitude }
    : null;
}

/* --------------------------- API pública --------------------------- */

/**
 * Dados do endereço e coordenadas de um CEP.
 *
 * @returns {Promise<{cep, logradouro, bairro, cidade, uf, cidade_estado,
 *   latitude: number|null, longitude: number|null}|null>}
 *   null quando o CEP não existe.
 * @throws {GeocodingUnavailableError} se nenhum serviço respondeu.
 */
async function buscarCep(cepInformado) {
  const cep = normalizarCep(cepInformado);

  if (!cep) {
    return null;
  }

  const emCache = lerCache(`cep:${cep}`);

  if (emCache !== undefined) {
    return emCache;
  }

  let endereco = null;
  let falhas = 0;

  try {
    endereco = await cepNaBrasilApi(cep);
  } catch (_) {
    falhas += 1;
  }

  if (!endereco) {
    try {
      endereco = await cepNoViaCep(cep);
    } catch (_) {
      falhas += 1;
    }
  }

  // Os dois serviços falharam (não é "CEP inexistente").
  if (!endereco && falhas >= 2) {
    throw new GeocodingUnavailableError();
  }

  if (!endereco) {
    gravarCache(`cep:${cep}`, null);
    return null;
  }

  // Sem coordenadas no CEP: tenta achar pela rua/cidade.
  if (endereco.latitude === null || endereco.longitude === null) {
    try {
      const consulta = [
        endereco.logradouro,
        endereco.bairro,
        endereco.cidade,
        endereco.uf,
        "Brasil",
      ]
        .filter(Boolean)
        .join(", ");

      const ponto = await procurarNoNominatim(consulta);

      if (ponto) {
        endereco.latitude = ponto.latitude;
        endereco.longitude = ponto.longitude;
      }
    } catch (_) {
      // Sem coordenadas, mas o endereço continua válido.
    }
  }

  const resultado = {
    ...endereco,
    cidade_estado: endereco.uf
      ? `${endereco.cidade} - ${endereco.uf}`
      : endereco.cidade,
    latitude:
      endereco.latitude === null ? null : arredondar(endereco.latitude),
    longitude:
      endereco.longitude === null ? null : arredondar(endereco.longitude),
  };

  gravarCache(`cep:${cep}`, resultado);

  return resultado;
}

/**
 * Coordenadas de um endereço completo. Tenta, nesta ordem: rua com número,
 * rua sem número e o ponto do CEP. Nunca lança: devolve null se não achar.
 *
 * @returns {Promise<{latitude:number, longitude:number,
 *   precisao: "numero"|"rua"|"cep"}|null>}
 */
async function geocodificarEndereco(endereco) {
  const { cidade, uf } = separarCidadeEstado(endereco.cidade_estado);

  const base = [endereco.bairro, cidade, uf, "Brasil"]
    .filter(Boolean)
    .join(", ");

  const chave = `end:${[
    endereco.logradouro,
    endereco.numero,
    base,
  ]
    .join("|")
    .toLowerCase()}`;

  const emCache = lerCache(chave);

  if (emCache !== undefined) {
    return emCache;
  }

  const tentativas = [];

  if (endereco.logradouro && endereco.numero) {
    tentativas.push({
      precisao: "numero",
      consulta: `${endereco.logradouro}, ${endereco.numero}, ${base}`,
    });
  }

  if (endereco.logradouro) {
    tentativas.push({
      precisao: "rua",
      consulta: `${endereco.logradouro}, ${base}`,
    });
  }

  let resultado = null;
  let serviceDown = false;

  for (const tentativa of tentativas) {
    try {
      const ponto = await procurarNoNominatim(tentativa.consulta);

      if (ponto) {
        resultado = {
          latitude: arredondar(ponto.latitude),
          longitude: arredondar(ponto.longitude),
          precisao: tentativa.precisao,
        };
        break;
      }
    } catch (_) {
      serviceDown = true;
    }
  }

  if (!resultado && endereco.cep) {
    try {
      const doCep = await buscarCep(endereco.cep);

      if (doCep?.latitude != null && doCep?.longitude != null) {
        resultado = {
          latitude: doCep.latitude,
          longitude: doCep.longitude,
          precisao: "cep",
        };
      }
    } catch (_) {
      serviceDown = true;
    }
  }

  // Não guarda falha temporária em cache: a próxima chamada tenta de novo.
  if (resultado || !serviceDown) {
    gravarCache(chave, resultado);
  }

  return resultado;
}

module.exports = {
  GeocodingUnavailableError,
  normalizarCep,
  separarCidadeEstado,
  buscarCep,
  geocodificarEndereco,
  limparCache,
};
