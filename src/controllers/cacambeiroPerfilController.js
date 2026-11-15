const sql = require("../config/db");

const ApiError = require("../utils/apiError");
const { sendSuccess } = require("../utils/apiResponse");

/** `08:00:00` -> `08:00`. */
function hhmm(valor) {
  return String(valor ?? "").slice(0, 5);
}

const cacambeiroPerfilController = {
  /**
   * PUT /api/cacambeiros/me
   *
   * O fornecedor atualiza o que aparece para os clientes: horário de
   * funcionamento e taxa de entrega. Nome e telefone seguem em
   * PUT /api/usuarios/perfil; a área de atendimento em /me/area.
   */
  async atualizar(req, res, next) {
    try {
      const usuarioId = req.usuario_id;
      const {
        horario_inicio: novoInicio,
        horario_fim: novoFim,
        taxa_entrega: novaTaxa,
      } = req.body;

      const atuais = await sql`
        SELECT horario_inicio, horario_fim, taxa_entrega
        FROM detalhes_cacambeiro
        WHERE usuario_id = ${usuarioId}
      `;

      if (atuais.length === 0) {
        throw new ApiError(
          404,
          "Dados do fornecedor não encontrados.",
          "SUPPLIER_DETAILS_NOT_FOUND",
        );
      }

      const inicio = novoInicio ?? hhmm(atuais[0].horario_inicio);
      const fim = novoFim ?? hhmm(atuais[0].horario_fim);

      if (fim <= inicio) {
        throw new ApiError(
          400,
          "O horário final deve ser posterior ao inicial.",
          "VALIDATION_ERROR",
          { horario_fim: "O horário final deve ser posterior ao inicial." },
        );
      }

      const atualizados = await sql`
        UPDATE detalhes_cacambeiro
        SET
          horario_inicio = ${inicio}::time,
          horario_fim = ${fim}::time,
          taxa_entrega = COALESCE(${novaTaxa ?? null}::numeric, taxa_entrega)
        WHERE usuario_id = ${usuarioId}
        RETURNING horario_inicio, horario_fim, raio_entrega_km, taxa_entrega
      `;

      return sendSuccess(
        res,
        atualizados[0],
        200,
        "Dados da loja atualizados com sucesso.",
      );
    } catch (error) {
      return next(error);
    }
  },
};

module.exports = cacambeiroPerfilController;
