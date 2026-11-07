const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");
const {
  lerArea,
} = require("../services/areaAtendimentoService");

/**
 * Área de atendimento (cerca virtual circular) do caçambeiro e as
 * pendências de cadastro que o app mostra ao entrar.
 */
const areaAtendimentoController = {
  /**
   * GET /api/cacambeiros/me/area
   *
   * Devolve a cerca atual. Caçambeiros antigos podem ter só o raio
   * (sem centro); nesse caso `definida` é false e o raio vem como
   * sugestão para o mapa.
   */
  async obter(req, res) {
    try {
      const rows = await sql`
        SELECT
          centro_lat,
          centro_lng,
          raio_entrega_km,
          area_atualizada_em
        FROM detalhes_cacambeiro
        WHERE usuario_id = ${req.usuario_id}
      `;

      if (rows.length === 0) {
        return sendError(
          res,
          404,
          "Complete o cadastro de fornecedor para definir a área.",
          "SUPPLIER_PROFILE_NOT_FOUND",
        );
      }

      const area = lerArea(rows[0]);

      return sendSuccess(res, {
        definida: area.definida,
        latitude: area.latitude,
        longitude: area.longitude,
        raio_km: area.raioKm,
        atualizada_em: rows[0].area_atualizada_em,
      });
    } catch (error) {
      console.error("Erro ao ler área de atendimento:", error);

      return sendError(
        res,
        500,
        "Erro interno ao buscar a área de atendimento.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * PUT /api/cacambeiros/me/area
   * Body: { latitude, longitude, raio_km }
   */
  async salvar(req, res) {
    try {
      const { latitude, longitude, raio_km: raioKm } = req.body;

      const rows = await sql`
        UPDATE detalhes_cacambeiro
        SET
          centro_lat = ${latitude},
          centro_lng = ${longitude},
          raio_entrega_km = ${raioKm},
          area_atualizada_em = NOW()
        WHERE usuario_id = ${req.usuario_id}
        RETURNING
          centro_lat,
          centro_lng,
          raio_entrega_km,
          area_atualizada_em
      `;

      if (rows.length === 0) {
        return sendError(
          res,
          404,
          "Complete o cadastro de fornecedor para definir a área.",
          "SUPPLIER_PROFILE_NOT_FOUND",
        );
      }

      const area = lerArea(rows[0]);

      return sendSuccess(
        res,
        {
          definida: area.definida,
          latitude: area.latitude,
          longitude: area.longitude,
          raio_km: area.raioKm,
          atualizada_em: rows[0].area_atualizada_em,
        },
        200,
        "Área de atendimento atualizada.",
      );
    } catch (error) {
      console.error("Erro ao salvar área de atendimento:", error);

      return sendError(
        res,
        500,
        "Erro interno ao salvar a área de atendimento.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * GET /api/cacambeiros/me/pendencias
   *
   * O app mostra um aviso ao caçambeiro enquanto faltar a área de
   * atendimento ou a assinatura da empresa (usada nos contratos).
   */
  async pendencias(req, res) {
    try {
      const rows = await sql`
        SELECT
          centro_lat,
          centro_lng,
          raio_entrega_km,
          assinatura_path
        FROM detalhes_cacambeiro
        WHERE usuario_id = ${req.usuario_id}
      `;

      // Sem perfil de fornecedor, as duas coisas estão pendentes.
      const linha = rows[0];
      const areaDefinida = linha ? lerArea(linha).definida : false;
      const assinaturaCadastrada = Boolean(linha?.assinatura_path);

      const pendencias = [];

      if (!areaDefinida) {
        pendencias.push("AREA_ATENDIMENTO");
      }

      if (!assinaturaCadastrada) {
        pendencias.push("ASSINATURA");
      }

      return sendSuccess(res, {
        area_definida: areaDefinida,
        assinatura_cadastrada: assinaturaCadastrada,
        pendencias,
      });
    } catch (error) {
      console.error("Erro ao ler pendências do fornecedor:", error);

      return sendError(
        res,
        500,
        "Erro interno ao verificar o cadastro.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = areaAtendimentoController;
