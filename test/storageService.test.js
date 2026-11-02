const fs = require("fs");
const os = require("os");
const path = require("path");

let raiz;

beforeAll(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), "collect-storage-"));
  process.env.UPLOADS_DIR = raiz;
});

afterAll(() => {
  fs.rmSync(raiz, { recursive: true, force: true });
  delete process.env.UPLOADS_DIR;
  delete process.env.PUBLIC_API_URL;
  delete process.env.RENDER_EXTERNAL_URL;
});

const storage = require("../src/services/storageService");

describe("storageService", () => {
  it("grava, lê e remove um arquivo", async () => {
    const chave = await storage.salvarArquivo(
      "public/cacambas",
      "jpg",
      Buffer.from("abc"),
    );

    expect(chave).toMatch(/^public\/cacambas\/[0-9a-f-]{36}\.jpg$/);
    expect(fs.existsSync(path.join(raiz, chave))).toBe(true);
    expect((await storage.lerArquivo(chave)).toString()).toBe("abc");

    await storage.removerArquivo(chave);
    expect(fs.existsSync(path.join(raiz, chave))).toBe(false);
  });

  it("aceita nome fixo seguro, como o id do aluguel", async () => {
    const chave = await storage.salvarArquivo(
      "private/contratos",
      "pdf",
      Buffer.from("%PDF"),
      "11111111-2222-3333-4444-555555555555",
    );

    expect(chave).toBe(
      "private/contratos/11111111-2222-3333-4444-555555555555.pdf",
    );
  });

  it("recusa pasta, extensão e nome fora da lista permitida", async () => {
    await expect(
      storage.salvarArquivo("../fora", "jpg", Buffer.from("x")),
    ).rejects.toThrow(/Pasta/);

    await expect(
      storage.salvarArquivo("public/cacambas", "exe", Buffer.from("x")),
    ).rejects.toThrow(/Extensão/);

    await expect(
      storage.salvarArquivo(
        "public/cacambas",
        "jpg",
        Buffer.from("x"),
        "../../etc/passwd",
      ),
    ).rejects.toThrow(/Nome/);
  });

  it("não lê nem remove arquivos fora da raiz", async () => {
    await expect(storage.lerArquivo("../fora.txt")).rejects.toThrow(
      /inválido/,
    );

    // removerArquivo é best-effort e nunca lança.
    await expect(
      storage.removerArquivo("../fora.txt"),
    ).resolves.toBeUndefined();
    await expect(storage.removerArquivo(null)).resolves.toBeUndefined();
    await expect(
      storage.removerArquivo("public/cacambas/nao-existe.jpg"),
    ).resolves.toBeUndefined();
  });

  it("converte chave pública em caminho de URL e de volta", () => {
    const caminho = storage.caminhoPublico("public/cacambas/a.jpg");

    expect(caminho).toBe("/uploads/cacambas/a.jpg");
    expect(storage.chaveDoCaminhoPublico(caminho)).toBe(
      "public/cacambas/a.jpg",
    );
    expect(
      storage.chaveDoCaminhoPublico("https://site.com/a.jpg"),
    ).toBeNull();
    expect(storage.chaveDoCaminhoPublico(null)).toBeNull();
  });

  it("resolverFotoUrl mantém URL externa e completa caminho local", () => {
    delete process.env.RENDER_EXTERNAL_URL;
    process.env.PUBLIC_API_URL = "https://api.exemplo.com/";

    expect(
      storage.resolverFotoUrl("/uploads/cacambas/a.jpg"),
    ).toBe("https://api.exemplo.com/uploads/cacambas/a.jpg");

    expect(storage.resolverFotoUrl("https://cdn.com/x.png")).toBe(
      "https://cdn.com/x.png",
    );
    expect(storage.resolverFotoUrl(null)).toBeNull();
    expect(storage.resolverFotoUrl(undefined)).toBeNull();
  });

  it("usa RENDER_EXTERNAL_URL quando PUBLIC_API_URL não existe", () => {
    delete process.env.PUBLIC_API_URL;
    process.env.RENDER_EXTERNAL_URL = "https://app.onrender.com";

    expect(storage.resolverFotoUrl("/uploads/cacambas/a.jpg")).toBe(
      "https://app.onrender.com/uploads/cacambas/a.jpg",
    );
  });
});
