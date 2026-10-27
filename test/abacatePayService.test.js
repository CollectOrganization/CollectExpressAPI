const abacatePay = require("../src/services/abacatePayService");

function respostaJson(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("abacatePayService", () => {
  const chaveOriginal = process.env.ABACATEPAY_API_KEY;

  beforeEach(() => {
    process.env.ABACATEPAY_API_KEY = "chave-de-teste";
    global.fetch = jest.fn();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (chaveOriginal === undefined) {
      delete process.env.ABACATEPAY_API_KEY;
    } else {
      process.env.ABACATEPAY_API_KEY = chaveOriginal;
    }
    delete global.fetch;
    console.error.mockRestore();
  });

  test("cria a cobrança PIX com o valor em centavos", async () => {
    fetch.mockResolvedValueOnce(
      respostaJson(200, {
        success: true,
        error: null,
        data: { id: "pix_char_123", status: "PENDING" },
      }),
    );

    const cobranca = await abacatePay.criarCobrancaPix({
      valorCentavos: 45050,
      descricao: "Locação",
      expiraEmSegundos: 3600,
      metadata: { aluguel_id: "pedido-1" },
    });

    expect(cobranca).toEqual({ id: "pix_char_123", status: "PENDING" });

    const [url, options] = fetch.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.abacatepay.com/v2/transparents/create",
    );
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer chave-de-teste");
    expect(JSON.parse(options.body)).toEqual({
      method: "PIX",
      data: {
        amount: 45050,
        description: "Locação",
        expiresIn: 3600,
        metadata: { aluguel_id: "pedido-1" },
      },
    });
  });

  test("consulta e simula pelo id da cobrança", async () => {
    fetch.mockResolvedValue(
      respostaJson(200, { success: true, data: { status: "PAID" } }),
    );

    await abacatePay.consultarCobranca("pix_char_123");
    await abacatePay.simularPagamento("pix_char_123");

    expect(String(fetch.mock.calls[0][0])).toBe(
      "https://api.abacatepay.com/v2/transparents/check?id=pix_char_123",
    );
    expect(fetch.mock.calls[0][1].method).toBe("GET");
    expect(String(fetch.mock.calls[1][0])).toBe(
      "https://api.abacatepay.com/v2/transparents/simulate-payment?id=pix_char_123",
    );
    expect(fetch.mock.calls[1][1].method).toBe("POST");
  });

  test("sem chave, falha com 503 sem chamar a AbacatePay", async () => {
    delete process.env.ABACATEPAY_API_KEY;

    await expect(
      abacatePay.consultarCobranca("pix_char_123"),
    ).rejects.toMatchObject({
      name: "PaymentProviderError",
      statusCode: 503,
      code: "PAYMENT_NOT_CONFIGURED",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  test("erro da AbacatePay vira 502", async () => {
    fetch.mockResolvedValueOnce(
      respostaJson(401, {
        success: false,
        error: "Token de autenticação inválido ou ausente.",
      }),
    );

    await expect(
      abacatePay.consultarCobranca("pix_char_123"),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "PAYMENT_PROVIDER_ERROR",
    });
  });

  test("falha de rede vira 502", async () => {
    fetch.mockRejectedValueOnce(new Error("ECONNRESET"));

    await expect(
      abacatePay.consultarCobranca("pix_char_123"),
    ).rejects.toMatchObject({
      statusCode: 502,
      message: "Não foi possível falar com o serviço de pagamento.",
    });
  });
});
