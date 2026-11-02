const {
  gerarContratoPdf,
  formatarDocumento,
  formatarMoeda,
  formatarData,
  dataDeTermino,
} = require("../src/services/contratoPdfService");
const { png } = require("./helpers/imagens");

const dadosBase = {
  numero: "COL-1A2B3C4D5E",
  emitidoEm: new Date("2026-10-31T21:34:00Z"),
  locadora: {
    nome: "São Paulo Express Locação LTDA",
    documento: "12345678000190",
    assinatura: null,
  },
  locatario: {
    nome: "Maria Aparecida de Souza",
    documento: "12345678901",
    email: "maria@exemplo.com",
    assinatura: png(600, 200),
  },
  endereco: {
    cep: "01001000",
    logradouro: "Rua das Flores",
    numero: "123",
    bairro: "Centro",
    cidade_estado: "São Paulo - SP",
  },
  itens: [
    {
      nome: "Caçamba 5m³",
      tamanho_m3: "5.00",
      quantidade: 2,
      dias: 7,
      preco_diaria: "150.00",
    },
  ],
  dataInicio: "2026-11-02",
  dias: 7,
  taxaEntrega: 40,
  total: 2140,
  aceite: { em: new Date("2026-10-31T21:34:00Z"), ip: "203.0.113.5" },
};

describe("gerarContratoPdf", () => {
  it("gera um PDF válido", async () => {
    const pdf = await gerarContratoPdf(dadosBase);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.subarray(-6).toString()).toContain("%%EOF");
    expect(pdf.length).toBeGreaterThan(5000);
  });

  it("mantém o contrato em uma página", async () => {
    const pdf = await gerarContratoPdf(dadosBase);
    const paginas = pdf.toString("latin1").match(/\/Type \/Page\b/g);

    expect(paginas).toHaveLength(1);
  });

  it("funciona sem assinatura da empresa (texto no lugar da imagem)", async () => {
    await expect(
      gerarContratoPdf({
        ...dadosBase,
        locadora: { ...dadosBase.locadora, assinatura: null },
      }),
    ).resolves.toBeInstanceOf(Buffer);
  });

  it("não quebra com assinatura inválida: registra e segue", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      gerarContratoPdf({
        ...dadosBase,
        locatario: {
          ...dadosBase.locatario,
          assinatura: Buffer.from("isto não é uma imagem"),
        },
      }),
    ).resolves.toBeInstanceOf(Buffer);

    console.error.mockRestore();
  });

  it("aguenta nomes longos e muitos itens", async () => {
    const itens = Array.from({ length: 12 }, (_, i) => ({
      nome: `Caçamba de entulho de obra modelo ${i} com nome bem comprido`,
      tamanho_m3: "7.00",
      quantidade: 1,
      dias: 3,
      preco_diaria: "99.90",
    }));

    const pdf = await gerarContratoPdf({
      ...dadosBase,
      itens,
      locatario: {
        ...dadosBase.locatario,
        nome: "Fulano de Tal da Silva Sauro Pereira de Albuquerque Santos",
      },
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("formatadores", () => {
  it("formata CPF e CNPJ", () => {
    expect(formatarDocumento("12345678901")).toBe("123.456.789-01");
    expect(formatarDocumento("12345678000190")).toBe("12.345.678/0001-90");
    expect(formatarDocumento("123")).toBe("123");
    expect(formatarDocumento(null)).toBe("-");
  });

  it("formata moeda em reais", () => {
    expect(formatarMoeda(2410)).toMatch(/R\$\s?2\.410,00/);
    expect(formatarMoeda("40.5")).toMatch(/R\$\s?40,50/);
  });

  it("formata datas de string e de Date (meia-noite local)", () => {
    expect(formatarData("2026-11-02")).toBe("02/11/2026");
    expect(formatarData("2026-11-02T00:00:00.000Z")).toBe("02/11/2026");
    expect(formatarData(new Date(2026, 10, 2))).toBe("02/11/2026");
    expect(formatarData(null)).toBe("-");
  });

  it("calcula o término somando os dias, inclusive virando o mês", () => {
    expect(dataDeTermino("2026-11-28", 7).toISOString().slice(0, 10)).toBe(
      "2026-12-05",
    );
    expect(dataDeTermino("2026-12-30", 3).toISOString().slice(0, 10)).toBe(
      "2027-01-02",
    );
    expect(dataDeTermino("invalida", 3)).toBeNull();
  });
});
