const crypto = require("crypto");

const ApiError = require("../utils/apiError");
const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");
const extensaoService = require("../services/extensaoService");
const { escaparHtml } = require("../services/emailTemplates");
const {
  formatarMoeda,
  formatarData,
} = require("../services/contratoPdfService");
const { codigoDoPedido } = require("../services/contratoService");
const {
  buscarPedidoDoUsuario,
} = require("../services/acessoPedido");

function tratarErro(res, error, contexto) {
  if (error instanceof ApiError) {
    return sendError(
      res,
      error.statusCode,
      error.message,
      error.code,
      error.fields,
    );
  }

  console.error(contexto, error);

  return sendError(
    res,
    500,
    "Erro interno ao processar a extensão.",
    "INTERNAL_SERVER_ERROR",
  );
}

/* ------------------------------------------------------------------ */
/* Página pública aberta pelo link do e-mail                           */
/* ------------------------------------------------------------------ */

function paginaHtml(titulo, corpo) {
  return (
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow">` +
    `<title>${escaparHtml(titulo)}</title>` +
    `<style>` +
    `body{margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222}` +
    `main{max-width:520px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden}` +
    `header{background:#4C7A1E;color:#fff;padding:16px 24px;font-weight:bold;font-size:18px}` +
    `section{padding:24px}h2{margin:0 0 12px;font-size:19px}p{line-height:1.5;font-size:14px}` +
    `dl{margin:16px 0}dt{color:#666;font-size:12px;margin-top:8px}dd{margin:0;font-weight:bold;font-size:14px}` +
    `form{display:inline-block;margin:8px 8px 0 0}` +
    `button{border:0;border-radius:6px;padding:12px 22px;font-size:14px;font-weight:bold;cursor:pointer;color:#fff}` +
    `.ok{background:#4C7A1E}.no{background:#9a2f2f}` +
    `</style></head><body><main><header>COLLECT XPRESS</header>` +
    `<section>${corpo}</section></main></body></html>`
  );
}

function enviarHtml(res, status, titulo, corpo) {
  res.set({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });

  return res.status(status).send(paginaHtml(titulo, corpo));
}

function mensagemHtml(res, status, titulo, texto) {
  return enviarHtml(
    res,
    status,
    titulo,
    `<h2>${escaparHtml(titulo)}</h2><p>${escaparHtml(texto)}</p>`,
  );
}

const extensoesController = {
  /**
   * POST /api/alugueis/:id/extensoes
   * Body: { dias_adicionais }
   */
  async solicitar(req, res) {
    try {
      const extensao = await extensaoService.solicitar({
        aluguelId: req.params.id,
        consumidorId: req.usuario_id,
        dias: req.body.dias_adicionais,
      });

      return sendSuccess(
        res,
        extensao,
        201,
        "Pedido de extensão enviado ao fornecedor.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao solicitar extensão:");
    }
  },

  /**
   * GET /api/alugueis/:id/extensoes
   * Extensões do pedido e o resumo (se pode estender agora).
   */
  async listar(req, res) {
    try {
      const pedido = await buscarPedidoDoUsuario(
        req.params.id,
        req.usuario_id,
        req.tipo_perfil,
      );

      if (!pedido) {
        return sendError(
          res,
          404,
          "Pedido não encontrado.",
          "ORDER_NOT_FOUND",
        );
      }

      const extensoes = await extensaoService.listarDoPedido(pedido.id);
      const resumo = await extensaoService.resumoDoPedido(pedido.id);

      return sendSuccess(res, { resumo, extensoes });
    } catch (error) {
      return tratarErro(res, error, "Erro ao listar extensões:");
    }
  },

  /**
   * PATCH /api/alugueis/:id/extensoes/:extId
   * Body: { acao: "ACEITAR" | "RECUSAR" }
   */
  async responder(req, res) {
    try {
      const extensao = await extensaoService.responder({
        aluguelId: req.params.id,
        extensaoId: req.params.extId,
        cacambeiroId: req.usuario_id,
        aceitar: req.body.acao === "ACEITAR",
      });

      return sendSuccess(
        res,
        extensao,
        200,
        req.body.acao === "ACEITAR"
          ? "Extensão aceita. O consumidor tem 24 horas para pagar."
          : "Extensão recusada.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao responder extensão:");
    }
  },

  /**
   * GET /api/extensoes/resposta/:token
   *
   * Mostra o pedido e os botões Aceitar/Recusar. Abrir o link não
   * decide nada: leitores de e-mail e antivírus acessam links sozinhos.
   */
  async paginaResposta(req, res) {
    try {
      await extensaoService.expirarVencidas();

      const dados = await extensaoService.buscarPorToken(
        req.params.token,
      );

      if (!dados) {
        return mensagemHtml(
          res,
          404,
          "Link inválido",
          "Este link não é válido ou já foi substituído.",
        );
      }

      if (dados.status !== "SOLICITADA") {
        return mensagemHtml(
          res,
          409,
          "Pedido já encerrado",
          "Este pedido de extensão já foi respondido ou expirou.",
        );
      }

      const token = encodeURIComponent(req.params.token);

      return enviarHtml(
        res,
        200,
        "Pedido de extensão",
        `<h2>Pedido de extensão de aluguel</h2>` +
          `<p>${escaparHtml(dados.consumidor_nome)} quer estender a locação.</p>` +
          `<dl>` +
          `<dt>Pedido</dt><dd>${escaparHtml(codigoDoPedido(dados.pedido_id))}</dd>` +
          `<dt>Início da locação</dt><dd>${escaparHtml(formatarData(dados.data_inicio))}</dd>` +
          `<dt>Dias adicionais</dt><dd>${escaparHtml(String(dados.dias_adicionais))}</dd>` +
          `<dt>Valor da extensão</dt><dd>${escaparHtml(formatarMoeda(dados.valor))}</dd>` +
          `</dl>` +
          `<p>Se aceitar, o consumidor terá 24 horas para pagar.</p>` +
          `<form method="post" action="/api/extensoes/resposta/${token}">` +
          `<input type="hidden" name="acao" value="ACEITAR">` +
          `<button class="ok" type="submit">Aceitar</button></form>` +
          `<form method="post" action="/api/extensoes/resposta/${token}">` +
          `<input type="hidden" name="acao" value="RECUSAR">` +
          `<button class="no" type="submit">Recusar</button></form>`,
      );
    } catch (error) {
      console.error("Erro ao exibir página de extensão:", error);

      return mensagemHtml(
        res,
        500,
        "Erro",
        "Não foi possível carregar este pedido. Tente novamente.",
      );
    }
  },

  /** POST /api/extensoes/resposta/:token (formulário da página). */
  async confirmarResposta(req, res) {
    const acao = req.body?.acao;

    if (acao !== "ACEITAR" && acao !== "RECUSAR") {
      return mensagemHtml(res, 400, "Ação inválida", "Escolha Aceitar ou Recusar.");
    }

    try {
      await extensaoService.responder({
        token: req.params.token,
        aceitar: acao === "ACEITAR",
      });

      return mensagemHtml(
        res,
        200,
        acao === "ACEITAR" ? "Extensão aceita" : "Extensão recusada",
        acao === "ACEITAR"
          ? "Pronto. O consumidor foi avisado e tem 24 horas para pagar."
          : "Pronto. O consumidor foi avisado.",
      );
    } catch (error) {
      if (error instanceof ApiError) {
        return mensagemHtml(
          res,
          error.statusCode,
          "Não foi possível responder",
          error.message,
        );
      }

      console.error("Erro ao confirmar resposta de extensão:", error);

      return mensagemHtml(
        res,
        500,
        "Erro",
        "Não foi possível registrar a resposta. Tente novamente.",
      );
    }
  },

  /**
   * POST /api/internal/jobs/extensoes
   *
   * Para um cron externo gratuito acordar a API e expirar prazos.
   * Protegido por JOBS_SECRET (header x-jobs-secret).
   */
  async rodarVarredura(req, res) {
    const esperado = process.env.JOBS_SECRET;
    const recebido = req.get("x-jobs-secret") || "";

    const autorizado =
      Boolean(esperado) &&
      recebido.length === esperado.length &&
      crypto.timingSafeEqual(
        Buffer.from(recebido),
        Buffer.from(esperado),
      );

    if (!autorizado) {
      return sendError(res, 403, "Acesso negado.", "FORBIDDEN");
    }

    try {
      const expiradas = await extensaoService.expirarVencidas();

      return sendSuccess(res, { expiradas });
    } catch (error) {
      return tratarErro(res, error, "Erro na varredura de extensões:");
    }
  },
};

module.exports = extensoesController;
