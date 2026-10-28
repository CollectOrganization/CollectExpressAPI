/*
 * Cliente da AbacatePay (API v2, Checkout Transparente com PIX).
 *
 * A chave vem de ABACATEPAY_API_KEY e define o ambiente:
 * com a chave do modo de teste nada é cobrado de verdade e a
 * cobrança pode ter o pagamento simulado.
 *
 * Documentação: https://docs.abacatepay.com/pages/transparents/reference
 */

const BASE_URL = "https://api.abacatepay.com/v2";
const TIMEOUT_MS = 10000;

class PaymentProviderError extends Error {
  constructor(
    message,
    {
      statusCode = 502,
      code = "PAYMENT_PROVIDER_ERROR",
    } = {},
  ) {
    super(message);
    this.name = "PaymentProviderError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getApiKey() {
  const apiKey = process.env.ABACATEPAY_API_KEY?.trim();

  if (!apiKey) {
    throw new PaymentProviderError(
      "O pagamento por PIX não está configurado no servidor.",
      {
        statusCode: 503,
        code: "PAYMENT_NOT_CONFIGURED",
      },
    );
  }

  return apiKey;
}

/**
 * Chama a AbacatePay e devolve o `data` da resposta.
 *
 * Qualquer falha vira PaymentProviderError. A mensagem original
 * fica só no log, para não expor detalhes do provedor ao app.
 */
async function request(method, path, { query, body } = {}) {
  const apiKey = getApiKey();
  const url = new URL(`${BASE_URL}${path}`);

  for (const [name, value] of Object.entries(query ?? {})) {
    url.searchParams.set(name, value);
  }

  let response;

  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error("AbacatePay indisponível:", error.message);

    throw new PaymentProviderError(
      "Não foi possível falar com o serviço de pagamento.",
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success !== true) {
    console.error(
      "AbacatePay recusou a requisição:",
      method,
      path,
      response.status,
      payload?.error,
    );

    throw new PaymentProviderError(
      "O serviço de pagamento recusou a solicitação.",
    );
  }

  return payload.data;
}

/**
 * Cria uma cobrança PIX.
 *
 * Devolve `{ id, status, brCode, brCodeBase64, expiresAt, devMode }`:
 * - brCode: código "copia e cola";
 * - brCodeBase64: imagem do QR Code (data URI PNG).
 */
function criarCobrancaPix({
  valorCentavos,
  descricao,
  expiraEmSegundos,
  metadata,
}) {
  return request("POST", "/transparents/create", {
    body: {
      method: "PIX",
      data: {
        amount: valorCentavos,
        description: descricao,
        expiresIn: expiraEmSegundos,
        metadata,
      },
    },
  });
}

/**
 * Status atual da cobrança: PENDING, PAID, EXPIRED, CANCELLED...
 */
function consultarCobranca(cobrancaId) {
  return request("GET", "/transparents/check", {
    query: { id: cobrancaId },
  });
}

/**
 * Simula o pagamento. Só funciona com a chave do modo de teste.
 */
function simularPagamento(cobrancaId) {
  return request("POST", "/transparents/simulate-payment", {
    query: { id: cobrancaId },
  });
}

module.exports = {
  PaymentProviderError,
  criarCobrancaPix,
  consultarCobranca,
  simularPagamento,
};
