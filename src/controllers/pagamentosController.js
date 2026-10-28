const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

const abacatePay = require("../services/abacatePayService");

// Cada PIX vale por 1 hora; depois disso o app gera outro.
const PIX_VALIDADE_SEGUNDOS = 60 * 60;

// Status da AbacatePay que significam pagamento recebido.
const STATUS_PAGOS = ["PAID", "APPROVED"];

function estaPago(pix) {
  return STATUS_PAGOS.includes(pix.status);
}

function serializarPix(pix, statusPagamento) {
  return {
    id: pix.id,
    aluguel_id: pix.aluguel_id,
    status: pix.status,
    status_pagamento: statusPagamento,
    valor: pix.valor_centavos / 100,
    copia_cola: pix.copia_cola,
    qr_code_base64: pix.qr_code_base64,
    dev_mode: pix.dev_mode,
    expira_em: pix.expira_em,
    pago_em: pix.pago_em,
  };
}

/**
 * Pedido do consumidor autenticado. Pedido inexistente e pedido de
 * outro usuário dão a mesma resposta, como no detalhe do pedido.
 */
async function buscarPedidoDoConsumidor(aluguelId, consumidorId) {
  const rows = await sql`
    SELECT
      id,
      preco_final,
      status_pagamento
    FROM alugueis
    WHERE id = ${aluguelId}
      AND consumidor_id = ${consumidorId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function buscarUltimoPix(aluguelId) {
  const rows = await sql`
    SELECT *
    FROM pagamentos_pix
    WHERE aluguel_id = ${aluguelId}
    ORDER BY criado_em DESC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

/**
 * Consulta a cobrança na AbacatePay e grava o novo status.
 *
 * Quando a cobrança foi paga, o pedido passa para PAGO na mesma
 * instrução SQL. Cobranças que já saíram de PENDING não mudam mais
 * e não são consultadas de novo.
 */
async function sincronizar(pix) {
  if (pix.status !== "PENDING") {
    return pix;
  }

  const cobranca = await abacatePay.consultarCobranca(pix.cobranca_id);
  const status = cobranca?.status;

  if (!status || status === pix.status) {
    return pix;
  }

  const pago = STATUS_PAGOS.includes(status);

  const rows = await sql`
    WITH pix_atualizado AS (
      UPDATE pagamentos_pix
      SET
        status = ${status},
        pago_em = CASE WHEN ${pago}::boolean THEN NOW() ELSE pago_em END
      WHERE id = ${pix.id}
      RETURNING *
    ),

    pedido_pago AS (
      UPDATE alugueis
      SET status_pagamento = 'PAGO'
      WHERE ${pago}::boolean
        AND id = ${pix.aluguel_id}
        AND status_pagamento = 'PENDENTE'
      RETURNING id
    )

    SELECT *
    FROM pix_atualizado
  `;

  return rows[0] ?? pix;
}

function responderComPix(res, pix, pedido, statusCode = 200) {
  return sendSuccess(
    res,
    serializarPix(
      pix,
      estaPago(pix) ? "PAGO" : pedido.status_pagamento,
    ),
    statusCode,
  );
}

function tratarErro(res, error, contexto) {
  if (error instanceof abacatePay.PaymentProviderError) {
    return sendError(
      res,
      error.statusCode,
      error.message,
      error.code,
    );
  }

  console.error(contexto, error);

  return sendError(
    res,
    500,
    "Erro interno ao processar o pagamento.",
    "INTERNAL_SERVER_ERROR",
  );
}

function pedidoNaoEncontrado(res) {
  return sendError(
    res,
    404,
    "Pedido não encontrado.",
    "ORDER_NOT_FOUND",
  );
}

const pagamentosController = {
  /**
   * POST /api/alugueis/:id/pix
   *
   * Gera o PIX do pedido. Se já existe um PIX pendente que vale por
   * mais de 1 minuto, devolve o mesmo em vez de criar outro.
   */
  async gerarPix(req, res) {
    try {
      const pedido = await buscarPedidoDoConsumidor(
        req.params.id,
        req.usuario_id,
      );

      if (!pedido) {
        return pedidoNaoEncontrado(res);
      }

      if (pedido.status_pagamento === "PAGO") {
        return sendError(
          res,
          409,
          "Este pedido já está pago.",
          "ORDER_ALREADY_PAID",
        );
      }

      const pendentes = await sql`
        SELECT *
        FROM pagamentos_pix
        WHERE aluguel_id = ${pedido.id}
          AND status = 'PENDING'
          AND (
            expira_em IS NULL
            OR expira_em > NOW() + INTERVAL '1 minute'
          )
        ORDER BY criado_em DESC
        LIMIT 1
      `;

      if (pendentes.length > 0) {
        const pix = await sincronizar(pendentes[0]);

        if (pix.status === "PENDING" || estaPago(pix)) {
          return responderComPix(res, pix, pedido);
        }
      }

      const valorCentavos = Math.round(Number(pedido.preco_final) * 100);

      if (valorCentavos < 100) {
        return sendError(
          res,
          422,
          "O PIX exige um valor mínimo de R$ 1,00.",
          "PIX_AMOUNT_TOO_LOW",
        );
      }

      const cobranca = await abacatePay.criarCobrancaPix({
        valorCentavos,
        descricao: "Locação de caçamba - CollectExpress",
        expiraEmSegundos: PIX_VALIDADE_SEGUNDOS,
        metadata: { aluguel_id: pedido.id },
      });

      const rows = await sql`
        INSERT INTO pagamentos_pix (
          aluguel_id,
          cobranca_id,
          valor_centavos,
          status,
          copia_cola,
          qr_code_base64,
          dev_mode,
          expira_em
        )
        VALUES (
          ${pedido.id},
          ${cobranca.id},
          ${valorCentavos},
          ${cobranca.status ?? "PENDING"},
          ${cobranca.brCode},
          ${cobranca.brCodeBase64 ?? null},
          ${cobranca.devMode === true},
          ${cobranca.expiresAt ?? null}
        )
        RETURNING *
      `;

      return responderComPix(res, rows[0], pedido, 201);
    } catch (error) {
      return tratarErro(res, error, "Erro ao gerar o PIX:");
    }
  },

  /**
   * GET /api/alugueis/:id/pix
   *
   * Último PIX do pedido, já com o status atualizado na AbacatePay.
   * O app chama esta rota a cada poucos segundos enquanto espera.
   */
  async consultarPix(req, res) {
    try {
      const pedido = await buscarPedidoDoConsumidor(
        req.params.id,
        req.usuario_id,
      );

      if (!pedido) {
        return pedidoNaoEncontrado(res);
      }

      const ultimo = await buscarUltimoPix(pedido.id);

      if (!ultimo) {
        return sendError(
          res,
          404,
          "Nenhum PIX foi gerado para este pedido.",
          "PIX_NOT_FOUND",
        );
      }

      return responderComPix(res, await sincronizar(ultimo), pedido);
    } catch (error) {
      return tratarErro(res, error, "Erro ao consultar o PIX:");
    }
  },

  /**
   * POST /api/alugueis/:id/pix/simular
   *
   * Simula o pagamento do PIX pendente. Só é aceito quando a cobrança
   * foi criada com a chave do modo de teste (dev_mode).
   */
  async simularPix(req, res) {
    try {
      const pedido = await buscarPedidoDoConsumidor(
        req.params.id,
        req.usuario_id,
      );

      if (!pedido) {
        return pedidoNaoEncontrado(res);
      }

      const pix = await buscarUltimoPix(pedido.id);

      if (!pix || pix.status !== "PENDING") {
        return sendError(
          res,
          409,
          "Não há PIX pendente para este pedido.",
          "PIX_NOT_PENDING",
        );
      }

      if (!pix.dev_mode) {
        return sendError(
          res,
          403,
          "A simulação só funciona com a chave do modo de teste.",
          "PIX_SIMULATION_NOT_ALLOWED",
        );
      }

      await abacatePay.simularPagamento(pix.cobranca_id);

      return responderComPix(res, await sincronizar(pix), pedido);
    } catch (error) {
      return tratarErro(res, error, "Erro ao simular o pagamento:");
    }
  },
};

module.exports = pagamentosController;
