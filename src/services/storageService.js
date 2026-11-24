/*
 * Armazenamento de arquivos.
 *
 * O disco do Render (plano gratuito) é apagado a cada reinício e a cada
 * deploy: foi assim que assinaturas, contratos e fotos sumiam e o contrato
 * passava a dar "Erro interno". Por isso cada arquivo é gravado também no
 * banco (tabela `arquivos`, em base64) e o disco virou só um cache: se o
 * arquivo não está no disco, `lerArquivo` busca no banco e o devolve ao
 * disco. Sem DATABASE_URL (ou nos testes) só o disco é usado.
 *
 * No disco, tudo fica dentro de UPLOADS_DIR (padrão: ./storage na raiz da API):
 *
 * - public/cacambas     fotos das caçambas, servidas em /uploads/...
 * - private/assinaturas assinaturas (empresa e consumidor)
 * - private/contratos   PDFs dos contratos
 * - private/coletas     PDFs dos documentos de coleta de recicláveis
 *
 * Nomes de arquivo são sempre gerados pelo servidor. O banco guarda
 * a "chave" relativa (ex.: private/contratos/<id>.pdf) ou, para
 * arquivos públicos, o caminho da URL (/uploads/cacambas/<id>.jpg).
 */

const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const sql = require("../config/db");

const PASTAS_PERMITIDAS = new Set([
  "public/cacambas",
  "private/assinaturas",
  "private/contratos",
  "private/coletas",
]);

const EXTENSOES_PERMITIDAS = new Set([
  "jpg",
  "png",
  "webp",
  "pdf",
]);

const NOME_VALIDO = /^[a-zA-Z0-9-]{1,80}$/;

const PREFIXO_PUBLICO = "/uploads/";

const TIPOS_DE_CONTEUDO = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

/**
 * O banco guarda os arquivos? Não nos testes (para não escrever no banco
 * real do .env), a menos que o teste peça com ARQUIVOS_NO_BANCO=true.
 */
function bancoGuardaArquivos() {
  if (process.env.ARQUIVOS_NO_BANCO === "true") {
    return true;
  }

  return Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== "test";
}

async function gravarNoBanco(chave, conteudo) {
  await sql`
    INSERT INTO arquivos (chave, conteudo_base64, tamanho)
    VALUES (${chave}, ${Buffer.from(conteudo).toString("base64")}, ${conteudo.length})
    ON CONFLICT (chave) DO UPDATE
    SET conteudo_base64 = EXCLUDED.conteudo_base64,
        tamanho = EXCLUDED.tamanho,
        atualizado_em = NOW()
  `;
}

async function lerDoBanco(chave) {
  const linhas = await sql`
    SELECT conteudo_base64 FROM arquivos WHERE chave = ${chave} LIMIT 1
  `;

  return linhas[0] ? Buffer.from(linhas[0].conteudo_base64, "base64") : null;
}

function erroDeArquivoAusente(chave) {
  const erro = new Error(`Arquivo não encontrado: ${chave}`);
  erro.code = "ENOENT";
  return erro;
}

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

  // Primeiro o banco (é ele que sobrevive ao deploy); se falhar, o
  // arquivo não é dado como salvo.
  if (bancoGuardaArquivos()) {
    await gravarNoBanco(chave, conteudo);
  }

  try {
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, conteudo);
  } catch (error) {
    // O disco é só cache: com o arquivo no banco, a gravação vale.
    if (!bancoGuardaArquivos()) {
      throw error;
    }

    console.warn("Não foi possível gravar o cache em disco:", error.message);
  }

  return chave;
}

/**
 * Lê o arquivo do disco e, se ele não estiver lá (disco apagado), do
 * banco, devolvendo-o ao disco. Se não existir em lugar nenhum, lança um
 * erro com `code === "ENOENT"`.
 */
async function lerArquivo(chave) {
  const caminho = caminhoSeguro(chave);

  try {
    return await fs.readFile(caminho);
  } catch (error) {
    if (error.code !== "ENOENT" || !bancoGuardaArquivos()) {
      throw error;
    }
  }

  const doBanco = await lerDoBanco(chave);

  if (!doBanco) {
    throw erroDeArquivoAusente(chave);
  }

  try {
    await fs.mkdir(path.dirname(caminho), { recursive: true });
    await fs.writeFile(caminho, doBanco);
  } catch (_) {
    // Sem cache em disco, mas o conteúdo foi lido.
  }

  return doBanco;
}

/** O arquivo existe (no disco ou no banco)? Nunca lança erro. */
async function arquivoExiste(chave) {
  if (!chave || typeof chave !== "string") {
    return false;
  }

  try {
    await fs.access(caminhoSeguro(chave));
    return true;
  } catch (_) {
    // Segue para o banco.
  }

  if (!bancoGuardaArquivos()) {
    return false;
  }

  try {
    const linhas = await sql`
      SELECT 1 AS ok FROM arquivos WHERE chave = ${chave} LIMIT 1
    `;
    return linhas.length > 0;
  } catch (_) {
    return false;
  }
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

  if (bancoGuardaArquivos()) {
    try {
      await sql`DELETE FROM arquivos WHERE chave = ${chave}`;
    } catch (error) {
      console.error("Falha ao remover arquivo do banco:", error.message);
    }
  }
}

/**
 * Middleware de `/uploads/*`: serve do banco a foto que sumiu do disco
 * (o `express.static` vem antes e cobre o caso normal).
 */
async function servirUploadDoBanco(req, res, next) {
  try {
    if (
      (req.method !== "GET" && req.method !== "HEAD") ||
      !bancoGuardaArquivos()
    ) {
      return next();
    }

    const relativo = decodeURIComponent(req.path).replace(/^\/+/, "");
    const chave = `public/${relativo}`;
    const extensao = path.extname(chave).slice(1).toLowerCase();

    if (!TIPOS_DE_CONTEUDO[extensao] || chave.includes("..")) {
      return next();
    }

    const conteudo = await lerArquivo(chave);

    res.set({
      "Content-Type": TIPOS_DE_CONTEUDO[extensao],
      "Cache-Control": "public, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    });

    return res.status(200).send(conteudo);
  } catch (error) {
    // Não achou (ou chave inválida): segue para o 404 normal.
    return next();
  }
}

/** Arquivos que estão no disco, como chaves relativas. */
async function listarArquivosDoDisco() {
  const encontrados = [];

  for (const pasta of PASTAS_PERMITIDAS) {
    let nomes;

    try {
      nomes = await fs.readdir(caminhoSeguro(pasta));
    } catch (_) {
      continue;
    }

    for (const nome of nomes) {
      if (/^[a-zA-Z0-9-]{1,80}\.(jpg|png|webp|pdf)$/.test(nome)) {
        encontrados.push(`${pasta}/${nome}`);
      }
    }
  }

  return encontrados;
}

/**
 * Na inicialização, copia para o banco o que existe no disco e ainda não
 * está lá. Cobre os arquivos criados antes desta mudança: sem isso, o
 * próximo deploy apagaria o que ainda restou. Devolve quantos copiou.
 */
async function sincronizarDiscoComBanco() {
  if (!bancoGuardaArquivos()) {
    return 0;
  }

  let copiados = 0;

  try {
    const doDisco = await listarArquivosDoDisco();

    if (doDisco.length === 0) {
      return 0;
    }

    const existentes = await sql`SELECT chave FROM arquivos`;
    const noBanco = new Set(existentes.map((linha) => linha.chave));

    for (const chave of doDisco) {
      if (noBanco.has(chave)) {
        continue;
      }

      try {
        await gravarNoBanco(chave, await fs.readFile(caminhoSeguro(chave)));
        copiados += 1;
      } catch (error) {
        console.warn(`Não foi possível copiar ${chave} para o banco:`, error.message);
      }
    }
  } catch (error) {
    console.warn("Sincronização dos arquivos com o banco falhou:", error.message);
  }

  return copiados;
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
  arquivoExiste,
  removerArquivo,
  servirUploadDoBanco,
  sincronizarDiscoComBanco,
  caminhoPublico,
  chaveDoCaminhoPublico,
  resolverFotoUrl,
};
