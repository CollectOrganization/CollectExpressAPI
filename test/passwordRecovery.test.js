jest.mock("../src/config/db", () => jest.fn());

jest.mock("../src/services/emailService", () => ({
  EmailError: class EmailError extends Error {},
  driverAtual: jest.fn(() => "console"),
  enviarEmail: jest.fn(() => Promise.resolve()),
}));

const sql = require("../src/config/db");
const { driverAtual, enviarEmail } = require("../src/services/emailService");
const { hashToken } = require("../src/services/tokenService");
const {
  CanalIndisponivelError,
  createPasswordRecovery,
  resetPassword,
} = require("../src/services/passwordRecoveryService");
const authController = require("../src/controllers/authController");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const maria = {
  id: "u1",
  nome_completo: "Maria Souza",
  email: "maria@reformas.com",
  status: "ATIVO",
};

function textoDaConsulta(chamada) {
  return chamada[0].join("?");
}

function valoresDaConsulta(chamada) {
  return chamada.slice(1);
}

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

let ambienteOriginal;

beforeEach(() => {
  sql.mockReset();
  enviarEmail.mockReset().mockResolvedValue(undefined);
  driverAtual.mockReset().mockReturnValue("console");
  ambienteOriginal = process.env.NODE_ENV;
});

afterEach(() => {
  process.env.NODE_ENV = ambienteOriginal;
});

describe("createPasswordRecovery", () => {
  it("conta existente: grava o hash do código e envia o código por e-mail", async () => {
    sql.mockResolvedValueOnce([maria]).mockResolvedValueOnce([]);

    const resultado = await createPasswordRecovery({
      identifier: "  Maria@Reformas.com ",
      channel: "EMAIL",
    });

    expect(resultado.requestId).toMatch(UUID);
    expect(resultado.destinationMasked).toBe("ma***@reformas.com");
    expect(resultado.developmentCode).toMatch(/^\d{6}$/);

    const [busca, gravacao] = sql.mock.calls;
    expect(valoresDaConsulta(busca)).toEqual(["maria@reformas.com"]);

    expect(textoDaConsulta(gravacao)).toContain(
      "INSERT INTO password_recovery_tokens",
    );
    const valores = valoresDaConsulta(gravacao);
    expect(valores).toContain(resultado.requestId);
    expect(valores).toContain(
      hashToken(`${resultado.requestId}:${resultado.developmentCode}`),
    );
    // O código em si nunca vai para o banco.
    expect(valores).not.toContain(resultado.developmentCode);

    expect(enviarEmail).toHaveBeenCalledTimes(1);
    const mensagem = enviarEmail.mock.calls[0][0];
    expect(mensagem.para).toBe("maria@reformas.com");
    expect(mensagem.texto).toContain(resultado.developmentCode);
    expect(mensagem.html).toContain(resultado.developmentCode);
  });

  it("com o Brevo configurado, o código não volta na resposta", async () => {
    driverAtual.mockReturnValue("brevo");
    sql.mockResolvedValueOnce([maria]).mockResolvedValueOnce([]);

    const resultado = await createPasswordRecovery({
      identifier: "maria@reformas.com",
      channel: "EMAIL",
    });

    expect(resultado.developmentCode).toBeNull();
    expect(enviarEmail).toHaveBeenCalledTimes(1);
  });

  it("em produção, o código nunca volta na resposta", async () => {
    process.env.NODE_ENV = "production";
    sql.mockResolvedValueOnce([maria]).mockResolvedValueOnce([]);

    const resultado = await createPasswordRecovery({
      identifier: "maria@reformas.com",
      channel: "EMAIL",
    });

    expect(resultado.developmentCode).toBeNull();
  });

  it("conta inexistente: mesmo formato de resposta, sem gravar nem enviar", async () => {
    sql.mockResolvedValueOnce([]);

    const resultado = await createPasswordRecovery({
      identifier: "ninguem@email.com",
      channel: "EMAIL",
    });

    expect(resultado.requestId).toMatch(UUID);
    expect(resultado.destinationMasked).toBe("ni***@email.com");
    expect(resultado.developmentCode).toBeNull();
    expect(sql).toHaveBeenCalledTimes(1);
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("conta suspensa: não gera código", async () => {
    sql.mockResolvedValueOnce([{ ...maria, status: "SUSPENSO" }]);

    const resultado = await createPasswordRecovery({
      identifier: "maria@reformas.com",
      channel: "EMAIL",
    });

    expect(resultado.developmentCode).toBeNull();
    expect(sql).toHaveBeenCalledTimes(1);
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it("SMS e WhatsApp ainda não têm envio", async () => {
    for (const channel of ["SMS", "WHATSAPP"]) {
      await expect(
        createPasswordRecovery({ identifier: "11999999999", channel }),
      ).rejects.toBeInstanceOf(CanalIndisponivelError);
    }

    expect(sql).not.toHaveBeenCalled();
  });

  it("falha no envio do e-mail não derruba o pedido", async () => {
    const erro = jest.spyOn(console, "error").mockImplementation(() => {});
    enviarEmail.mockRejectedValue(new Error("Brevo fora do ar"));
    sql.mockResolvedValueOnce([maria]).mockResolvedValueOnce([]);

    const resultado = await createPasswordRecovery({
      identifier: "maria@reformas.com",
      channel: "EMAIL",
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(resultado.requestId).toMatch(UUID);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("códigos novos têm sempre 6 dígitos", async () => {
    for (let i = 0; i < 20; i++) {
      sql.mockResolvedValueOnce([maria]).mockResolvedValueOnce([]);
      const { developmentCode } = await createPasswordRecovery({
        identifier: "maria@reformas.com",
        channel: "EMAIL",
      });
      expect(developmentCode).toMatch(/^\d{6}$/);
    }
  });
});

describe("resetPassword", () => {
  const requestId = "0b1e3c7a-9f0d-4f3e-8a55-2f6c1d9e4b21";

  it("troca a senha só com o código daquele pedido", async () => {
    sql.mockResolvedValueOnce([{ id: "u1" }]);

    const trocou = await resetPassword({
      requestId,
      code: "123456",
      newPassword: "NovaSenha1",
    });

    expect(trocou).toBe(true);
    const [consulta] = sql.mock.calls;
    expect(textoDaConsulta(consulta)).toContain("WHERE id =");
    expect(textoDaConsulta(consulta)).toContain("expires_at > NOW()");

    const valores = valoresDaConsulta(consulta);
    expect(valores).toContain(requestId);
    expect(valores).toContain(hashToken(`${requestId}:123456`));
    // A senha vai com hash, nunca em texto.
    expect(valores).not.toContain("NovaSenha1");
  });

  it("código errado, vencido ou já usado devolve false", async () => {
    sql.mockResolvedValueOnce([]);

    const trocou = await resetPassword({
      requestId,
      code: "000000",
      newPassword: "NovaSenha1",
    });

    expect(trocou).toBe(false);
  });
});

describe("authController: recuperação de senha", () => {
  it("forgot-password devolve request_id, destino mascarado e o código de teste", async () => {
    sql.mockResolvedValueOnce([maria]).mockResolvedValueOnce([]);
    const res = createResponse();

    await authController.forgotPassword(
      { body: { identifier: "maria@reformas.com", channel: "EMAIL" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const { data } = res.json.mock.calls[0][0];
    expect(data.request_id).toMatch(UUID);
    expect(data.destination_masked).toBe("ma***@reformas.com");
    expect(data.development_code).toMatch(/^\d{6}$/);
  });

  it("forgot-password por SMS avisa que o canal não está disponível", async () => {
    const res = createResponse();

    await authController.forgotPassword(
      { body: { identifier: "11999999999", channel: "SMS" } },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      success: false,
      code: "CHANNEL_NOT_AVAILABLE",
    });
  });

  it("reset-password com código inválido devolve INVALID_RECOVERY_CODE", async () => {
    sql.mockResolvedValueOnce([]);
    const res = createResponse();

    await authController.resetPassword(
      {
        body: {
          request_id: "0b1e3c7a-9f0d-4f3e-8a55-2f6c1d9e4b21",
          code: "000000",
          nova_senha: "NovaSenha1",
        },
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      code: "INVALID_RECOVERY_CODE",
    });
  });

  it("o fluxo completo: o código do e-mail troca a senha", async () => {
    sql.mockResolvedValueOnce([maria]).mockResolvedValueOnce([]);
    const pedido = createResponse();
    await authController.forgotPassword(
      { body: { identifier: "maria@reformas.com", channel: "EMAIL" } },
      pedido,
    );
    const { data } = pedido.json.mock.calls[0][0];

    // O banco devolve a linha só se id e hash baterem com o que foi gravado.
    const gravado = valoresDaConsulta(sql.mock.calls[1]);
    sql.mockImplementationOnce((...chamada) => {
      const valores = valoresDaConsulta(chamada);
      const confere =
        valores.includes(data.request_id) &&
        valores.some((valor) => gravado.includes(valor) && valor.length === 64);
      return Promise.resolve(confere ? [{ id: "u1" }] : []);
    });

    const troca = createResponse();
    await authController.resetPassword(
      {
        body: {
          request_id: data.request_id,
          code: data.development_code,
          nova_senha: "NovaSenha1",
        },
      },
      troca,
    );

    expect(troca.status).toHaveBeenCalledWith(200);
    expect(troca.json.mock.calls[0][0]).toMatchObject({
      success: true,
      message: "Senha atualizada com sucesso.",
    });
  });
});
