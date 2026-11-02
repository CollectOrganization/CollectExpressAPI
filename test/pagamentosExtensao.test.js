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

jest.mock("../src/services/notificacaoService", () => ({
  EVENTOS: {
    PAGAMENTO_CONFIRMADO: "PAGAMENTO_CONFIRMADO",
    EXTENSAO_PAGA: "EXTENSAO_PAGA",
  },
  notificar: jest.fn(),
}));

const sql = require("../src/config/db");
const abacatePay = require("../src/services/abacatePayService");
const { notificar } = require("../src/services/notificacaoService");
const pagamentosController = require("../src/controllers/pagamentosController");

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function createRequest() {
  return {
    usuario_id: "cons-1",
    params: { id: "ped-1", extId: "ext-1" },
  };
}

const textoDaConsulta = (chamada) => chamada[0].join("?");

const extensaoAguardando = {
  id: "ext-1",
  aluguel_id: "ped-1",
  dias_adicionais: 4,
  valor: "1200.00",
  status: "AGUARDANDO_PAGAMENTO",
  pagamento_expira_em: new Date(Date.now() + 3600 * 1000).toISOString(),
};

const pixDaExtensao = {
  id: "pix-9",
  aluguel_id: "ped-1",
  extensao_id: "ext-1",
  cobranca_id: "pix_char_ext",
  valor_centavos: 120000,
  status: "PENDING",
  copia_cola: "000201...",
  qr_code_base64: "data:image/png;base64,AAA",
  dev_mode: true,
  expira_em: "2026-11-02T18:00:00.000Z",
  pago_em: null,
};

describe("PIX de extensão", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe("gerarPixExtensao", () => {
    it("cria a cobrança do valor da extensão e liga o PIX a ela", async () => {
      sql
        .mockResolvedValueOnce([extensaoAguardando])
        .mockResolvedValueOnce([]) // sem PIX pendente
        .mockResolvedValueOnce([pixDaExtensao]);

      abacatePay.criarCobrancaPix.mockResolvedValueOnce({
        id: "pix_char_ext",
        status: "PENDING",
        brCode: "000201...",
        brCodeBase64: "data:image/png;base64,AAA",
        devMode: true,
        expiresAt: "2026-11-02T18:00:00.000Z",
      });

      const res = createResponse();
      await pagamentosController.gerarPixExtensao(createRequest(), res);

      expect(abacatePay.criarCobrancaPix).toHaveBeenCalledWith({
        valorCentavos: 120000,
        descricao: "Extensão de locação de caçamba - CollectExpress",
        expiraEmSegundos: 3600,
        metadata: { aluguel_id: "ped-1", extensao_id: "ext-1" },
      });

      const insert = sql.mock.calls[2];
      expect(textoDaConsulta(insert)).toContain("INSERT INTO pagamentos_pix");
      expect(textoDaConsulta(insert)).toContain("extensao_id");
      expect(insert.slice(1)).toContain("ext-1");

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json.mock.calls[0][0].data).toMatchObject({
        extensao_id: "ext-1",
        aluguel_id: "ped-1",
        valor: 1200,
        status_pagamento: "PENDENTE",
      });
    });

    it("não encontra extensão de outro consumidor", async () => {
      sql.mockResolvedValueOnce([]);

      const res = createResponse();
      await pagamentosController.gerarPixExtensao(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe("EXTENSION_NOT_FOUND");
      expect(abacatePay.criarCobrancaPix).not.toHaveBeenCalled();
    });

    it("recusa extensão que não está aguardando pagamento", async () => {
      for (const status of [
        "SOLICITADA",
        "RECUSADA",
        "EXPIRADA",
        "CANCELADA",
      ]) {
        sql.mockReset();
        sql.mockResolvedValueOnce([{ ...extensaoAguardando, status }]);

        const res = createResponse();
        await pagamentosController.gerarPixExtensao(createRequest(), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json.mock.calls[0][0].code).toBe("EXTENSION_NOT_PAYABLE");
      }

      expect(abacatePay.criarCobrancaPix).not.toHaveBeenCalled();
    });

    it("recusa quando as 24 horas já passaram, mesmo sem a varredura ter rodado", async () => {
      sql.mockResolvedValueOnce([
        {
          ...extensaoAguardando,
          pagamento_expira_em: new Date(Date.now() - 1000).toISOString(),
        },
      ]);

      const res = createResponse();
      await pagamentosController.gerarPixExtensao(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe("EXTENSION_NOT_PAYABLE");
    });

    it("recusa extensão já paga", async () => {
      sql.mockResolvedValueOnce([{ ...extensaoAguardando, status: "PAGA" }]);

      const res = createResponse();
      await pagamentosController.gerarPixExtensao(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json.mock.calls[0][0].code).toBe("EXTENSION_ALREADY_PAID");
    });

    it("reaproveita o PIX pendente em vez de criar outro", async () => {
      sql
        .mockResolvedValueOnce([extensaoAguardando])
        .mockResolvedValueOnce([pixDaExtensao]);
      abacatePay.consultarCobranca.mockResolvedValueOnce({
        status: "PENDING",
      });

      const res = createResponse();
      await pagamentosController.gerarPixExtensao(createRequest(), res);

      expect(abacatePay.criarCobrancaPix).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("consultarPixExtensao", () => {
    it("quando pago, estende o aluguel na mesma instrução e avisa os dois", async () => {
      sql
        .mockResolvedValueOnce([extensaoAguardando])
        .mockResolvedValueOnce([pixDaExtensao])
        .mockResolvedValueOnce([
          {
            ...pixDaExtensao,
            status: "PAID",
            pago_em: "2026-11-02T17:10:00.000Z",
            extensao_paga: {
              id: "ext-1",
              aluguel_id: "ped-1",
              dias_adicionais: 4,
              valor: "1200.00",
              status: "PAGA",
            },
          },
        ]);
      abacatePay.consultarCobranca.mockResolvedValueOnce({ status: "PAID" });

      const res = createResponse();
      await pagamentosController.consultarPixExtensao(createRequest(), res);

      const atualizacao = textoDaConsulta(sql.mock.calls[2]);
      expect(atualizacao).toContain("UPDATE pagamentos_pix");
      expect(atualizacao).toContain("UPDATE extensoes_aluguel");
      expect(atualizacao).toContain("UPDATE alugueis");
      expect(atualizacao).toContain("dias_extra = a.dias_extra");
      expect(atualizacao).toContain("valor_extra = a.valor_extra");
      // Pagamento tardio (EXPIRADA) também vale: o dinheiro já entrou.
      expect(atualizacao).toContain("'AGUARDANDO_PAGAMENTO', 'EXPIRADA'");

      expect(notificar).toHaveBeenCalledWith(
        "EXTENSAO_PAGA",
        "ped-1",
        {
          extensao: expect.objectContaining({
            dias_adicionais: 4,
            valor: 1200,
          }),
        },
      );

      const { data } = res.json.mock.calls[0][0];
      expect(data.status_pagamento).toBe("PAGO");
      // Campo interno da CTE não vaza na resposta.
      expect(data).not.toHaveProperty("extensao_paga");
    });

    it("não notifica de novo quando a extensão já tinha sido paga (consulta repetida)", async () => {
      sql
        .mockResolvedValueOnce([extensaoAguardando])
        .mockResolvedValueOnce([pixDaExtensao])
        .mockResolvedValueOnce([
          { ...pixDaExtensao, status: "PAID", extensao_paga: null },
        ]);
      abacatePay.consultarCobranca.mockResolvedValueOnce({ status: "PAID" });

      const res = createResponse();
      await pagamentosController.consultarPixExtensao(createRequest(), res);

      expect(notificar).not.toHaveBeenCalled();
    });

    it("não consulta a AbacatePay de novo depois de pago", async () => {
      sql
        .mockResolvedValueOnce([{ ...extensaoAguardando, status: "PAGA" }])
        .mockResolvedValueOnce([{ ...pixDaExtensao, status: "PAID" }]);

      const res = createResponse();
      await pagamentosController.consultarPixExtensao(createRequest(), res);

      expect(abacatePay.consultarCobranca).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].data.status_pagamento).toBe("PAGO");
    });

    it("responde 404 sem PIX gerado", async () => {
      sql
        .mockResolvedValueOnce([extensaoAguardando])
        .mockResolvedValueOnce([]);

      const res = createResponse();
      await pagamentosController.consultarPixExtensao(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json.mock.calls[0][0].code).toBe("PIX_NOT_FOUND");
    });
  });

  describe("simularPixExtensao", () => {
    it("recusa com a chave de produção", async () => {
      sql
        .mockResolvedValueOnce([extensaoAguardando])
        .mockResolvedValueOnce([{ ...pixDaExtensao, dev_mode: false }]);

      const res = createResponse();
      await pagamentosController.simularPixExtensao(createRequest(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(abacatePay.simularPagamento).not.toHaveBeenCalled();
    });
  });

  describe("PIX do pedido não se mistura com o da extensão", () => {
    it("as consultas do pedido filtram extensao_id IS NULL", async () => {
      sql
        .mockResolvedValueOnce([
          { id: "ped-1", preco_final: "100", status_pagamento: "PENDENTE" },
        ])
        .mockResolvedValueOnce([]);

      const res = createResponse();
      await pagamentosController.consultarPix(
        { usuario_id: "cons-1", params: { id: "ped-1" } },
        res,
      );

      expect(textoDaConsulta(sql.mock.calls[1])).toContain(
        "extensao_id IS NULL",
      );

      sql.mockReset();
      sql
        .mockResolvedValueOnce([
          { id: "ped-1", preco_final: "100", status_pagamento: "PENDENTE" },
        ])
        .mockResolvedValueOnce([]);
      abacatePay.criarCobrancaPix.mockRejectedValueOnce(new Error("para aqui"));

      await pagamentosController.gerarPix(
        { usuario_id: "cons-1", params: { id: "ped-1" } },
        createResponse(),
      );

      expect(textoDaConsulta(sql.mock.calls[1])).toContain(
        "extensao_id IS NULL",
      );
    });

    it("pedido pago avisa os dois por e-mail uma única vez", async () => {
      sql
        .mockResolvedValueOnce([
          { id: "ped-1", preco_final: "100", status_pagamento: "PENDENTE" },
        ])
        .mockResolvedValueOnce([{ ...pixDaExtensao, extensao_id: null }])
        .mockResolvedValueOnce([
          {
            ...pixDaExtensao,
            extensao_id: null,
            status: "PAID",
            pedido_virou_pago: true,
          },
        ]);
      abacatePay.consultarCobranca.mockResolvedValueOnce({ status: "PAID" });

      const res = createResponse();
      await pagamentosController.consultarPix(
        { usuario_id: "cons-1", params: { id: "ped-1" } },
        res,
      );

      expect(notificar).toHaveBeenCalledTimes(1);
      expect(notificar).toHaveBeenCalledWith("PAGAMENTO_CONFIRMADO", "ped-1");
      expect(res.json.mock.calls[0][0].data).not.toHaveProperty(
        "pedido_virou_pago",
      );

      // Segunda consulta: o pedido já estava pago, a flag vem falsa.
      jest.clearAllMocks();
      sql.mockReset();
      sql
        .mockResolvedValueOnce([
          { id: "ped-1", preco_final: "100", status_pagamento: "PAGO" },
        ])
        .mockResolvedValueOnce([{ ...pixDaExtensao, extensao_id: null, status: "PAID" }]);

      await pagamentosController.consultarPix(
        { usuario_id: "cons-1", params: { id: "ped-1" } },
        createResponse(),
      );

      expect(notificar).not.toHaveBeenCalled();
    });
  });
});
