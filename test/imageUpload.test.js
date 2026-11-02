const fc = require("fast-check");

const ApiError = require("../src/utils/apiError");
const {
  decodificarFotoCacamba,
  decodificarAssinaturaEmpresa,
  decodificarAssinaturaConsumidor,
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
  it("aceita PNG com proporção 3:1 dentro dos limites", () => {
    expect(
      decodificarAssinaturaEmpresa(dataUri(png(600, 200))),
    ).toMatchObject({ largura: 600, altura: 200 });

    expect(
      decodificarAssinaturaEmpresa(dataUri(png(1200, 400))),
    ).toMatchObject({ largura: 1200 });
  });

  it("rejeita proporção diferente de 3:1", () => {
    expect(() =>
      decodificarAssinaturaEmpresa(dataUri(png(600, 400))),
    ).toThrow(/Proporção inválida/);
  });

  it("rejeita fora de 300x100 a 1200x400", () => {
    expect(() =>
      decodificarAssinaturaEmpresa(dataUri(png(150, 50))),
    ).toThrow(/Dimensões inválidas/);

    expect(() =>
      decodificarAssinaturaEmpresa(dataUri(png(1800, 600))),
    ).toThrow(/Dimensões inválidas/);
  });

  it("aceita somente PNG", () => {
    expect(() =>
      decodificarAssinaturaEmpresa(
        dataUri(jpeg(600, 200), "image/jpeg"),
      ),
    ).toThrow(/Formato inválido/);
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
