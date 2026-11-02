const sql = require("../config/db");

const ApiError = require("../utils/apiError");
const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");
const {
  decodificarAssinaturaEmpresa,
} = require("../utils/imageUpload");
const {
  salvarArquivo,
  lerArquivo,
  removerArquivo,
} = require("../services/storageService");

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
    "Erro interno ao processar a assinatura.",
    "INTERNAL_SERVER_ERROR",
  );
}

/**
 * Assinatura padrão da empresa (caçambeiro).
 *
 * Aparece no contrato de locação de todo pedido novo. Pode ser trocada
 * ou removida a qualquer momento: contratos já emitidos guardam a sua
 * própria cópia e não mudam.
 */
const assinaturasController = {
  /**
   * PUT /api/cacambeiros/me/assinatura
   *
   * PNG em base64, até 300 KB, proporção 3:1, de 300x100 a 1200x400 px.
   */
  async salvar(req, res) {
    let arquivoGravado = null;

    try {
      const cacambeiroId = req.usuario_id;

      const imagem = decodificarAssinaturaEmpresa(
        req.body.assinatura_base64,
      );

      arquivoGravado = await salvarArquivo(
        "private/assinaturas",
        imagem.extensao,
        imagem.buffer,
      );

      // O CTE lê o caminho antigo antes do UPDATE, para apagar o arquivo.
      const rows = await sql`
        WITH antigo AS (
          SELECT assinatura_path
          FROM detalhes_cacambeiro
          WHERE usuario_id = ${cacambeiroId}
        ),

        atualizado AS (
          UPDATE detalhes_cacambeiro
          SET
            assinatura_path = ${arquivoGravado},
            assinatura_atualizada_em = NOW()
          WHERE usuario_id = ${cacambeiroId}
          RETURNING assinatura_atualizada_em
        )

        SELECT
          atualizado.assinatura_atualizada_em,
          (SELECT assinatura_path FROM antigo) AS anterior
        FROM atualizado
      `;

      if (rows.length === 0) {
        await removerArquivo(arquivoGravado);

        return sendError(
          res,
          404,
          "Complete o cadastro de fornecedor antes de enviar a assinatura.",
          "SUPPLIER_PROFILE_NOT_FOUND",
        );
      }

      await removerArquivo(rows[0].anterior);

      return sendSuccess(
        res,
        {
          tem_assinatura: true,
          atualizada_em: rows[0].assinatura_atualizada_em,
        },
        200,
        "Assinatura atualizada com sucesso.",
      );
    } catch (error) {
      await removerArquivo(arquivoGravado);

      return tratarErro(res, error, "Erro ao salvar assinatura:");
    }
  },

  /**
   * GET /api/cacambeiros/me/assinatura
   *
   * Devolve a imagem (image/png) para o próprio fornecedor ver a prévia.
   */
  async obter(req, res) {
    try {
      const rows = await sql`
        SELECT assinatura_path
        FROM detalhes_cacambeiro
        WHERE usuario_id = ${req.usuario_id}
      `;

      const chave = rows[0]?.assinatura_path;

      if (!chave) {
        return sendError(
          res,
          404,
          "Nenhuma assinatura cadastrada.",
          "SIGNATURE_NOT_FOUND",
        );
      }

      let conteudo;

      try {
        conteudo = await lerArquivo(chave);
      } catch (error) {
        if (error.code === "ENOENT") {
          return sendError(
            res,
            404,
            "Nenhuma assinatura cadastrada.",
            "SIGNATURE_NOT_FOUND",
          );
        }

        throw error;
      }

      res.set({
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });

      return res.status(200).send(conteudo);
    } catch (error) {
      return tratarErro(res, error, "Erro ao ler assinatura:");
    }
  },

  /**
   * DELETE /api/cacambeiros/me/assinatura
   */
  async remover(req, res) {
    try {
      const rows = await sql`
        WITH antigo AS (
          SELECT assinatura_path
          FROM detalhes_cacambeiro
          WHERE usuario_id = ${req.usuario_id}
        ),

        atualizado AS (
          UPDATE detalhes_cacambeiro
          SET
            assinatura_path = NULL,
            assinatura_atualizada_em = NOW()
          WHERE usuario_id = ${req.usuario_id}
          RETURNING usuario_id
        )

        SELECT (SELECT assinatura_path FROM antigo) AS anterior
        FROM atualizado
      `;

      if (rows.length > 0) {
        await removerArquivo(rows[0].anterior);
      }

      return sendSuccess(
        res,
        { tem_assinatura: false },
        200,
        "Assinatura removida.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao remover assinatura:");
    }
  },
};

module.exports = assinaturasController;
