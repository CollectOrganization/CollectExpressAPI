/*
 * Decodificação e validação de imagens recebidas em base64.
 *
 * Não confia no tipo informado pelo cliente: identifica o formato pelos
 * primeiros bytes e lê as dimensões do próprio cabeçalho do arquivo.
 */

const ApiError = require("./apiError");

const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URI_REGEX = /^data:[\w.+/-]+;base64,/i;

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const FORMATOS = {
  jpeg: { extensao: "jpg", mime: "image/jpeg" },
  png: { extensao: "png", mime: "image/png" },
  webp: { extensao: "webp", mime: "image/webp" },
};

function erro(campo, mensagem) {
  return new ApiError(400, mensagem, "INVALID_IMAGE", {
    [campo]: mensagem,
  });
}

/** Aceita data URI ou base64 puro e devolve o Buffer. */
function decodificarBase64(entrada, campo, maxBytes) {
  if (typeof entrada !== "string") {
    throw erro(campo, "Envie a imagem em base64.");
  }

  const texto = entrada
    .trim()
    .replace(DATA_URI_REGEX, "")
    .replace(/\s+/g, "");

  // Tamanho em base64 é ~4/3 do binário; rejeita antes de decodificar.
  if (texto.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    throw erro(
      campo,
      `A imagem excede o limite de ${Math.round(maxBytes / 1024)} KB.`,
    );
  }

  if (
    texto.length === 0 ||
    texto.length % 4 !== 0 ||
    !BASE64_REGEX.test(texto)
  ) {
    throw erro(campo, "A imagem não está em base64 válido.");
  }

  const buffer = Buffer.from(texto, "base64");

  if (buffer.length > maxBytes) {
    throw erro(
      campo,
      `A imagem excede o limite de ${Math.round(maxBytes / 1024)} KB.`,
    );
  }

  return buffer;
}

function lerDimensoesPng(buffer) {
  if (
    buffer.length < 24 ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return null;
  }

  return {
    largura: buffer.readUInt32BE(16),
    altura: buffer.readUInt32BE(20),
  };
}

function lerDimensoesJpeg(buffer) {
  let offset = 2;

  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null;
    }

    const marcador = buffer[offset + 1];

    // Bytes de preenchimento 0xFF.
    if (marcador === 0xff) {
      offset += 1;
      continue;
    }

    // Marcadores sem tamanho.
    if (
      marcador === 0x01 ||
      (marcador >= 0xd0 && marcador <= 0xd8)
    ) {
      offset += 2;
      continue;
    }

    // Fim da imagem ou início dos dados sem SOF.
    if (marcador === 0xd9 || marcador === 0xda) {
      return null;
    }

    const ehSof =
      marcador >= 0xc0 &&
      marcador <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marcador);

    if (ehSof) {
      if (offset + 9 > buffer.length) {
        return null;
      }

      return {
        altura: buffer.readUInt16BE(offset + 5),
        largura: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + buffer.readUInt16BE(offset + 2);
  }

  return null;
}

function lerDimensoesWebp(buffer) {
  if (buffer.length < 30) {
    return null;
  }

  const tipo = buffer.toString("ascii", 12, 16);

  if (tipo === "VP8 ") {
    return {
      largura: buffer.readUInt16LE(26) & 0x3fff,
      altura: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (tipo === "VP8L") {
    const bits = buffer.readUInt32LE(21);

    return {
      largura: (bits & 0x3fff) + 1,
      altura: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (tipo === "VP8X") {
    return {
      largura: buffer.readUIntLE(24, 3) + 1,
      altura: buffer.readUIntLE(27, 3) + 1,
    };
  }

  return null;
}

/** Identifica o formato pelos bytes iniciais. */
function detectarImagem(buffer) {
  if (
    buffer.length > 8 &&
    buffer.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    return { tipo: "png", dimensoes: lerDimensoesPng(buffer) };
  }

  if (
    buffer.length > 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return { tipo: "jpeg", dimensoes: lerDimensoesJpeg(buffer) };
  }

  if (
    buffer.length > 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { tipo: "webp", dimensoes: lerDimensoesWebp(buffer) };
  }

  return null;
}

/**
 * Decodifica e valida uma imagem.
 *
 * @param {string} entrada base64 ou data URI.
 * @param {object} opcoes
 * @param {string} opcoes.campo nome do campo, usado na mensagem de erro.
 * @param {number} opcoes.maxBytes tamanho máximo do arquivo.
 * @param {string[]} opcoes.tipos formatos aceitos: jpeg, png, webp.
 * @param {number} opcoes.larguraMin
 * @param {number} opcoes.larguraMax
 * @param {number} opcoes.alturaMin
 * @param {number} opcoes.alturaMax
 * @param {number} [opcoes.proporcao] largura/altura exigida.
 * @param {number} [opcoes.tolerancia] tolerância da proporção (padrão 0,05).
 *
 * @returns {{ buffer: Buffer, tipo: string, extensao: string,
 *             mime: string, largura: number, altura: number }}
 */
function decodificarImagem(entrada, opcoes) {
  const {
    campo,
    maxBytes,
    tipos,
    larguraMin = 1,
    larguraMax = 10000,
    alturaMin = 1,
    alturaMax = 10000,
    proporcao,
    tolerancia = 0.05,
  } = opcoes;

  const buffer = decodificarBase64(entrada, campo, maxBytes);
  const detectada = detectarImagem(buffer);

  if (!detectada || !tipos.includes(detectada.tipo)) {
    throw erro(
      campo,
      `Formato inválido. Use ${tipos
        .map((tipo) => tipo.toUpperCase())
        .join(", ")}.`,
    );
  }

  if (!detectada.dimensoes) {
    throw erro(campo, "Não foi possível ler as dimensões da imagem.");
  }

  const { largura, altura } = detectada.dimensoes;

  if (
    largura < larguraMin ||
    largura > larguraMax ||
    altura < alturaMin ||
    altura > alturaMax
  ) {
    throw erro(
      campo,
      `Dimensões inválidas (${largura}x${altura}). ` +
        `Use entre ${larguraMin}x${alturaMin} e ${larguraMax}x${alturaMax} px.`,
    );
  }

  if (proporcao) {
    const atual = largura / altura;

    if (Math.abs(atual - proporcao) / proporcao > tolerancia) {
      throw erro(
        campo,
        `Proporção inválida. Use largura ${proporcao} vezes a altura.`,
      );
    }
  }

  const formato = FORMATOS[detectada.tipo];

  return {
    buffer,
    tipo: detectada.tipo,
    extensao: formato.extensao,
    mime: formato.mime,
    largura,
    altura,
  };
}

/** Regras da foto da caçamba. */
function decodificarFotoCacamba(entrada) {
  return decodificarImagem(entrada, {
    campo: "foto_base64",
    maxBytes: 1.5 * 1024 * 1024,
    tipos: ["jpeg", "png", "webp"],
    larguraMin: 200,
    larguraMax: 2000,
    alturaMin: 150,
    alturaMax: 2000,
  });
}

/**
 * Assinatura padrão da empresa: PNG, até 300 KB, proporção 3:1,
 * entre 300x100 e 1200x400 px.
 */
function decodificarAssinaturaEmpresa(entrada) {
  return decodificarImagem(entrada, {
    campo: "assinatura_base64",
    maxBytes: 300 * 1024,
    tipos: ["png"],
    larguraMin: 300,
    larguraMax: 1200,
    alturaMin: 100,
    alturaMax: 400,
    proporcao: 3,
  });
}

/** Assinatura desenhada pelo consumidor: PNG, até 300 KB. */
function decodificarAssinaturaConsumidor(entrada) {
  return decodificarImagem(entrada, {
    campo: "assinatura_base64",
    maxBytes: 300 * 1024,
    tipos: ["png"],
    larguraMin: 100,
    larguraMax: 2000,
    alturaMin: 40,
    alturaMax: 1000,
  });
}

module.exports = {
  decodificarImagem,
  decodificarFotoCacamba,
  decodificarAssinaturaEmpresa,
  decodificarAssinaturaConsumidor,
};
