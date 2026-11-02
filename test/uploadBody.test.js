const express = require("express");

const {
  criarParserGlobal,
  uploadJson,
  ehRotaDeUpload,
} = require("../src/middlewares/uploadBody");
const {
  notFoundMiddleware,
  errorMiddleware,
} = require("../src/middlewares/errorMiddleware");

let servidor;
let base;

beforeAll(async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});

  const app = express();

  app.use(criarParserGlobal("100kb"));

  // Rota comum: usa o parser global (100 KB).
  app.post("/api/alguma-rota", (req, res) =>
    res.json({ tamanho: JSON.stringify(req.body).length }),
  );

  // Rota de upload: "autenticação" simulada antes do parser grande.
  app.post(
    "/api/cacambas",
    (req, res, next) =>
      req.headers.authorization ? next() : res.status(401).json({}),
    uploadJson,
    (req, res) => res.json({ tamanho: req.body.foto.length }),
  );

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });

  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterAll(async () => {
  console.error.mockRestore();
  await new Promise((resolve) => servidor.close(resolve));
});

function enviar(caminho, corpo, headers = {}) {
  return fetch(`${base}${caminho}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(corpo),
  });
}

describe("limites de corpo JSON", () => {
  it("rota comum rejeita corpo acima de 100 KB", async () => {
    const resposta = await enviar("/api/alguma-rota", {
      x: "a".repeat(200 * 1024),
    });

    expect(resposta.status).toBe(413);
    expect((await resposta.json()).code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rota de upload autenticada aceita corpo de 1 MB", async () => {
    const resposta = await enviar(
      "/api/cacambas",
      { foto: "a".repeat(1024 * 1024) },
      { Authorization: "Bearer x" },
    );

    expect(resposta.status).toBe(200);
    expect((await resposta.json()).tamanho).toBe(1024 * 1024);
  });

  it("rota de upload sem autenticação responde 401 sem ler o corpo grande", async () => {
    const resposta = await enviar("/api/cacambas", {
      foto: "a".repeat(1024 * 1024),
    });

    expect(resposta.status).toBe(401);
  });

  it("rota de upload rejeita corpo acima de 3 MB", async () => {
    const resposta = await enviar(
      "/api/cacambas",
      { foto: "a".repeat(4 * 1024 * 1024) },
      { Authorization: "Bearer x" },
    );

    expect(resposta.status).toBe(413);
  });
});

describe("ehRotaDeUpload", () => {
  const rota = (method, path) => ({ method, path });

  it("reconhece as rotas com upload", () => {
    expect(ehRotaDeUpload(rota("POST", "/api/cacambas"))).toBe(true);
    expect(ehRotaDeUpload(rota("PUT", "/api/cacambas/abc"))).toBe(true);
    expect(
      ehRotaDeUpload(rota("PUT", "/api/cacambeiros/me/assinatura")),
    ).toBe(true);
    expect(
      ehRotaDeUpload(rota("POST", "/api/alugueis/checkout")),
    ).toBe(true);
  });

  it("não reconhece rotas comuns nem outros métodos", () => {
    expect(ehRotaDeUpload(rota("GET", "/api/cacambas"))).toBe(false);
    expect(ehRotaDeUpload(rota("DELETE", "/api/cacambas/abc"))).toBe(
      false,
    );
    expect(ehRotaDeUpload(rota("POST", "/api/auth/login"))).toBe(false);
    expect(
      ehRotaDeUpload(rota("PUT", "/api/cacambas/abc/outra")),
    ).toBe(false);
  });
});
