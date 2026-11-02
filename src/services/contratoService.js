/*
 * Contrato de locação: carrega os dados do pedido, gera o PDF,
 * guarda o arquivo em disco e registra o caminho e o hash no banco.
 *
 * O aceite e a assinatura do consumidor já foram gravados junto com o
 * pedido (checkout). Aqui o PDF é só um documento derivado: se o arquivo
 * sumir, ele é gerado de novo a partir dos mesmos dados.
 */

const crypto = require("crypto");

const sql = require("../config/db");
const {
  salvarArquivo,
  lerArquivo,
} = require("./storageService");
const {
  gerarContratoPdf,
  VERSAO_TERMOS,
} = require("./contratoPdfService");

function codigoDoPedido(aluguelId) {
  return `COL-${String(aluguelId)
    .replaceAll("-", "")
    .substring(0, 10)
    .toUpperCase()}`;
}

async function lerSeExistir(chave) {
  if (!chave) {
    return null;
  }

  try {
    return await lerArquivo(chave);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

/** Contrato do pedido, ou null (pedidos anteriores ao recurso não têm). */
async function buscarContrato(aluguelId) {
  const rows = await sql`
    SELECT *
    FROM contratos_locacao
    WHERE aluguel_id = ${aluguelId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function carregarPedido(aluguelId) {
  const pedidos = await sql`
    SELECT
      a.id,
      a.data_inicio,
      a.dias_aluguel,
      a.preco_final,

      consumidor.nome_completo AS consumidor_nome,
      consumidor.documento AS consumidor_documento,
      consumidor.email AS consumidor_email,

      cacambeiro.nome_completo AS cacambeiro_nome,
      cacambeiro.documento AS cacambeiro_documento,
      dc.assinatura_path AS cacambeiro_assinatura_path,

      e.cep,
      e.logradouro,
      e.numero,
      e.bairro,
      e.cidade_estado

    FROM alugueis a

    INNER JOIN usuarios consumidor
      ON consumidor.id = a.consumidor_id

    INNER JOIN usuarios cacambeiro
      ON cacambeiro.id = a.cacambeiro_id

    LEFT JOIN detalhes_cacambeiro dc
      ON dc.usuario_id = a.cacambeiro_id

    INNER JOIN enderecos e
      ON e.id = a.endereco_id

    WHERE a.id = ${aluguelId}
  `;

  if (pedidos.length === 0) {
    return null;
  }

  const itens = await sql`
    SELECT
      c.nome,
      c.tamanho_m3,
      ia.quantidade,
      ia.dias_aluguel AS dias,
      ia.preco_diaria
    FROM itens_aluguel ia
    INNER JOIN cacambas c
      ON c.id = ia.cacamba_id
    WHERE ia.aluguel_id = ${aluguelId}
    ORDER BY c.nome
  `;

  return { pedido: pedidos[0], itens };
}

/**
 * Gera o PDF e registra o resultado.
 *
 * Idempotente: se o contrato já foi gerado e o arquivo existe, devolve o
 * PDF existente. Devolve null quando o pedido não tem contrato.
 *
 * @returns {Promise<Buffer|null>}
 */
async function emitirContrato(aluguelId) {
  const contrato = await buscarContrato(aluguelId);

  if (!contrato) {
    return null;
  }

  if (contrato.status === "GERADO") {
    const existente = await lerSeExistir(contrato.pdf_path);

    if (existente) {
      return existente;
    }
  }

  const carregado = await carregarPedido(aluguelId);

  if (!carregado) {
    return null;
  }

  const { pedido, itens } = carregado;

  const assinaturaConsumidor = await lerSeExistir(
    contrato.assinatura_consumidor_path,
  );

  if (!assinaturaConsumidor) {
    throw new Error(
      "Assinatura do consumidor não encontrada para o contrato.",
    );
  }

  /*
   * A assinatura da empresa pode mudar a qualquer momento. Na primeira
   * emissão guardamos uma cópia, e é ela que vale para este contrato.
   */
  let chaveEmpresa = contrato.assinatura_cacambeiro_path;
  let assinaturaEmpresa = await lerSeExistir(chaveEmpresa);

  if (!assinaturaEmpresa && !chaveEmpresa) {
    const atual = await lerSeExistir(
      pedido.cacambeiro_assinatura_path,
    );

    if (atual) {
      chaveEmpresa = await salvarArquivo(
        "private/assinaturas",
        "png",
        atual,
        `${contrato.id}-empresa`,
      );

      assinaturaEmpresa = atual;
    }
  }

  const subtotal = itens.reduce(
    (soma, item) =>
      soma +
      Number(item.quantidade) *
        Number(item.dias) *
        Number(item.preco_diaria),
    0,
  );

  const total = Number(pedido.preco_final);

  const pdf = await gerarContratoPdf({
    numero: codigoDoPedido(aluguelId),
    emitidoEm: contrato.aceite_em,
    locadora: {
      nome: pedido.cacambeiro_nome,
      documento: pedido.cacambeiro_documento,
      assinatura: assinaturaEmpresa,
    },
    locatario: {
      nome: pedido.consumidor_nome,
      documento: pedido.consumidor_documento,
      email: pedido.consumidor_email,
      assinatura: assinaturaConsumidor,
    },
    endereco: {
      cep: pedido.cep,
      logradouro: pedido.logradouro,
      numero: pedido.numero,
      bairro: pedido.bairro,
      cidade_estado: pedido.cidade_estado,
    },
    itens,
    dataInicio: pedido.data_inicio,
    dias: Number(pedido.dias_aluguel),
    // O que foi cobrado além das caçambas é a taxa de entrega.
    taxaEntrega: Math.max(0, Math.round((total - subtotal) * 100) / 100),
    total,
    aceite: {
      em: contrato.aceite_em,
      ip: contrato.aceite_ip,
    },
    versaoTermos: contrato.versao_termos || VERSAO_TERMOS,
  });

  const chavePdf = await salvarArquivo(
    "private/contratos",
    "pdf",
    pdf,
    aluguelId,
  );

  const hash = crypto.createHash("sha256").update(pdf).digest("hex");

  await sql`
    UPDATE contratos_locacao
    SET
      status = 'GERADO',
      pdf_path = ${chavePdf},
      pdf_sha256 = ${hash},
      pdf_gerado_em = NOW(),
      assinatura_cacambeiro_path = ${chaveEmpresa ?? null}
    WHERE id = ${contrato.id}
  `;

  return pdf;
}

module.exports = {
  VERSAO_TERMOS,
  codigoDoPedido,
  buscarContrato,
  emitirContrato,
};
