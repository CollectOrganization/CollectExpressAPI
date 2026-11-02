/*
 * Gera cabeçalhos mínimos de imagens para testes. Não são imagens
 * renderizáveis, mas têm os bytes que o validador lê.
 */

function png(largura, altura, extra = 0) {
  const buffer = Buffer.alloc(33 + extra);

  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buffer,
  );
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(largura, 16);
  buffer.writeUInt32BE(altura, 20);

  return buffer;
}

function jpeg(largura, altura) {
  const buffer = Buffer.alloc(40);

  // SOI
  buffer[0] = 0xff;
  buffer[1] = 0xd8;

  // APP0: marcador em 2..3, tamanho 16 em 4..5, 14 bytes de dados.
  buffer[2] = 0xff;
  buffer[3] = 0xe0;
  buffer.writeUInt16BE(16, 4);

  // SOF0 em 20: marcador, tamanho, precisão, altura, largura.
  buffer[20] = 0xff;
  buffer[21] = 0xc0;
  buffer.writeUInt16BE(17, 22);
  buffer[24] = 8;
  buffer.writeUInt16BE(altura, 25);
  buffer.writeUInt16BE(largura, 27);

  return buffer;
}

function webpVp8x(largura, altura) {
  const buffer = Buffer.alloc(30);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  buffer.writeUIntLE(largura - 1, 24, 3);
  buffer.writeUIntLE(altura - 1, 27, 3);

  return buffer;
}

function dataUri(buffer, mime = "image/png") {
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

module.exports = { png, jpeg, webpVp8x, dataUri };
