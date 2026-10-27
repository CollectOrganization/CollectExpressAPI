const sql = require("../config/db");
const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

/**
 * Colunas retornadas em qualquer consulta de material.
 * Centralizar a lista evita divergência entre listar e detalhe.
 */
const MATERIAL_FIELDS = sql`
  id,
  nome,
  descricao,
  icone_url,
  tipos_aceitos,
  tipos_nao_aceitos,
  impacto_energia,
  impacto_co2,
  tempo_decomposicao,
  criado_em
`;

const materiaisController = {
  /**
   * GET /api/materiais
   * Lista pública de materiais recicláveis.
   * Não exige autenticação.
   */
  async listar(req, res) {
    try {
      const materiais = await sql`
        SELECT ${MATERIAL_FIELDS}
        FROM materiais_reciclaveis
        ORDER BY nome ASC
      `;

      return sendSuccess(
        res,
        materiais,
        200,
        "Materiais carregados com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao listar materiais:", error);
      return sendError(
        res,
        500,
        "Erro interno ao buscar materiais.",
        "MATERIALS_FETCH_ERROR",
      );
    }
  },

  /**
   * GET /api/materiais/:id
   * Detalhe de um material específico.
   * O UUID é validado pelo validationMiddleware na rota.
   */
  async detalhe(req, res) {
    try {
      const { id } = req.params;

      const materiais = await sql`
        SELECT ${MATERIAL_FIELDS}
        FROM materiais_reciclaveis
        WHERE id = ${id}
        LIMIT 1
      `;

      if (materiais.length === 0) {
        return sendError(
          res,
          404,
          "Material não encontrado.",
          "MATERIAL_NOT_FOUND",
        );
      }

      return sendSuccess(
        res,
        materiais[0],
        200,
        "Material carregado com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao buscar material:", error);
      return sendError(
        res,
        500,
        "Erro interno ao buscar o material.",
        "MATERIAL_FETCH_ERROR",
      );
    }
  },
};

module.exports = materiaisController;