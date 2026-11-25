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
function simularFontes({ brasilApi, minhaReceita, groq }) {
  global.fetch = jest.fn(async (url) => {
    const texto = String(url);
    let responder = minhaReceita;
    if (texto.includes("brasilapi.com.br")) responder = brasilApi;
    if (texto.includes("api.groq.com")) responder = groq;

    if (responder instanceof Error) throw responder;
    return responder;
  });
}

/** Resposta da Groq (formato chat completions) com [corpo] como JSON. */
function respostaGroq(corpo) {
  return {
    model: "openai/gpt-oss-120b",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(corpo) },
      },
    ],
  };
}

/** Troca a chamada ao LLM por uma função falsa que devolve [corpo]. */
function iaRespondendo(corpo) {
  const create = jest.fn(async () => respostaGroq(corpo));

  analise.definirClienteLlm(create);
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
  delete process.env.GROQ_API_KEY;
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
    expect(resultado.ia).toEqual({ usada: true, modelo: "openai/gpt-oss-120b", motivo: null });
    expect(resultado.parecer).toContain("coleta de resíduos");
    expect(resultado.cnpj).toBe("**.***.333/0001-81");
    expect(resultado.checagens.map((c) => c.pontos)).toEqual([35, 15, 40, 10]);

    // Uma chamada, com saída em JSON Schema estrito e sem dados pessoais.
    const [params] = create.mock.calls[0];
    expect(params.model).toBe("openai/gpt-oss-120b");
    expect(params.temperature).toBe(0);
    expect(params.reasoning_effort).toBe("low");
    expect(params.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "analise_cnpj", strict: true, schema: analise.ESQUEMA_RESPOSTA },
    });
    expect(params.messages[0]).toEqual({ role: "system", content: analise.INSTRUCOES });

    const mensagem = params.messages[1].content;
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

  it("sem GROQ_API_KEY: nota em branco e pede conferência manual", async () => {
    delete process.env.GROQ_API_KEY;
    simularFontes({ brasilApi: resposta(200, empresaDeCacambas()) });

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.nota).toBeNull();
    expect(resultado.recomendacao).toBe("REVISAR");
    expect(resultado.ia.usada).toBe(false);
    expect(resultado.ia.motivo).toContain("GROQ_API_KEY");
    expect(resultado.parecer).toContain("Confira manualmente");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("chama a Groq por HTTP com a chave e lê a resposta", async () => {
    process.env.GROQ_API_KEY = "gsk_teste";
    simularFontes({
      brasilApi: resposta(200, empresaDeCacambas()),
      groq: resposta(200, respostaGroq(respostaIa())),
    });

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    const [url, opcoes] = global.fetch.mock.calls[1];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(opcoes.headers.Authorization).toBe("Bearer gsk_teste");
    expect(JSON.parse(opcoes.body).model).toBe("openai/gpt-oss-120b");
    expect(resultado.nota).toBe(10);
    expect(resultado.ia.usada).toBe(true);
  });

  it.each([
    [401, {}, "A chave da IA (GROQ_API_KEY) é inválida."],
    [429, {}, "Limite do plano gratuito da Groq atingido. Tente de novo em instantes."],
    [400, { error: { code: "json_validate_failed" } }, "A IA respondeu fora do formato."],
    [503, {}, "O serviço de IA respondeu com erro (503)."],
  ])("Groq responde %i: sem nota e com o motivo", async (status, corpo, motivo) => {
    process.env.GROQ_API_KEY = "gsk_teste";
    simularFontes({
      brasilApi: resposta(200, empresaDeCacambas()),
      groq: resposta(status, corpo),
    });

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.nota).toBeNull();
    expect(resultado.ia.motivo).toBe(motivo);
    expect(resultado.ia.motivo).not.toContain("gsk_teste");
  });

  it("resposta cortada por limite de tokens não vira nota", async () => {
    simularFontes({ brasilApi: resposta(200, empresaDeCacambas()) });
    analise.definirClienteLlm(async () => ({
      model: "openai/gpt-oss-120b",
      choices: [{ finish_reason: "length", message: { content: '{"ativ' } }],
    }));

    const resultado = await analise.analisarCnpj(entrada, { agora: AGORA });

    expect(resultado.nota).toBeNull();
    expect(resultado.ia.motivo).toBe("A resposta da IA veio cortada.");
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
