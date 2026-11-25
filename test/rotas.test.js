jest.mock("../src/config/db", () => jest.fn());

const express = require("express");

const { ROTAS_COM_UPLOAD } = require("../src/middlewares/uploadBody");

/*
 * Carrega os arquivos de rotas de verdade (com o banco simulado) para
 * pegar import faltando, handler indefinido e rota duplicada, que só
 * apareceriam ao subir o servidor.
 */

function listarRotas(router, prefixo = "") {
  const rotas = [];

  for (const camada of router.stack) {
    if (camada.route) {
      for (const metodo of Object.keys(camada.route.methods)) {
        rotas.push({
          metodo: metodo.toUpperCase(),
          caminho: prefixo + camada.route.path,
          camadas: camada.route.stack.map((c) => c.handle),
        });
      }
    }
  }

  return rotas;
}

describe("rotas carregam com todos os handlers definidos", () => {
  const arquivos = [
    "alugueisRoutes",
    "cacambasRoutes",
    "cacambeirosRoutes",
    "extensoesRoutes",
    "usuariosRoutes",
  ];

  for (const arquivo of arquivos) {
    it(`${arquivo}`, () => {
      const router = require(`../src/routes/${arquivo}`);

      expect(typeof router).toBe("function");

      for (const rota of listarRotas(router)) {
        for (const handler of rota.camadas) {
          expect(typeof handler).toBe("function");
        }
      }
    });
  }
});

describe("rotas de upload usam o parser grande depois do login", () => {
  const { uploadJson } = require("../src/middlewares/uploadBody");
  const authMiddleware = require("../src/middlewares/authMiddleware");

  function encontrar(router, metodo, caminho) {
    return listarRotas(router).find(
      (r) => r.metodo === metodo && r.caminho === caminho,
    );
  }

  const casos = [
    ["cacambasRoutes", "POST", "/"],
    ["cacambasRoutes", "PUT", "/:id"],
    ["cacambeirosRoutes", "PUT", "/me/assinatura"],
    ["parceirosRoutes", "PUT", "/me/assinatura"],
    ["alugueisRoutes", "POST", "/checkout"],
    ["ofertasColetaRoutes", "POST", "/"],
  ];

  for (const [arquivo, metodo, caminho] of casos) {
    it(`${metodo} ${caminho} (${arquivo})`, () => {
      const router = require(`../src/routes/${arquivo}`);
      const rota = encontrar(router, metodo, caminho);

      expect(rota).toBeDefined();

      const indiceParser = rota.camadas.indexOf(uploadJson);
      expect(indiceParser).toBeGreaterThan(-1);

      // O login vem antes do parser: no próprio router (router.use) ou
      // dentro da cadeia da rota.
      const autenticaNaRota = rota.camadas.indexOf(authMiddleware);
      const autenticaNoRouter = router.stack.some(
        (c) => !c.route && c.handle === authMiddleware,
      );

      expect(
        (autenticaNaRota > -1 && autenticaNaRota < indiceParser) ||
          autenticaNoRouter,
      ).toBe(true);
    });
  }

  it("toda rota listada em ROTAS_COM_UPLOAD está coberta acima", () => {
    expect(ROTAS_COM_UPLOAD).toHaveLength(casos.length);
  });
});

/*
 * O contrário do bloco acima: uma rota que declara `uploadJson` mas não
 * está em ROTAS_COM_UPLOAD passa antes pelo parser global de 100 KB e
 * recusa (413) qualquer imagem maior que isso. Lê as montagens do
 * server.js para pegar também routers novos.
 */
describe("toda rota com uploadJson está em ROTAS_COM_UPLOAD", () => {
  const fs = require("fs");
  const path = require("path");
  const { uploadJson, ehRotaDeUpload } = require("../src/middlewares/uploadBody");

  const server = fs.readFileSync(
    path.join(__dirname, "../src/server.js"),
    "utf8",
  );

  const arquivoDaVariavel = Object.fromEntries(
    [...server.matchAll(/const (\w+) = require\("\.\/routes\/(\w+)"\)/g)].map(
      ([, variavel, arquivo]) => [variavel, arquivo],
    ),
  );

  const montagens = [
    ...server.matchAll(/app\.use\(\s*"(\/api\/[^"]+)"\s*,\s*(\w+)\s*\)/g),
  ]
    .map(([, prefixo, variavel]) => [prefixo, arquivoDaVariavel[variavel]])
    .filter(([, arquivo]) => arquivo);

  it("encontra as montagens no server.js", () => {
    expect(montagens.length).toBeGreaterThan(10);
  });

  for (const [prefixo, arquivo] of montagens) {
    const router = require(`../src/routes/${arquivo}`);
    const rotasDeUpload = listarRotas(router).filter((rota) =>
      rota.camadas.includes(uploadJson),
    );

    for (const rota of rotasDeUpload) {
      // ":id" vira um valor qualquer, como chegaria numa requisição.
      const caminho = prefixo + rota.caminho.replace(/:\w+/g, "x1");

      it(`${rota.metodo} ${caminho} (${arquivo})`, () => {
        expect(ehRotaDeUpload({ method: rota.metodo, path: caminho })).toBe(
          true,
        );
      });
    }
  }
});

describe("novas rotas de aluguéis", () => {
  const router = require("../src/routes/alugueisRoutes");
  const rotas = listarRotas(router).map((r) => `${r.metodo} ${r.caminho}`);

  it("expõe contrato, extensão e PIX de extensão", () => {
    expect(rotas).toEqual(
      expect.arrayContaining([
        "GET /:id/contrato",
        "GET /:id/extensoes",
        "POST /:id/extensoes",
        "PATCH /:id/extensoes/:extId",
        "POST /:id/extensoes/:extId/pix",
        "GET /:id/extensoes/:extId/pix",
        "POST /:id/extensoes/:extId/pix/simular",
      ]),
    );
  });

  it("a rota pública de resposta não passa por autenticação", () => {
    const publico = require("../src/routes/extensoesRoutes");
    const authMiddleware = require("../src/middlewares/authMiddleware");

    const todas = listarRotas(publico).flatMap((r) => r.camadas);

    expect(todas).not.toContain(authMiddleware);
    expect(publico.stack.some((c) => c.handle === authMiddleware)).toBe(false);
    expect(
      listarRotas(publico).map((r) => `${r.metodo} ${r.caminho}`),
    ).toEqual(["GET /resposta/:token", "POST /resposta/:token"]);
  });

  it("a app monta sem erro com o parser global", () => {
    const { criarParserGlobal } = require("../src/middlewares/uploadBody");
    const app = express();

    expect(() => app.use(criarParserGlobal("100kb"))).not.toThrow();
  });
});
