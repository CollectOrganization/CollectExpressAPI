jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/emailService", () => ({
  enviarEmail: jest.fn(),
  EmailError: class EmailError extends Error {},
}));

const sql = require("../src/config/db");
const { enviarEmail } = require("../src/services/emailService");
const {
  EVENTOS,
  EVENTO_POR_STATUS,
  montarMensagens,
  notificarAguardando,
  notificar,
} = require("../src/services/notificacaoService");

const pedido = {
  id: "11111111-2222-3333-4444-555555555555",
  data_inicio: "2026-11-02",
  dias_aluguel: 7,
  preco_final: "2140.00",
  consumidor_nome: "Maria <b>Souza</b>",
  consumidor_email: "maria@exemplo.com",
  cacambeiro_nome: "Locadora SP",
  cacambeiro_email: "locadora@exemplo.com",
  logradouro: "Rua das Flores",
  numero: "123",
  bairro: "Centro",
  cidade_estado: "São Paulo - SP",
};

const extensao = {
  id: "ext-1",
  dias_adicionais: 4,
  valor: 1200,
  solicitacao_expira_em: "2026-11-04T12:00:00.000Z",
  pagamento_expira_em: "2026-11-03T12:00:00.000Z",
};

const destinatarios = (mensagens) => mensagens.map((m) => m.para);

describe("montarMensagens", () => {
  it("pedido criado vai para os dois, com o contrato anexado", () => {
    const contratoPdf = Buffer.from("%PDF-1.3");
    const mensagens = montarMensagens(EVENTOS.PEDIDO_CRIADO, pedido, {
      contratoPdf,
    });

    expect(destinatarios(mensagens)).toEqual([
      "maria@exemplo.com",
      "locadora@exemplo.com",
    ]);

    for (const mensagem of mensagens) {
      expect(mensagem.anexos).toEqual([
        { nome: "contrato-COL-1111111122.pdf", conteudo: contratoPdf },
      ]);
      expect(mensagem.assunto).toContain("COL-1111111122");
    }
  });

  it("pedido criado sem PDF sai sem anexo", () => {
    const mensagens = montarMensagens(EVENTOS.PEDIDO_CRIADO, pedido, {});

    expect(mensagens.every((m) => m.anexos === undefined)).toBe(true);
  });

  it("pagamento confirmado avisa consumidor e caçambeiro", () => {
    expect(
      destinatarios(montarMensagens(EVENTOS.PAGAMENTO_CONFIRMADO, pedido)),
    ).toEqual(["maria@exemplo.com", "locadora@exemplo.com"]);
  });

  it("mudanças de etapa avisam só o consumidor", () => {
    for (const evento of [
      EVENTOS.ENTREGUE,
      EVENTOS.RETIRADA_SOLICITADA,
      EVENTOS.FINALIZADO,
    ]) {
      expect(destinatarios(montarMensagens(evento, pedido))).toEqual([
        "maria@exemplo.com",
      ]);
    }
  });

  it("cada novo status do aluguel tem um evento", () => {
    expect(EVENTO_POR_STATUS).toEqual({
      EM_USO: EVENTOS.ENTREGUE,
      AGUARDANDO_RETIRADA: EVENTOS.RETIRADA_SOLICITADA,
      FINALIZADO: EVENTOS.FINALIZADO,
    });
  });

  it("extensão solicitada vai para o caçambeiro, com o link de resposta", () => {
    const [mensagem] = montarMensagens(EVENTOS.EXTENSAO_SOLICITADA, pedido, {
      extensao,
      linkResposta: "https://api.teste.com/api/extensoes/resposta/abc",
    });

    expect(mensagem.para).toBe("locadora@exemplo.com");
    expect(mensagem.html).toContain(
      'href="https://api.teste.com/api/extensoes/resposta/abc"',
    );
    expect(mensagem.texto).toContain("R$");
  });

  it("extensão aceita diz ao consumidor que há 24 horas para pagar", () => {
    const [mensagem] = montarMensagens(EVENTOS.EXTENSAO_ACEITA, pedido, {
      extensao,
    });

    expect(mensagem.para).toBe("maria@exemplo.com");
    expect(mensagem.texto).toContain("24 horas");
    expect(mensagem.texto).toContain("cancelada");
  });

  it("extensão recusada, paga e vencida usam os destinatários certos", () => {
    expect(
      destinatarios(
        montarMensagens(EVENTOS.EXTENSAO_RECUSADA, pedido, { extensao }),
      ),
    ).toEqual(["maria@exemplo.com"]);

    expect(
      destinatarios(
        montarMensagens(EVENTOS.EXTENSAO_PAGA, pedido, { extensao }),
      ),
    ).toEqual(["maria@exemplo.com", "locadora@exemplo.com"]);

    expect(
      destinatarios(
        montarMensagens(EVENTOS.EXTENSAO_SEM_RESPOSTA, pedido, { extensao }),
      ),
    ).toEqual(["maria@exemplo.com", "locadora@exemplo.com"]);

    expect(
      destinatarios(
        montarMensagens(EVENTOS.EXTENSAO_PAGAMENTO_EXPIRADO, pedido, {
          extensao,
        }),
      ),
    ).toEqual(["maria@exemplo.com", "locadora@exemplo.com"]);
  });

  it("escapa nomes vindos do banco", () => {
    const mensagens = montarMensagens(EVENTOS.PAGAMENTO_CONFIRMADO, pedido);

    for (const mensagem of mensagens) {
      expect(mensagem.html).not.toContain("<b>Souza</b>");
    }
  });

  it("evento desconhecido não gera mensagens", () => {
    expect(montarMensagens("NADA", pedido)).toEqual([]);
    expect(montarMensagens(undefined, pedido)).toEqual([]);
  });
});

describe("notificarAguardando / notificar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  it("envia um e-mail por destinatário e conta os enviados", async () => {
    sql.mockResolvedValueOnce([pedido]);
    enviarEmail.mockResolvedValue(undefined);

    const total = await notificarAguardando(
      EVENTOS.PAGAMENTO_CONFIRMADO,
      pedido.id,
    );

    expect(total).toBe(2);
    expect(enviarEmail).toHaveBeenCalledTimes(2);
  });

  it("falha em um destinatário não impede o outro", async () => {
    sql.mockResolvedValueOnce([pedido]);
    enviarEmail
      .mockRejectedValueOnce(new Error("caixa cheia"))
      .mockResolvedValueOnce(undefined);

    const total = await notificarAguardando(
      EVENTOS.PAGAMENTO_CONFIRMADO,
      pedido.id,
    );

    expect(total).toBe(1);
    expect(enviarEmail).toHaveBeenCalledTimes(2);
  });

  it("pedido inexistente não envia nada", async () => {
    sql.mockResolvedValueOnce([]);

    expect(
      await notificarAguardando(EVENTOS.FINALIZADO, "nao-existe"),
    ).toBe(0);
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("notificar nunca lança, mesmo se o banco falhar", async () => {
    sql.mockRejectedValueOnce(new Error("banco fora do ar"));

    expect(() =>
      notificar(EVENTOS.FINALIZADO, pedido.id),
    ).not.toThrow();

    await new Promise((resolve) => setImmediate(resolve));

    expect(console.error).toHaveBeenCalled();
  });
});
