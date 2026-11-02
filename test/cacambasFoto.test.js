jest.mock("../src/config/db", () => jest.fn());

const fs = require("fs");
const os = require("os");
const path = require("path");

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "collect-cacambas-"));
  process.env.UPLOADS_DIR = raiz;
  process.env.PUBLIC_API_URL = "https://api.teste.com";
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
  delete process.env.PUBLIC_API_URL;
});

const sql = require("../src/config/db");
const cacambasController = require("../src/controllers/cacambasController");
const { png, dataUri } = require("./helpers/imagens");

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

function arquivosDeCacambas() {
  const pasta = path.join(raiz, "public", "cacambas");

  return fs.existsSync(pasta) ? fs.readdirSync(pasta) : [];
}

const corpoBase = {
  nome: "Caçamba 5m",
  tipo_residuo: "Entulho",
  tamanho_m3: 5,
  preco_diaria: 120,
};

function linhaDaCacamba(fotoUrl) {
  return {
    id: "c1",
    cacambeiro_id: "u1",
    nome: "Caçamba 5m",
    tipo_residuo: "Entulho",
    tamanho_m3: "5.00",
    preco_diaria: "120.00",
    foto_url: fotoUrl,
    disponivel: true,
    criado_em: "2026-01-01",
  };
}

/** Texto do INSERT/UPDATE e valores passados ao sql tagged template. */
function valoresDaChamada(indice) {
  return sql.mock.calls[indice].slice(1);
}

describe("cacambasController: foto em base64", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sql.mockReset();
    fs.rmSync(path.join(raiz, "public"), {
      recursive: true,
      force: true,
    });
  });

  describe("criar", () => {
    it("grava o arquivo, salva o caminho e devolve a URL completa", async () => {
      sql
        .mockResolvedValueOnce([{ id: "cat" }]) // categoria
        .mockImplementationOnce(async (_partes, ...valores) => {
          const caminho = valores.find(
            (valor) =>
              typeof valor === "string" &&
              valor.startsWith("/uploads/cacambas/"),
          );

          return [linhaDaCacamba(caminho)];
        });

      const res = createResponse();

      await cacambasController.criar(
        {
          usuario_id: "u1",
          body: {
            ...corpoBase,
            foto_base64: dataUri(png(800, 600)),
          },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(201);

      const { data } = res.json.mock.calls[0][0];
      expect(data.foto_url).toMatch(
        /^https:\/\/api\.teste\.com\/uploads\/cacambas\/[0-9a-f-]{36}\.png$/,
      );

      const arquivos = arquivosDeCacambas();
      expect(arquivos).toHaveLength(1);
      expect(data.foto_url.endsWith(arquivos[0])).toBe(true);
    });

    it("rejeita imagem inválida sem gravar nada nem tocar no banco", async () => {
      sql.mockResolvedValueOnce([{ id: "cat" }]);

      const res = createResponse();

      await cacambasController.criar(
        {
          usuario_id: "u1",
          body: {
            ...corpoBase,
            foto_base64: dataUri(Buffer.from("texto qualquer 1234567890")),
          },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0]).toMatchObject({
        success: false,
        code: "INVALID_IMAGE",
        fields: { foto_base64: expect.any(String) },
      });
      expect(sql).toHaveBeenCalledTimes(1); // só a categoria
      expect(arquivosDeCacambas()).toHaveLength(0);
    });

    it("apaga o arquivo se o INSERT falhar", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});

      sql
        .mockResolvedValueOnce([{ id: "cat" }])
        .mockRejectedValueOnce(new Error("falha no banco"));

      const res = createResponse();

      await cacambasController.criar(
        {
          usuario_id: "u1",
          body: {
            ...corpoBase,
            foto_base64: dataUri(png(800, 600)),
          },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(500);
      expect(arquivosDeCacambas()).toHaveLength(0);

      console.error.mockRestore();
    });

    it("continua aceitando foto_url externa", async () => {
      sql
        .mockResolvedValueOnce([{ id: "cat" }])
        .mockResolvedValueOnce([linhaDaCacamba("https://cdn.com/x.jpg")]);

      const res = createResponse();

      await cacambasController.criar(
        {
          usuario_id: "u1",
          body: { ...corpoBase, foto_url: "https://cdn.com/x.jpg" },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(201);
      expect(valoresDaChamada(1)).toContain("https://cdn.com/x.jpg");
      expect(res.json.mock.calls[0][0].data.foto_url).toBe(
        "https://cdn.com/x.jpg",
      );
      expect(arquivosDeCacambas()).toHaveLength(0);
    });
  });

  describe("atualizar", () => {
    async function criarArquivoAntigo() {
      const { salvarArquivo } = require("../src/services/storageService");
      const chave = await salvarArquivo(
        "public/cacambas",
        "png",
        png(800, 600),
      );

      return {
        chave,
        caminho: `/uploads/${chave.replace("public/", "")}`,
      };
    }

    it("troca a foto e apaga o arquivo antigo depois do UPDATE", async () => {
      const antigo = await criarArquivoAntigo();

      sql
        .mockResolvedValueOnce([
          { id: "c1", cacambeiro_id: "u1", foto_url: antigo.caminho },
        ])
        .mockImplementationOnce(async (_partes, ...valores) => {
          const novo = valores.find(
            (valor) =>
              typeof valor === "string" &&
              valor.startsWith("/uploads/cacambas/"),
          );

          return [linhaDaCacamba(novo)];
        });

      const res = createResponse();

      await cacambasController.atualizar(
        {
          usuario_id: "u1",
          params: { id: "c1" },
          body: { foto_base64: dataUri(png(900, 700)) },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(200);

      const arquivos = arquivosDeCacambas();
      expect(arquivos).toHaveLength(1);
      expect(antigo.caminho.endsWith(arquivos[0])).toBe(false);
    });

    it("remover_foto limpa o banco e apaga o arquivo", async () => {
      const antigo = await criarArquivoAntigo();

      sql
        .mockResolvedValueOnce([
          { id: "c1", cacambeiro_id: "u1", foto_url: antigo.caminho },
        ])
        .mockResolvedValueOnce([linhaDaCacamba(null)]);

      const res = createResponse();

      await cacambasController.atualizar(
        {
          usuario_id: "u1",
          params: { id: "c1" },
          body: { remover_foto: true },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(arquivosDeCacambas()).toHaveLength(0);
      expect(res.json.mock.calls[0][0].data.foto_url).toBeNull();
    });

    it("sem campos de foto mantém o arquivo atual", async () => {
      const antigo = await criarArquivoAntigo();

      sql
        .mockResolvedValueOnce([
          { id: "c1", cacambeiro_id: "u1", foto_url: antigo.caminho },
        ])
        .mockResolvedValueOnce([linhaDaCacamba(antigo.caminho)]);

      const res = createResponse();

      await cacambasController.atualizar(
        {
          usuario_id: "u1",
          params: { id: "c1" },
          body: { preco_diaria: 99 },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(200);
      expect(arquivosDeCacambas()).toHaveLength(1);
    });

    it("não grava arquivo quando a caçamba é de outro fornecedor", async () => {
      sql.mockResolvedValueOnce([
        { id: "c1", cacambeiro_id: "outro", foto_url: null },
      ]);

      const res = createResponse();

      await cacambasController.atualizar(
        {
          usuario_id: "u1",
          params: { id: "c1" },
          body: { foto_base64: dataUri(png(800, 600)) },
        },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(403);
      expect(arquivosDeCacambas()).toHaveLength(0);
    });
  });
});
