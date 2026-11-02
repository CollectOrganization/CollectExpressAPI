/*
 * Armazenamento de arquivos em disco.
 *
 * Tudo fica dentro de UPLOADS_DIR (padrão: ./storage na raiz da API):
 *
 * - public/cacambas     fotos das caçambas, servidas em /uploads/...
 * - private/assinaturas assinaturas (empresa e consumidor)
 * - private/contratos   PDFs dos contratos
 *
 * Nomes de arquivo são sempre gerados pelo servidor. O banco guarda
 * a "chave" relativa (ex.: private/contratos/<id>.pdf) ou, para
 * arquivos públicos, o caminho da URL (/uploads/cacambas/<id>.jpg).
 */

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const PASTAS_PERMITIDAS = new Set([
  "public/cacambas",
  "private/assinaturas",
  "private/contratos",
]);

const EXTENSOES_PERMITIDAS = new Set([
  "jpg",
  "png",
  "webp",
  "pdf",
]);

const NOME_VALIDO = /^[a-zA-Z0-9-]{1,80}$/;

const PREFIXO_PUBLICO = "/uploads/";

function raizDeArquivos() {
  return path.resolve(
    process.env.UPLOADS_DIR ||
      path.join(__dirname, "..", "..", "storage"),
  );
}

/** Pasta servida como estática em /uploads. */
function pastaPublica() {
  return path.join(raizDeArquivos(), "public");
}

/**
 * Converte uma chave em caminho absoluto, garantindo que ele
 * continue dentro da raiz de armazenamento.
 */
function caminhoSeguro(chave) {
  const raiz = raizDeArquivos();
  const completo = path.resolve(raiz, chave);

  if (!completo.startsWith(raiz + path.sep)) {
    throw new Error("Caminho de arquivo inválido.");
  }

  return completo;
}

/**
 * Grava o arquivo e devolve a chave relativa (com "/" como separador).
 *
 * @param {string} pasta     uma das pastas permitidas.
 * @param {string} extensao  jpg, png, webp ou pdf.
 * @param {Buffer} conteudo
 * @param {string} [nome]    sem extensão; padrão: UUID novo.
 */
async function salvarArquivo(
  pasta,
  extensao,
  conteudo,
  nome = crypto.randomUUID(),
) {
  if (!PASTAS_PERMITIDAS.has(pasta)) {
    throw new Error(`Pasta de armazenamento inválida: ${pasta}`);
  }

  if (!EXTENSOES_PERMITIDAS.has(extensao)) {
    throw new Error(`Extensão de arquivo inválida: ${extensao}`);
  }

  if (!NOME_VALIDO.test(nome)) {
    throw new Error("Nome de arquivo inválido.");
  }

  const chave = `${pasta}/${nome}.${extensao}`;
  const destino = caminhoSeguro(chave);

  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, conteudo);

  return chave;
}

async function lerArquivo(chave) {
  return fs.readFile(caminhoSeguro(chave));
}

/** Remoção best-effort: arquivo ausente ou chave inválida não geram erro. */
async function removerArquivo(chave) {
  if (!chave || typeof chave !== "string") {
    return;
  }

  try {
    await fs.unlink(caminhoSeguro(chave));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Falha ao remover arquivo:", error.message);
    }
  }
}

/** Chave pública -> caminho da URL. Ex.: public/cacambas/a.jpg -> /uploads/cacambas/a.jpg */
function caminhoPublico(chave) {
  return `${PREFIXO_PUBLICO}${chave.replace(/^public\//, "")}`;
}

/** Caminho da URL -> chave. Devolve null para URLs externas. */
function chaveDoCaminhoPublico(valor) {
  if (
    typeof valor !== "string" ||
    !valor.startsWith(PREFIXO_PUBLICO)
  ) {
    return null;
  }

  return `public/${valor.slice(PREFIXO_PUBLICO.length)}`;
}

/**
 * Transforma o valor salvo em foto_url na URL entregue ao cliente.
 * URLs externas passam sem mudança; caminhos /uploads/... recebem o
 * endereço público da API.
 */
function resolverFotoUrl(valor) {
  if (!chaveDoCaminhoPublico(valor)) {
    return valor ?? null;
  }

  const base = (
    process.env.PUBLIC_API_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
  ).replace(/\/+$/, "");

  return `${base}${valor}`;
}

module.exports = {
  raizDeArquivos,
  pastaPublica,
  salvarArquivo,
  lerArquivo,
  removerArquivo,
  caminhoPublico,
  chaveDoCaminhoPublico,
  resolverFotoUrl,
};
