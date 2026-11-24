jest.mock("../src/config/db", () => jest.fn());

const fs = require("fs");
const os = require("os");
const path = require("path");

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "collect-arquivos-"));
  process.env.UPLOADS_DIR = raiz;
  process.env.ARQUIVOS_NO_BANCO = "true";
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
  delete process.env.ARQUIVOS_NO_BANCO;
});

const sql = require("../src/config/db");
const storage = require("../src/services/storageService");

/** Tabela `arquivos` simulada: chave -> conteúdo em base64. */
let tabela;

function simularBanco() {
  tabela = new Map();

  sql.mockReset();
  sql.mockImplementation((strings, ...valores) => {
    const texto = strings.join("?");

    if (texto.includes("INSERT INTO arquivos")) {
      tabela.set(valores[0], valores[1]);
      return Promise.resolve([]);
    }

    if (texto.includes("SELECT conteudo_base64")) {
      return Promise.resolve(
        tabela.has(valores[0]) ? [{ conteudo_base64: tabela.get(valores[0]) }] : [],
      );
    }

    if (texto.includes("SELECT 1 AS ok")) {
      return Promise.resolve(tabela.has(valores[0]) ? [{ ok: 1 }] : []);
    }

    if (texto.includes("SELECT chave FROM arquivos")) {
      return Promise.resolve([...tabela.keys()].map((chave) => ({ chave })));
    }

    if (texto.includes("DELETE FROM arquivos")) {
      tabela.delete(valores[0]);
      return Promise.resolve([]);
    }

    return Promise.resolve([]);
  });
}

/** Apaga o disco como o Render faz a cada deploy. */
function apagarDisco() {
  fs.rmSync(path.join(raiz, "private"), { recursive: true, force: true });
  fs.rmSync(path.join(raiz, "public"), { recursive: true, force: true });
}

beforeEach(simularBanco);

describe("arquivos guardados também no banco", () => {
  it("grava no banco e no disco", async () => {
    const chave = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      Buffer.from("assinatura"),
    );

    expect(fs.existsSync(path.join(raiz, chave))).toBe(true);
    expect(Buffer.from(tabela.get(chave), "base64").toString()).toBe(
      "assinatura",
    );
  });

  it("depois que o disco é apagado, lê do banco e devolve ao disco", async () => {
    const chave = await storage.salvarArquivo(
      "private/contratos",
      "pdf",
      Buffer.from("%PDF-conteudo"),
      "11111111-2222-3333-4444-555555555555",
    );

    apagarDisco();
    expect(fs.existsSync(path.join(raiz, chave))).toBe(false);

    const lido = await storage.lerArquivo(chave);

    expect(lido.toString()).toBe("%PDF-conteudo");
    // O disco voltou a ter o arquivo (cache).
    expect(fs.existsSync(path.join(raiz, chave))).toBe(true);
  });

  it("arquivo que não está em lugar nenhum lança ENOENT", async () => {
    await expect(
      storage.lerArquivo("private/assinaturas/nao-existe.png"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("arquivoExiste olha o disco e o banco e nunca lança erro", async () => {
    const chave = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      Buffer.from("x"),
    );

    expect(await storage.arquivoExiste(chave)).toBe(true);

    apagarDisco();
    expect(await storage.arquivoExiste(chave)).toBe(true);

    tabela.clear();
    expect(await storage.arquivoExiste(chave)).toBe(false);
    expect(await storage.arquivoExiste(null)).toBe(false);
    expect(await storage.arquivoExiste("../fora.png")).toBe(false);

    sql.mockRejectedValue(new Error("banco fora do ar"));
    expect(await storage.arquivoExiste("private/assinaturas/a.png")).toBe(false);
  });

  it("remover apaga do disco e do banco", async () => {
    const chave = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      Buffer.from("x"),
    );

    await storage.removerArquivo(chave);

    expect(fs.existsSync(path.join(raiz, chave))).toBe(false);
    expect(tabela.has(chave)).toBe(false);
  });

  it("se o banco falhar ao gravar, o arquivo não é dado como salvo", async () => {
    sql.mockRejectedValue(new Error("banco fora do ar"));

    await expect(
      storage.salvarArquivo("private/assinaturas", "png", Buffer.from("x")),
    ).rejects.toThrow("banco fora do ar");
  });

  it("sincroniza com o banco só o que está no disco e ainda não está lá", async () => {
    const jaNoBanco = await storage.salvarArquivo(
      "private/assinaturas",
      "png",
      Buffer.from("um"),
    );
    const soNoDisco = "private/assinaturas/so-no-disco.png";

    fs.mkdirSync(path.join(raiz, "private/assinaturas"), { recursive: true });
    fs.writeFileSync(path.join(raiz, soNoDisco), "dois");
    // Arquivo com nome fora do padrão é ignorado.
    fs.writeFileSync(path.join(raiz, "private/assinaturas/lixo.txt"), "x");

    const copiados = await storage.sincronizarDiscoComBanco();

    expect(copiados).toBe(1);
    expect(tabela.has(jaNoBanco)).toBe(true);
    expect(Buffer.from(tabela.get(soNoDisco), "base64").toString()).toBe("dois");
    expect(tabela.has("private/assinaturas/lixo.txt")).toBe(false);
  });
});

describe("servirUploadDoBanco", () => {
  function resposta() {
    const res = {
      headers: {},
      set: jest.fn((cabecalhos) => Object.assign(res.headers, cabecalhos)),
      status: jest.fn(() => res),
      send: jest.fn(() => res),
    };

    return res;
  }

  it("serve a foto que sumiu do disco", async () => {
    const chave = await storage.salvarArquivo(
      "public/cacambas",
      "jpg",
      Buffer.from("foto"),
      "abc-123",
    );

    apagarDisco();

    const res = resposta();
    const next = jest.fn();

    await storage.servirUploadDoBanco(
      { method: "GET", path: "/cacambas/abc-123.jpg" },
      res,
      next,
    );

    expect(chave).toBe("public/cacambas/abc-123.jpg");
    expect(next).not.toHaveBeenCalled();
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.send.mock.calls[0][0].toString()).toBe("foto");
  });

  it("foto que não existe segue para o 404 normal", async () => {
    const next = jest.fn();

    await storage.servirUploadDoBanco(
      { method: "GET", path: "/cacambas/nao-existe.jpg" },
      resposta(),
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("não serve extensão fora da lista nem tentativa de sair da pasta", async () => {
    const next = jest.fn();

    await storage.servirUploadDoBanco(
      { method: "GET", path: "/cacambas/a.html" },
      resposta(),
      next,
    );
    await storage.servirUploadDoBanco(
      { method: "GET", path: "/../private/assinaturas/a.png" },
      resposta(),
      next,
    );
    await storage.servirUploadDoBanco(
      { method: "POST", path: "/cacambas/a.jpg" },
      resposta(),
      next,
    );

    expect(next).toHaveBeenCalledTimes(3);
  });
});
