/*
 * Extensão de aluguel.
 *
 * Fluxo:
 *   consumidor solicita (SOLICITADA)
 *     -> caçambeiro aceita (AGUARDANDO_PAGAMENTO, 24 h para pagar)
 *          -> PIX pago (PAGA): dias_extra/valor_extra do aluguel crescem
 *          -> sem pagamento em 24 h (EXPIRADA)
 *     -> caçambeiro recusa (RECUSADA)
 *     -> sem resposta em 48 h (EXPIRADA)
 *
 * O pagamento é tratado em pagamentosController, numa única instrução
 * SQL junto com o PIX. Este serviço cuida do resto.
 *
 * O plano gratuito do Render hiberna, então os prazos são conferidos
 * também na leitura (expirarVencidas) e não só pelo job periódico.
 */

const crypto = require("crypto");

const sql = require("../config/db");
const ApiError = require("../utils/apiError");
const { hashToken } = require("./tokenService");
const {
  EVENTOS,
  notificar,
} = require("./notificacaoService");

const SOLICITACAO_VALIDADE_HORAS = 48;
const PAGAMENTO_VALIDADE_HORAS = 24;
const MAX_DIAS_POR_EXTENSAO = 30;
// Prazo total do aluguel (original + extensões) não passa de 90 dias,
// o mesmo teto dos itens do carrinho.
const MAX_DIAS_TOTAIS = 90;

const STATUS_EM_ABERTO = ["SOLICITADA", "AGUARDANDO_PAGAMENTO"];

function serializar(extensao) {
  if (!extensao) {
    return null;
  }

  return {
    id: extensao.id,
    aluguel_id: extensao.aluguel_id,
    dias_adicionais: Number(extensao.dias_adicionais),
    valor: Number(extensao.valor),
    status: extensao.status,
    solicitada_em: extensao.solicitada_em,
    solicitacao_expira_em: extensao.solicitacao_expira_em,
    respondida_em: extensao.respondida_em,
    pagamento_expira_em: extensao.pagamento_expira_em,
    pago_em: extensao.pago_em,
  };
}

function urlPublicaDaApi() {
  return (
    process.env.PUBLIC_API_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ""
  ).replace(/\/+$/, "");
}

/** Link da página onde o caçambeiro responde pelo e-mail. */
function linkDeResposta(token) {
  const base = urlPublicaDaApi();

  return base
    ? `${base}/api/extensoes/resposta/${encodeURIComponent(token)}`
    : null;
}

/**
 * Marca como EXPIRADA o que passou do prazo e avisa os envolvidos.
 * Com `aluguelId`, só olha esse pedido. Devolve quantas expiraram.
 */
async function expirarVencidas(aluguelId = null) {
  const expiradas = await sql`
    WITH sem_resposta AS (
      UPDATE extensoes_aluguel
      SET status = 'EXPIRADA'
      WHERE status = 'SOLICITADA'
        AND solicitacao_expira_em <= NOW()
        AND (
          ${aluguelId}::uuid IS NULL
          OR aluguel_id = ${aluguelId}::uuid
        )
      RETURNING *
    ),

    sem_pagamento AS (
      UPDATE extensoes_aluguel
      SET status = 'EXPIRADA'
      WHERE status = 'AGUARDANDO_PAGAMENTO'
        AND pagamento_expira_em <= NOW()
        AND (
          ${aluguelId}::uuid IS NULL
          OR aluguel_id = ${aluguelId}::uuid
        )
      RETURNING *
    )

    SELECT 'SEM_RESPOSTA' AS motivo, * FROM sem_resposta
    UNION ALL
    SELECT 'SEM_PAGAMENTO' AS motivo, * FROM sem_pagamento
  `;

  for (const extensao of expiradas) {
    notificar(
      extensao.motivo === "SEM_RESPOSTA"
        ? EVENTOS.EXTENSAO_SEM_RESPOSTA
        : EVENTOS.EXTENSAO_PAGAMENTO_EXPIRADO,
      extensao.aluguel_id,
      { extensao: serializar(extensao) },
    );
  }

  return expiradas.length;
}

/** Dados do pedido necessários para decidir se pode estender. */
async function carregarPedido(aluguelId) {
  const rows = await sql`
    SELECT
      a.id,
      a.consumidor_id,
      a.cacambeiro_id,
      a.status_aluguel,
      a.status_pagamento,
      a.dias_aluguel,
      a.dias_extra,

      COALESCE(BOOL_AND(c.permite_extensao), FALSE)
        AS permite_extensao,

      COALESCE(
        SUM(ia.quantidade * ia.preco_diaria),
        0
      )::numeric AS diaria_total

    FROM alugueis a

    LEFT JOIN itens_aluguel ia
      ON ia.aluguel_id = a.id

    LEFT JOIN cacambas c
      ON c.id = ia.cacamba_id

    WHERE a.id = ${aluguelId}

    GROUP BY a.id
  `;

  return rows[0] ?? null;
}

/**
 * Regras que impedem uma nova extensão. Devolve null quando pode.
 * `dias` é opcional: sem ele, só confere as regras do pedido.
 */
function impedimento(pedido, dias) {
  if (!pedido.permite_extensao) {
    return {
      status: 422,
      code: "EXTENSION_NOT_ALLOWED",
      message: "Esta caçamba não permite extensão do aluguel.",
    };
  }

  if (pedido.status_aluguel !== "EM_USO") {
    return {
      status: 409,
      code: "EXTENSION_INVALID_STATUS",
      message:
        "A extensão só pode ser pedida enquanto a caçamba está em uso.",
    };
  }

  if (pedido.status_pagamento !== "PAGO") {
    return {
      status: 409,
      code: "ORDER_NOT_PAID",
      message: "Pague o pedido antes de pedir uma extensão.",
    };
  }

  const diasAtuais =
    Number(pedido.dias_aluguel) + Number(pedido.dias_extra);

  if (diasAtuais >= MAX_DIAS_TOTAIS) {
    return {
      status: 422,
      code: "EXTENSION_LIMIT_EXCEEDED",
      message: `O aluguel já chegou ao limite de ${MAX_DIAS_TOTAIS} dias.`,
    };
  }

  if (dias !== undefined && diasAtuais + dias > MAX_DIAS_TOTAIS) {
    return {
      status: 422,
      code: "EXTENSION_LIMIT_EXCEEDED",
      message: `O aluguel não pode passar de ${MAX_DIAS_TOTAIS} dias no total. Você pode estender por até ${MAX_DIAS_TOTAIS - diasAtuais} dia(s).`,
    };
  }

  return null;
}

function lancar(impedido) {
  throw new ApiError(impedido.status, impedido.message, impedido.code);
}

/**
 * Cria o pedido de extensão e avisa o caçambeiro por e-mail.
 *
 * @param {object} dados
 * @param {string} dados.aluguelId
 * @param {string} dados.consumidorId
 * @param {number} dados.dias 1 a 30.
 */
async function solicitar({ aluguelId, consumidorId, dias }) {
  await expirarVencidas(aluguelId);

  const pedido = await carregarPedido(aluguelId);

  // Pedido de outro consumidor responde como inexistente.
  if (!pedido || pedido.consumidor_id !== consumidorId) {
    throw new ApiError(404, "Pedido não encontrado.", "ORDER_NOT_FOUND");
  }

  const impedido = impedimento(pedido, dias);

  if (impedido) {
    lancar(impedido);
  }

  const valor =
    Math.round(Number(pedido.diaria_total) * dias * 100) / 100;

  const token = crypto.randomBytes(32).toString("hex");

  let rows;

  try {
    rows = await sql`
      INSERT INTO extensoes_aluguel (
        aluguel_id,
        dias_adicionais,
        valor,
        solicitacao_expira_em,
        token_hash
      )
      VALUES (
        ${aluguelId},
        ${dias},
        ${valor},
        NOW() + make_interval(hours => ${SOLICITACAO_VALIDADE_HORAS}::int),
        ${hashToken(token)}
      )
      RETURNING *
    `;
  } catch (error) {
    // Índice único: já existe uma extensão em aberto neste pedido.
    if (error.code === "23505") {
      throw new ApiError(
        409,
        "Já existe um pedido de extensão em andamento para este aluguel.",
        "EXTENSION_ALREADY_OPEN",
      );
    }

    throw error;
  }

  const extensao = serializar(rows[0]);

  notificar(EVENTOS.EXTENSAO_SOLICITADA, aluguelId, {
    extensao,
    linkResposta: linkDeResposta(token),
  });

  return extensao;
}

/**
 * Atualiza a extensão de forma atômica: só muda se ainda estiver
 * SOLICITADA, dentro do prazo e com o aluguel EM_USO.
 */
async function responder({
  aluguelId = null,
  extensaoId = null,
  token = null,
  cacambeiroId = null,
  aceitar,
}) {
  if (!extensaoId && !token) {
    throw new Error("Informe a extensão ou o token.");
  }

  // Resposta pela tela do app exige o dono; pelo e-mail vale o token.
  if (extensaoId && !cacambeiroId) {
    throw new Error("Informe o caçambeiro.");
  }

  const tokenHash = token ? hashToken(token) : null;
  const novoStatus = aceitar ? "AGUARDANDO_PAGAMENTO" : "RECUSADA";

  const rows = await sql`
    UPDATE extensoes_aluguel e
    SET
      status = ${novoStatus},
      respondida_em = NOW(),
      pagamento_expira_em = CASE
        WHEN ${aceitar}::boolean
          THEN NOW() + make_interval(
            hours => ${PAGAMENTO_VALIDADE_HORAS}::int
          )
        ELSE NULL
      END
    FROM alugueis a
    WHERE a.id = e.aluguel_id
      AND e.status = 'SOLICITADA'
      AND e.solicitacao_expira_em > NOW()
      AND a.status_aluguel = 'EM_USO'
      AND (
        ${aluguelId}::uuid IS NULL
        OR e.aluguel_id = ${aluguelId}::uuid
      )
      AND (
        ${extensaoId}::uuid IS NULL
        OR e.id = ${extensaoId}::uuid
      )
      AND (
        ${tokenHash}::text IS NULL
        OR e.token_hash = ${tokenHash}::text
      )
      AND (
        ${cacambeiroId}::uuid IS NULL
        OR a.cacambeiro_id = ${cacambeiroId}::uuid
      )
    RETURNING e.*
  `;

  if (rows.length > 0) {
    const extensao = serializar(rows[0]);

    notificar(
      aceitar ? EVENTOS.EXTENSAO_ACEITA : EVENTOS.EXTENSAO_RECUSADA,
      extensao.aluguel_id,
      { extensao },
    );

    return extensao;
  }

  // Nada mudou: descobre o motivo para responder com precisão.
  const existentes = await sql`
    SELECT
      e.status,
      e.solicitacao_expira_em,
      a.status_aluguel
    FROM extensoes_aluguel e
    INNER JOIN alugueis a
      ON a.id = e.aluguel_id
    WHERE (
        ${aluguelId}::uuid IS NULL
        OR e.aluguel_id = ${aluguelId}::uuid
      )
      AND (
        ${extensaoId}::uuid IS NULL
        OR e.id = ${extensaoId}::uuid
      )
      AND (
        ${tokenHash}::text IS NULL
        OR e.token_hash = ${tokenHash}::text
      )
      AND (
        ${cacambeiroId}::uuid IS NULL
        OR a.cacambeiro_id = ${cacambeiroId}::uuid
      )
    LIMIT 1
  `;

  const atual = existentes[0];

  if (!atual) {
    throw new ApiError(
      404,
      "Pedido de extensão não encontrado.",
      "EXTENSION_NOT_FOUND",
    );
  }

  if (atual.status !== "SOLICITADA") {
    throw new ApiError(
      409,
      "Este pedido de extensão já foi respondido ou encerrado.",
      "EXTENSION_ALREADY_ANSWERED",
    );
  }

  if (new Date(atual.solicitacao_expira_em) <= new Date()) {
    throw new ApiError(
      410,
      "O prazo para responder a este pedido terminou.",
      "EXTENSION_EXPIRED",
    );
  }

  throw new ApiError(
    409,
    "O aluguel não está mais em uso.",
    "EXTENSION_INVALID_STATUS",
  );
}

/** Extensão pelo token do e-mail, com o resumo do pedido, ou null. */
async function buscarPorToken(token) {
  if (typeof token !== "string" || token.length < 32) {
    return null;
  }

  const rows = await sql`
    SELECT
      e.*,
      a.id AS pedido_id,
      a.data_inicio,
      a.dias_aluguel,
      consumidor.nome_completo AS consumidor_nome
    FROM extensoes_aluguel e
    INNER JOIN alugueis a
      ON a.id = e.aluguel_id
    INNER JOIN usuarios consumidor
      ON consumidor.id = a.consumidor_id
    WHERE e.token_hash = ${hashToken(token)}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

/** Extensões do pedido, da mais recente para a mais antiga. */
async function listarDoPedido(aluguelId) {
  await expirarVencidas(aluguelId);

  const rows = await sql`
    SELECT *
    FROM extensoes_aluguel
    WHERE aluguel_id = ${aluguelId}
    ORDER BY criado_em DESC
  `;

  return rows.map(serializar);
}

/**
 * Resumo usado no detalhe do pedido: se a caçamba permite extensão,
 * se dá para pedir agora e qual a extensão mais recente.
 */
async function resumoDoPedido(aluguelId) {
  const extensoes = await listarDoPedido(aluguelId);
  const pedido = await carregarPedido(aluguelId);

  if (!pedido) {
    return null;
  }

  const emAberto = extensoes.find((e) =>
    STATUS_EM_ABERTO.includes(e.status),
  );

  const bloqueio = impedimento(pedido);

  return {
    permite_extensao: Boolean(pedido.permite_extensao),
    pode_estender: !bloqueio && !emAberto,
    motivo_bloqueio: bloqueio
      ? bloqueio.code
      : emAberto
        ? "EXTENSION_ALREADY_OPEN"
        : null,
    dias_extra: Number(pedido.dias_extra),
    max_dias_por_extensao: Math.min(
      MAX_DIAS_POR_EXTENSAO,
      Math.max(
        0,
        MAX_DIAS_TOTAIS -
          Number(pedido.dias_aluguel) -
          Number(pedido.dias_extra),
      ),
    ),
    diaria_total: Number(pedido.diaria_total),
    atual: extensoes[0] ?? null,
  };
}

/**
 * Cancela pedidos que ainda esperam resposta (sem dinheiro envolvido).
 * Chamado quando o aluguel sai de EM_USO.
 */
async function cancelarSolicitacoesAbertas(aluguelId) {
  await sql`
    UPDATE extensoes_aluguel
    SET status = 'CANCELADA'
    WHERE aluguel_id = ${aluguelId}
      AND status = 'SOLICITADA'
  `;
}

/** Job periódico: expira vencidas sem derrubar o processo. */
function iniciarVarreduraDeExtensoes(intervaloMs = 5 * 60 * 1000) {
  const executar = () =>
    expirarVencidas().catch((error) => {
      console.error("Erro na varredura de extensões:", error.message);
    });

  executar();

  const intervalo = setInterval(executar, intervaloMs);

  // Não impede o Node de finalizar.
  intervalo.unref();

  return intervalo;
}

module.exports = {
  SOLICITACAO_VALIDADE_HORAS,
  PAGAMENTO_VALIDADE_HORAS,
  MAX_DIAS_POR_EXTENSAO,
  MAX_DIAS_TOTAIS,
  serializar,
  impedimento,
  expirarVencidas,
  solicitar,
  responder,
  buscarPorToken,
  listarDoPedido,
  resumoDoPedido,
  cancelarSolicitacoesAbertas,
  iniciarVarreduraDeExtensoes,
};
