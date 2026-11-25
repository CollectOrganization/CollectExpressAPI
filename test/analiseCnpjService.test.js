jest.mock("../src/config/db", () => jest.fn());

const analise = require("../src/services/analiseCnpjService");

/* CNPJ de exemplo com dígitos verificadores válidos. */
const CNPJ = "11222333000181";
const AGORA = new Date("2026-11-25T12:00:00Z");

function resposta(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

/** Resposta da BrasilAPI de uma empresa de caçambas (dados fictícios). */
function empresaDeCacambas(extra = {}) {
  return {
    cnpj: CNPJ,
    razao_social: "JR LOCACAO DE CACAMBAS LTDA",
    nome_fantasia: "JR CACAMBAS",
    descricao_situacao_cadastral: "ATIVA",
    descricao_motivo_situacao_cadastral: "SEM MOTIVO",
    data_inicio_atividade: "2019-03-10",
    cnae_fiscal: 3811400,
    cnae_fiscal_descricao: "Coleta de resíduos não-perigosos",
    cnaes_secundarios: [
      {
        codigo: 7732201,
        descricao:
          "Aluguel de máquinas e equipamentos para construção sem operador, exceto andaimes",
      },
    ],
    natureza_juridica: "Sociedade Empresária Limitada",
    porte: "MICRO EMPRESA",
    municipio: "SAO PAULO",
    uf: "SP",
    opcao_pelo_mei: false,
    email: "contato@jrcacambas.com.br",
    ddd_telefone_1: "1133334444",
    qsa: [{ nome_socio: "JOSE ROBERTO DA SILVA", qualificacao_socio: "Sócio-Administrador" }],
    ...extra,
  };
}

/** Roteia as chamadas de fetch por trecho da URL. */
function simularFontes({ brasilApi, minhaReceita }) {
  global.fetch = jest.fn(async (url) => {
    const texto = String(url);
    const responder = texto.includes("brasilapi.com.br") ? brasilApi : minhaReceita;

    if (responder instanceof Error) throw responder;
    return responder;
  });
}

/** Cliente falso do Claude que devolve [corpo] como JSON. */
function iaRespondendo(corpo) {
  const create = jest.fn(async () => ({
    model: "claude-opus-5-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(corpo) }],
  }));

  analise.definirClienteLlm({ beta: { messages: { create } } });
  return create;
}

function respostaIa({ atividade = "PRINCIPAL_COMPATIVEL", nome = "CONSISTENTE" } = {}) {
  return {
    atividade: {
      classificacao: atividade,
      cnaes_compativeis: atividade === "INCOMPATIVEL" ? [] : ["3811-4/00"],
      justificativa: "Coleta de resíduos é o serviço de quem aluga caçambas.",
    },
    nome: {
      classificacao: nome,
      justificativa: "JR Caçambas é o nome fantasia da empresa.",
    },
    pontos_de_atencao: [],
    parecer: "Empresa ativa há 7 anos, com atividade principal de coleta de resíduos.",
  };
}

const entrada = { cnpj: CNPJ, perfil: "CACAMBEIRO", nomeInformado: "JR Caçambas" };

beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  analise.definirClienteLlm(null);
  delete process.env.ANALISE_CNPJ_IA;
  jest.restoreAllMocks();
});

describe("utilidades", () => {
  it("confere os dígitos verificadores do CNPJ", () => {
    expect(analise.cnpjValido("00.000.000/0001-91")).toBe(true);
    expect(analise.cnpjValido(CNPJ)).toBe(true);
    expect(analise.cnpjValido("11222333000182")).toBe(false);
    expect(analise.cnpjValido("11111111111111")).toBe(false);
    expect(analise.cnpjValido("123")).toBe(false);
  });

  it("formata o código CNAE", () => {
    expect(analise.formatarCnae(3811400)).toBe("3811-4/00");
    expect(analise.formatarCnae(111301)).toBe("0111-3/01");
  });

  it("descarta sócios, e-mail, telefone e CNAE secundário vazio", () => {
    const dados = analise.resumirDadosReceita(
      empresaDeCacambas({
        cnaes_secundarios: [{ codigo: 0, descricao: "" }],
      }),
    );

    expect(dados).not.toHaveProperty("qsa");
    expect(dados).not.toHaveProperty("email");
    expect(JSON.stringify(dados)).not.toContain("JOSE ROBERTO");
    expect(dados.cnaes_secundarios).toEqual([]);
    expect(dados.cnae_principal).toEqual({
      codigo: "3811-4/00",
      descricao: "Coleta de resíduos não-perigosos",
    });
  });
});

describe("analisarCnpj", () => {
  it("empresa de caçambas ativa: nota 10 e recomendação de aprovar", async () => {
    simularFontes({ brasilApi: resposta(200, empresaDeCacambas()) });
    const create = iaRespondendo(respostaIa());

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.nota).toBe(10);
    expect(resultado.recomendacao).toBe("APROVAR");
    expect(resultado.fonte).toBe("BrasilAPI");
    expect(resultado.ia).toEqual({ usada: true, modelo: "claude-opus-5-5", motivo: null });
    expect(resultado.parecer).toContain("coleta de resíduos");
    expect(resultado.cnpj).toBe("**.***.333/0001-81");
    expect(resultado.checagens.map((c) => c.pontos)).toEqual([35, 15, 40, 10]);

    // Uma chamada, com saída em JSON Schema e sem dados pessoais.
    const [params] = create.mock.calls[0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params.output_config.effort).toBe("low");
    expect(params.fallbacks).toBe("default");

    const mensagem = params.messages[0].content;
    expect(mensagem).toContain("Coleta de resíduos não-perigosos");
    expect(mensagem).toContain('"JR Caçambas"');
    expect(mensagem).not.toContain("JOSE ROBERTO");
    expect(mensagem).not.toContain("contato@jrcacambas");
  });

  it("padaria ativa: atividade incompatível leva a reprovar", async () => {
    simularFontes({
      brasilApi: resposta(
        200,
        empresaDeCacambas({
          razao_social: "PADARIA PAO QUENTE LTDA",
          nome_fantasia: "PAO QUENTE",
          cnae_fiscal: 1091102,
          cnae_fiscal_descricao:
            "Fabricação de produtos de padaria e confeitaria com predominância de produção própria",
          cnaes_secundarios: [],
        }),
      ),
    });
    iaRespondendo(respostaIa({ atividade: "INCOMPATIVEL", nome: "INCONSISTENTE" }));

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.recomendacao).toBe("REPROVAR");
    expect(resultado.nota).toBe(5);
    expect(resultado.atividade.classificacao).toBe("INCOMPATIVEL");
  });

  it("nome que não confere segura em revisar mesmo com nota alta", async () => {
    simularFontes({ brasilApi: resposta(200, empresaDeCacambas()) });
    iaRespondendo(respostaIa({ nome: "INCONSISTENTE" }));

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.nota).toBe(9);
    expect(resultado.recomendacao).toBe("REVISAR");
  });

  it("CNPJ com dígito errado é reprovado sem consultar nada", async () => {
    global.fetch = jest.fn();
    const create = iaRespondendo(respostaIa());

    const resultado = await analise.analisarCnpj(
      { ...entrada, cnpj: "11222333000182" },
      { agora: AGORA },
    );

    expect(resultado).toMatchObject({ nota: 0, recomendacao: "REPROVAR", resumo: "CNPJ inválido." });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("CNPJ que nenhuma fonte encontra é reprovado", async () => {
    simularFontes({ brasilApi: resposta(404, null), minhaReceita: resposta(404, null) });

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.recomendacao).toBe("REPROVAR");
    expect(resultado.resumo).toContain("não encontrado");
  });

  it("empresa baixada é reprovada sem chamar a IA", async () => {
    simularFontes({
      brasilApi: resposta(
        200,
        empresaDeCacambas({
          descricao_situacao_cadastral: "BAIXADA",
          descricao_motivo_situacao_cadastral: "EXTINCAO POR ENCERRAMENTO LIQUIDACAO VOLUNTARIA",
        }),
      ),
    });
    const create = iaRespondendo(respostaIa());

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.recomendacao).toBe("REPROVAR");
    expect(resultado.checagens[0].resultado).toContain("BAIXADA");
    expect(create).not.toHaveBeenCalled();
  });

  it("usa a Minha Receita quando a BrasilAPI cai", async () => {
    simularFontes({
      brasilApi: new Error("ECONNRESET"),
      minhaReceita: resposta(200, empresaDeCacambas()),
    });
    iaRespondendo(respostaIa());

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.fonte).toBe("Minha Receita");
  });

  it("as duas fontes fora do ar viram CnpjIndisponivelError", async () => {
    simularFontes({ brasilApi: resposta(503, null), minhaReceita: new Error("timeout") });

    await expect(analise.analisarCnpj(entrada, { agora: AGORA })).rejects.toBeInstanceOf(
      analise.CnpjIndisponivelError,
    );
  });

  it("sem credencial da IA: nota em branco e pede conferência manual", async () => {
    simularFontes({ brasilApi: resposta(200, empresaDeCacambas()) });
    analise.definirClienteLlm({
      beta: {
        messages: {
          create: jest.fn(async () => {
            throw new Error("Could not resolve authentication method.");
          }),
        },
      },
    });

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.nota).toBeNull();
    expect(resultado.recomendacao).toBe("REVISAR");
    expect(resultado.ia.usada).toBe(false);
    expect(resultado.ia.motivo).toContain("ANTHROPIC_API_KEY");
    expect(resultado.parecer).toContain("Confira manualmente");
  });

  it("resposta da IA fora do formato não vira nota", async () => {
    simularFontes({ brasilApi: resposta(200, empresaDeCacambas()) });
    iaRespondendo({ ...respostaIa(), atividade: { classificacao: "TALVEZ" } });

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.nota).toBeNull();
    expect(resultado.ia.motivo).toBe("A IA respondeu fora do formato.");
  });

  it("ANALISE_CNPJ_IA=false desliga o LLM", async () => {
    process.env.ANALISE_CNPJ_IA = "false";
    simularFontes({ brasilApi: resposta(200, empresaDeCacambas()) });
    const create = iaRespondendo(respostaIa());

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(create).not.toHaveBeenCalled();
    expect(resultado.ia.motivo).toContain("desligada");
  });

  it("empresa recém-aberta perde os pontos de tempo e ganha um alerta", async () => {
    simularFontes({
      brasilApi: resposta(200, empresaDeCacambas({ data_inicio_atividade: "2026-09-01" })),
    });
    iaRespondendo(respostaIa());

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.checagens[1]).toMatchObject({ resultado: "Aberta há 2 meses", pontos: 0 });
    expect(resultado.nota).toBe(8.5);
    expect(resultado.pontos_de_atencao[0]).toContain("ainda não tem histórico");
  });
});
