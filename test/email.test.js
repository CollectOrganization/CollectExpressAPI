const {
  enviarEmail,
  EmailError,
} = require("../src/services/emailService");
const {
  escaparHtml,
  linkSeguro,
  montarEmail,
} = require("../src/services/emailTemplates");

const mensagem = {
  para: "cliente@exemplo.com",
  nome: "Cliente",
  assunto: "Teste",
  html: "<p>oi</p>",
  texto: "oi",
};

describe("emailService", () => {
  const ambienteOriginal = { ...process.env };

  afterEach(() => {
    process.env = { ...ambienteOriginal };
    jest.restoreAllMocks();
  });

  it("usa o driver console quando não há chave do Brevo", async () => {
    delete process.env.EMAIL_DRIVER;
    delete process.env.BREVO_API_KEY;

    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    global.fetch = jest.fn();

    await enviarEmail(mensagem);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toContain("cliente@exemplo.com");
  });

  it("envia pelo Brevo com remetente, destinatário e anexo em base64", async () => {
    process.env.EMAIL_DRIVER = "brevo";
    process.env.BREVO_API_KEY = "chave-secreta";
    process.env.EMAIL_FROM = "collectexpress.app@gmail.com";

    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    await enviarEmail({
      ...mensagem,
      anexos: [{ nome: "contrato.pdf", conteudo: Buffer.from("%PDF-1") }],
    });

    const [url, opcoes] = global.fetch.mock.calls[0];
    const corpo = JSON.parse(opcoes.body);

    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(opcoes.headers["api-key"]).toBe("chave-secreta");
    expect(corpo.sender).toEqual({
      email: "collectexpress.app@gmail.com",
      name: "Collect Express",
    });
    expect(corpo.to).toEqual([
      { email: "cliente@exemplo.com", name: "Cliente" },
    ]);
    expect(corpo.subject).toBe("Teste");
    expect(corpo.attachment).toEqual([
      {
        name: "contrato.pdf",
        content: Buffer.from("%PDF-1").toString("base64"),
      },
    ]);
  });

  it("lança EmailError quando o Brevo recusa, sem vazar a chave", async () => {
    process.env.EMAIL_DRIVER = "brevo";
    process.env.BREVO_API_KEY = "chave-secreta";

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"Key not found"}',
    });

    const erro = await enviarEmail(mensagem).catch((e) => e);

    expect(erro).toBeInstanceOf(EmailError);
    expect(erro.message).toContain("401");
    expect(erro.message).not.toContain("chave-secreta");
  });

  it("lança EmailError quando a rede falha", async () => {
    process.env.EMAIL_DRIVER = "brevo";
    process.env.BREVO_API_KEY = "x";

    global.fetch = jest.fn().mockRejectedValue(new Error("timeout"));

    await expect(enviarEmail(mensagem)).rejects.toThrow(/indisponível/);
  });

  it("exige destinatário e rejeita driver desconhecido", async () => {
    await expect(
      enviarEmail({ ...mensagem, para: "" }),
    ).rejects.toThrow(EmailError);

    process.env.EMAIL_DRIVER = "pombo-correio";

    await expect(enviarEmail(mensagem)).rejects.toThrow(/desconhecido/);
  });
});

describe("emailTemplates", () => {
  it("escapa HTML em todo texto", () => {
    expect(escaparHtml(`<script>alert("x")</script>&'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;",
    );
  });

  it("não deixa HTML do banco entrar no e-mail", () => {
    const { html } = montarEmail({
      titulo: "Olá",
      saudacao: "Olá, <b>Hacker</b>.",
      paragrafos: ["<img src=x onerror=alert(1)>"],
      detalhes: [["Nome", "<script>x</script>"]],
    });

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;b&gt;Hacker&lt;/b&gt;");
  });

  it("só aceita links http(s) no botão", () => {
    expect(linkSeguro("https://app.com/x")).toBe("https://app.com/x");
    expect(linkSeguro("javascript:alert(1)")).toBeNull();
    expect(linkSeguro("não é url")).toBeNull();

    const perigoso = montarEmail({
      titulo: "T",
      paragrafos: [],
      botao: { texto: "Clique", url: "javascript:alert(1)" },
    });

    expect(perigoso.html).not.toContain("javascript:");
    expect(perigoso.html).not.toContain("Clique");

    const seguro = montarEmail({
      titulo: "T",
      paragrafos: [],
      botao: { texto: "Abrir", url: "https://app.com/x" },
    });

    expect(seguro.html).toContain('href="https://app.com/x"');
    expect(seguro.texto).toContain("https://app.com/x");
  });
});
