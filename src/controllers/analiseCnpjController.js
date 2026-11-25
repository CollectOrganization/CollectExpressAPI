const sql = require("../config/db");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const analiseCnpj = require("../services/analiseCnpjService");

/*
 * Análise do CNPJ de fornecedores (caçambeiros e parceiros de
 * reciclagem) para o administrador decidir a aprovação.
 * Veja src/services/analiseCnpjService.js.
 */

async function buscarUsuario(id) {
  const linhas = await sql`
    SELECT id, nome_completo, tipo_perfil, documento
    FROM usuarios
    WHERE id = ${id}
  `;

  return linhas[0] ?? null;
}

/** Responde o erro e devolve true quando o usuário não pode ser analisado. */
function recusarSeNaoElegivel(usuario, res) {
  if (!usuario) {
    sendError(res, 404, "Usuário não encontrado.", "USER_NOT_FOUND");
    return true;
  }

  if (!analiseCnpj.perfilTemAnalise(usuario.tipo_perfil)) {
    sendError(
      res,
      422,
      "A análise de CNPJ é só para fornecedores e parceiros de reciclagem.",
      "PERFIL_SEM_ANALISE_CNPJ",
    );
    return true;
  }

  if (String(usuario.documento ?? "").replace(/\D/g, "").length !== 14) {
    sendError(
      res,
      422,
      "O documento deste usuário não é um CNPJ.",
      "DOCUMENTO_NAO_E_CNPJ",
    );
    return true;
  }

  return false;
}

const analiseCnpjController = {
  /**
   * GET /api/usuarios/:id/analise-cnpj
   *
   * Última análise salva. 404 quando ainda não existe: o app então
   * pede uma nova pelo POST.
   */
  async obter(req, res) {
    try {
      const usuario = await buscarUsuario(req.params.id);
      if (recusarSeNaoElegivel(usuario, res)) return;

      const salva = await analiseCnpj.lerAnaliseSalva(usuario.id);

      if (!salva) {
        return sendError(
          res,
          404,
          "Este cadastro ainda não tem análise de CNPJ.",
          "ANALISE_NAO_ENCONTRADA",
        );
      }

      return sendSuccess(res, { ...salva, usuario_id: usuario.id, salva: true });
    } catch (error) {
      console.error("Erro ao ler análise de CNPJ:", error);
      return sendError(
        res,
        500,
        "Erro ao ler a análise de CNPJ.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * POST /api/usuarios/:id/analise-cnpj
   *
   * Consulta a Receita, roda as regras e o LLM, salva e devolve a
   * análise. Pode levar alguns segundos por causa do LLM.
   */
  async gerar(req, res) {
    try {
      const usuario = await buscarUsuario(req.params.id);
      if (recusarSeNaoElegivel(usuario, res)) return;

      const resultado = await analiseCnpj.gerarESalvarAnalise(usuario);

      return sendSuccess(res, { ...resultado, usuario_id: usuario.id });
    } catch (error) {
      if (error instanceof analiseCnpj.CnpjIndisponivelError) {
        return sendError(
          res,
          503,
          "A consulta de CNPJ está fora do ar. Tente de novo em instantes.",
          "CNPJ_CONSULTA_INDISPONIVEL",
        );
      }

      console.error("Erro ao gerar análise de CNPJ:", error);
      return sendError(
        res,
        500,
        "Erro ao gerar a análise de CNPJ.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = analiseCnpjController;
