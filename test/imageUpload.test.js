const fc = require("fast-check");

const ApiError = require("../src/utils/apiError");
const {
  MAX_BYTES_ASSINATURA_EMPRESA,
  decodificarFotoCacamba,
  decodificarAssinaturaEmpresa,
  decodificarAssinaturaConsumidor,
  formatoDaImagem,
} = require("../src/utils/imageUpload");
const { png, jpeg, webpVp8x, dataUri } = require("./helpers/imagens");

function codigoDoErro(funcao) {
  try {
    funcao();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error;
  }

  throw new Error("Era esperado um erro.");
}

describe("decodificarFotoCacamba", () => {
  it("aceita PNG, JPEG e WebP dentro dos limites", () => {
    expect(decodificarFotoCacamba(dataUri(png(800, 600)))).toMatchObject({
      tipo: "png",
      extensao: "png",
      largura: 800,
      altura: 600,
    });

    expect(
      decodificarFotoCacamba(dataUri(jpeg(1024, 768), "image/jpeg")),
    ).toMatchObject({ tipo: "jpeg", extensao: "jpg", largura: 1024 });

    expect(
      decodificarFotoCacamba(dataUri(webpVp8x(640, 480), "image/webp")),
    ).toMatchObject({ tipo: "webp", extensao: "webp", altura: 480 });
  });

  it("aceita base64 puro, sem prefixo de data URI", () => {
    const resultado = decodificarFotoCacamba(
      png(800, 600).toString("base64"),
    );

    expect(resultado.tipo).toBe("png");
  });

  it("ignora o tipo informado no data URI e confere os bytes", () => {
    // Texto dizendo ser imagem não vira imagem.
    const falso = Buffer.from("<script>alert(1)</script>".repeat(4));
    const erro = codigoDoErro(() =>
      decodificarFotoCacamba(dataUri(falso, "image/png")),
    );

    expect(erro.statusCode).toBe(400);
    expect(erro.code).toBe("INVALID_IMAGE");
    expect(erro.fields).toHaveProperty("foto_base64");
  });

  it("rejeita base64 inválido", () => {
    expect(() => decodificarFotoCacamba("não é base64!!")).toThrow(
      ApiError,
    );
    expect(() => decodificarFotoCacamba("")).toThrow(ApiError);
    expect(() => decodificarFotoCacamba(123)).toThrow(ApiError);
  });

  it("rejeita imagem maior que o limite", () => {
    const grande = png(800, 600, 2 * 1024 * 1024);

    expect(() => decodificarFotoCacamba(dataUri(grande))).toThrow(
      /excede o limite/,
    );
  });

  it("rejeita dimensões fora do intervalo", () => {
    expect(() =>
      decodificarFotoCacamba(dataUri(png(100, 100))),
    ).toThrow(/Dimensões inválidas/);

    expect(() =>
      decodificarFotoCacamba(dataUri(png(4000, 3000))),
    ).toThrow(/Dimensões inválidas/);
  });

  it("nunca lança outro tipo de erro para entradas arbitrárias", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (texto) => {
        try {
          decodificarFotoCacamba(texto);
        } catch (error) {
          return error instanceof ApiError;
        }

        return true;
      }),
      { numRuns: 300 },
    );
  });

  it("nunca lança outro tipo de erro para bytes arbitrários", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 120 }),
        (bytes) => {
          try {
            decodificarFotoCacamba(Buffer.from(bytes).toString("base64"));
          } catch (error) {
            return error instanceof ApiError;
          }

          return true;
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("decodificarAssinaturaEmpresa", () => {
  it("aceita foto de celular: JPEG 4:3", () => {
    expect(
      decodificarAssinaturaEmpresa(dataUri(jpeg(3000, 2250), "image/jpeg")),
    ).toMatchObject({ tipo: "jpeg", extensao: "jpg", largura: 3000 });
  });

  it("aceita PNG em qualquer proporção, inclusive o 3:1 de antes", () => {
    for (const [largura, altura] of [
      [600, 200],
      [1200, 400],
      [600, 400],
      [400, 600],
    ]) {
      expect(
        decodificarAssinaturaEmpresa(dataUri(png(largura, altura))),
      ).toMatchObject({ tipo: "png", largura, altura });
    }
  });

  it("rejeita fora de 150x50 a 4000x4000", () => {
    expect(() =>
      decodificarAssinaturaEmpresa(dataUri(png(100, 40))),
    ).toThrow(/Dimensões inválidas/);

    expect(() =>
      decodificarAssinaturaEmpresa(dataUri(png(5000, 3000))),
    ).toThrow(/Dimensões inválidas/);
  });

  it("aceita até 2 MB e rejeita acima disso", () => {
    expect(
      decodificarAssinaturaEmpresa(
        dataUri(png(600, 200, MAX_BYTES_ASSINATURA_EMPRESA - 1024)),
      ),
    ).toMatchObject({ tipo: "png" });

    expect(() =>
      decodificarAssinaturaEmpresa(
        dataUri(png(600, 200, MAX_BYTES_ASSINATURA_EMPRESA + 1024)),
      ),
    ).toThrow(/excede o limite/);
  });

  it("rejeita WebP, que o PDF do contrato não lê", () => {
    expect(() =>
      decodificarAssinaturaEmpresa(dataUri(webpVp8x(600, 200), "image/webp")),
    ).toThrow(/Formato inválido. Use PNG, JPEG/);
  });
});

describe("formatoDaImagem", () => {
  it("identifica PNG e JPEG já salvos pelos bytes", () => {
    expect(formatoDaImagem(png(600, 200))).toEqual({
      extensao: "png",
      mime: "image/png",
    });
    expect(formatoDaImagem(jpeg(600, 200))).toEqual({
      extensao: "jpg",
      mime: "image/jpeg",
    });
  });

  it("devolve null para o que não é imagem", () => {
    expect(formatoDaImagem(Buffer.from("não é imagem"))).toBeNull();
  });
});

describe("decodificarAssinaturaConsumidor", () => {
  it("aceita PNG de qualquer proporção dentro dos limites", () => {
    expect(
      decodificarAssinaturaConsumidor(dataUri(png(500, 300))),
    ).toMatchObject({ tipo: "png" });
  });

  it("rejeita PNG acima de 300 KB", () => {
    expect(() =>
      decodificarAssinaturaConsumidor(
        dataUri(png(500, 300, 400 * 1024)),
      ),
    ).toThrow(/excede o limite/);
  });
});
