jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/abacatePayService", () => {
  const actual = jest.requireActual("../src/services/abacatePayService");

  return {
    ...actual,
    criarCobrancaPix: jest.fn(),
    consultarCobranca: jest.fn(),
    simularPagamento: jest.fn(),
  };
});

const sql = require("../src/config/db");
const abacatePay = require("../src/services/abacatePayService");
const pagamentosController = require(
  "../src/controllers/pagamentosController",
);

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function createRequest() {
  return {
    usuario_id: "consumidor-1",
    params: { id: "pedido-1" },
  };
}

/** Texto da consulta SQL de uma chamada ao `sql` (tagged template). */
function textoDaConsulta(chamada) {
  return chamada[0].join("?");
}

const pedidoPendente = {
  id: "pedido-1",
  preco_final: "450.50",
  status_pagamento: "PENDENTE",
};

const pixPendente = {
  id: "pix-1",
  aluguel_id: "pedido-1",
  cobranca_id: "pix_char_123",
  valor_centavos: 45050,
  status: "PENDING",
  copia_cola: "00020101021226...",
  qr_code_base64: "data:image/png;base64,AAA",
  dev_mode: true,
  expira_em: "2026-10-27T18:00:00.000Z",
  pago_em: null,
};

describe("pagamentosController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe("gerarPix", () => {
    test("cria a cobrança na AbacatePay e grava o PIX", async () => {
      sql
        .mockResolvedValueOnce([pedidoPendente])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([pixPendente]);

      abacatePay.criarCobrancaPix.mockResolvedValueOnce({
        id: "pix_char_123",
        status: "PENDING",
        brCode: "00020101021226...",
        brCodeBase64: "data:image/png;base64,AAA",
        devMode: true,
        expiresAt: "2026-10-27T18:00:00.000Z",
      });

      const res = createResponse();
      await pagamentosController.gerarPix(createRequest(), res);

      expect(abacatePay.criarCobrancaPix).toHaveBeenCalledWith({
        valorCentavos: 45050,
        descricao: "Locação de caçamba - CollectExpress",
        expiraEmSegundos: 3600,
        metadata: { aluguel_id: "pedido-1" },
      });
      expect(textoDaConsulta(sql.mock.calls[2])).toContain(
        "INSERT INTO pagamentos_pix",
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: "pix-1",
          aluguel_id: "pedido-1",
          status: "PENDING",
          status_pagamento: "PENDENTE",
          valor: 450.5,
          copia_cola: "00020101021226...",
          qr_code_base64: "data:image/png;base64,AAA",
          dev_mode: true,
          expira_em: "2026-10-27T18:00:00.000Z",
          pago_em: null,
        },
      });
    });

    test("devolve o PIX pendente em vez de criar outro", async () => {
      sql
        .mockResolvedValueOnce([pedidoPendente])
        .mockResolvedValueOnce([pixPendente]);
      abacatePay.consultarCobranca.mockResolvedValueOnce({
        id: "pix_char_123",
        status: "PENDING",
      });

      const res = createResponse();
      await pagamentosController.gerarPix(createRequest(), res);

      expect(abacatePay.criarCobrancaPix).not.toHaveBeenCalled();
      expect(sql).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("recusa pedido já pago", async () => {
      sql.mockResolvedValueOnce([
        { ...pedidoPendente, status_pagamento: "PAGO" },
      ]);

      const res = createResponse();
      await pagamentosController.gerarPix(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ORDER_ALREADY_PAID" }),
      );
      expect(abacatePay.criarCobrancaPix).not.toHaveBeenCalled();
    });

    test("não encontra pedido de outro consumidor", async () => {
      sql.mockResolvedValueOnce([]);

      const res = createResponse();
      await pagamentosController.gerarPix(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "ORDER_NOT_FOUND" }),
      );
    });

    test("responde 503 quando a chave da AbacatePay não está configurada", async () => {
      sql
        .mockResolvedValueOnce([pedidoPendente])
        .mockResolvedValueOnce([]);
      abacatePay.criarCobrancaPix.mockRejectedValueOnce(
        new abacatePay.PaymentProviderError(
          "O pagamento por PIX não está configurado no servidor.",
          { statusCode: 503, code: "PAYMENT_NOT_CONFIGURED" },
        ),
      );

      const res = createResponse();
      await pagamentosController.gerarPix(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "O pagamento por PIX não está configurado no servidor.",
        code: "PAYMENT_NOT_CONFIGURED",
      });
    });
  });

  describe("consultarPix", () => {
    test("marca o pedido como pago quando a cobrança foi paga", async () => {
      sql
        .mockResolvedValueOnce([pedidoPendente])
        .mockResolvedValueOnce([pixPendente])
        .mockResolvedValueOnce([
          {
            ...pixPendente,
            status: "PAID",
            pago_em: "2026-10-27T17:10:00.000Z",
          },
        ]);
      abacatePay.consultarCobranca.mockResolvedValueOnce({
        id: "pix_char_123",
        status: "PAID",
      });

      const res = createResponse();
      await pagamentosController.consultarPix(createRequest(), res);

      expect(abacatePay.consultarCobranca).toHaveBeenCalledWith(
        "pix_char_123",
      );

      const atualizacao = sql.mock.calls[2];
      expect(textoDaConsulta(atualizacao)).toContain("UPDATE alugueis");
      expect(textoDaConsulta(atualizacao)).toContain(
        "SET status_pagamento = 'PAGO'",
      );
      expect(atualizacao.slice(1)).toEqual(
        expect.arrayContaining(["PAID", true, "pix-1", "pedido-1"]),
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data).toMatchObject({
        status: "PAID",
        status_pagamento: "PAGO",
        pago_em: "2026-10-27T17:10:00.000Z",
      });
    });

    test("não consulta a AbacatePay de novo depois que o PIX foi pago", async () => {
      sql
        .mockResolvedValueOnce([
          { ...pedidoPendente, status_pagamento: "PAGO" },
        ])
        .mockResolvedValueOnce([{ ...pixPendente, status: "PAID" }]);

      const res = createResponse();
      await pagamentosController.consultarPix(createRequest(), res);

      expect(abacatePay.consultarCobranca).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].data.status_pagamento).toBe("PAGO");
    });

    test("responde 404 quando o pedido ainda não tem PIX", async () => {
      sql
        .mockResolvedValueOnce([pedidoPendente])
        .mockResolvedValueOnce([]);

      const res = createResponse();
      await pagamentosController.consultarPix(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PIX_NOT_FOUND" }),
      );
    });
  });

  describe("simularPix", () => {
    test("simula o pagamento no modo de teste", async () => {
      sql
        .mockResolvedValueOnce([pedidoPendente])
        .mockResolvedValueOnce([pixPendente])
        .mockResolvedValueOnce([{ ...pixPendente, status: "PAID" }]);
      abacatePay.simularPagamento.mockResolvedValueOnce({});
      abacatePay.consultarCobranca.mockResolvedValueOnce({
        status: "PAID",
      });

      const res = createResponse();
      await pagamentosController.simularPix(createRequest(), res);

      expect(abacatePay.simularPagamento).toHaveBeenCalledWith(
        "pix_char_123",
      );
      expect(res.json.mock.calls[0][0].data.status_pagamento).toBe("PAGO");
    });

    test("recusa a simulação com a chave de produção", async () => {
      sql
        .mockResolvedValueOnce([pedidoPendente])
        .mockResolvedValueOnce([{ ...pixPendente, dev_mode: false }]);

      const res = createResponse();
      await pagamentosController.simularPix(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: "PIX_SIMULATION_NOT_ALLOWED" }),
      );
      expect(abacatePay.simularPagamento).not.toHaveBeenCalled();
    });
  });
});
