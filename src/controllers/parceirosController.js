const sql = require("../config/db");

const ApiError = require("../utils/apiError");
const { sendSuccess, sendError } = require("../utils/apiResponse");
const {
  decodificarAssinaturaEmpresa,
  formatoDaImagem,
} = require("../utils/imageUpload");
const {
  salvarArquivo,
  lerArquivo,
  removerArquivo,
} = require("../services/storageService");
const { lerArea } = require("../services/areaAtendimentoService");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    "Erro interno ao processar o perfil do parceiro.",
    "INTERNAL_SERVER_ERROR",
  );
}

function areaDaLinha(linha) {
  return lerArea({
    centro_lat: linha.centro_lat,
    centro_lng: linha.centro_lng,
    raio_entrega_km: linha.raio_atuacao_km,
  });
}

function perfilNaoEncontrado() {
  return new ApiError(
    404,
    "Complete o cadastro de parceiro para continuar.",
    "PARTNER_PROFILE_NOT_FOUND",
  );
}

async function materiaisDoParceiro(parceiroId) {
  return sql`
    SELECT m.id, m.nome
    FROM parceiro_materiais pm
    INNER JOIN materiais_reciclaveis m ON m.id = pm.material_id
    WHERE pm.parceiro_id = ${parceiroId}
    ORDER BY m.nome
  `;
}

/**
 * Perfil do parceiro de reciclagem (PARCEIRO).
 *
 * O cadastro nasce PENDENTE e só entra depois de aprovado por um admin.
 */
const parceirosController = {
  /** GET /api/parceiros/me */
  async obter(req, res) {
    try {
      const linhas = await sql`
        SELECT
          u.nome_completo, u.email, u.status,
          d.responsavel_nome, d.endereco_coleta, d.capacidade_diaria_kg,
          d.disponivel, d.assinatura_path, d.centro_lat, d.centro_lng,
          d.raio_atuacao_km
        FROM usuarios u
        INNER JOIN detalhes_parceiro d ON d.usuario_id = u.id
        WHERE u.id = ${req.usuario_id}
      `;

      const linha = linhas[0];

      if (!linha) {
        throw perfilNaoEncontrado();
      }

      const area = areaDaLinha(linha);

      return sendSuccess(res, {
        nome: linha.nome_completo,
        email: linha.email,
        status: linha.status,
        responsavel_nome: linha.responsavel_nome,
        endereco_coleta: linha.endereco_coleta,
        capacidade_diaria_kg:
          linha.capacidade_diaria_kg == null
            ? null
            : Number(linha.capacidade_diaria_kg),
        disponivel: linha.disponivel,
        tem_assinatura: Boolean(linha.assinatura_path),
        materiais: await materiaisDoParceiro(req.usuario_id),
        area: {
          definida: area.definida,
          latitude: area.latitude,
          longitude: area.longitude,
          raio_km: area.raioKm,
        },
      });
    } catch (error) {
      return tratarErro(res, error, "Erro ao ler perfil do parceiro:");
    }
  },

  /**
   * PUT /api/parceiros/me
   * Body (tudo opcional): responsavel_nome, endereco_coleta,
   * capacidade_diaria_kg, disponivel, materiais_ids.
   */
  async atualizar(req, res) {
    try {
      const {
        responsavel_nome: responsavel,
        endereco_coleta: endereco,
        capacidade_diaria_kg: capacidade,
        disponivel,
        materiais_ids: materiais,
      } = req.body;

      const fields = {};

      if (
        responsavel !== undefined &&
        (typeof responsavel !== "string" ||
          responsavel.trim().length < 3 ||
          responsavel.trim().length > 150)
      ) {
        fields.responsavel_nome = "Informe o nome do responsável.";
      }

      if (
        endereco !== undefined &&
        (typeof endereco !== "string" ||
          endereco.trim().length < 5 ||
          endereco.trim().length > 255)
      ) {
        fields.endereco_coleta = "Informe o endereço da empresa.";
      }

      if (
        capacidade !== undefined &&
        capacidade !== null &&
        (typeof capacidade !== "number" ||
          !Number.isFinite(capacidade) ||
          capacidade <= 0 ||
          capacidade > 10000000)
      ) {
        fields.capacidade_diaria_kg = "Informe uma capacidade válida em kg.";
      }

      if (disponivel !== undefined && typeof disponivel !== "boolean") {
        fields.disponivel = "Valor inválido.";
      }

      let ids;

      if (materiais !== undefined) {
        ids = [...new Set(Array.isArray(materiais) ? materiais : [])];

        if (
          ids.length === 0 ||
          ids.length > 20 ||
          ids.some((id) => typeof id !== "string" || !UUID_REGEX.test(id))
        ) {
          fields.materiais_ids = "Escolha ao menos um tipo de material.";
        }
      }

      if (Object.keys(fields).length > 0) {
        throw new ApiError(400, "Dados inválidos.", "VALIDATION_ERROR", fields);
      }

      if (ids) {
        const existentes = await sql`
          SELECT id FROM materiais_reciclaveis WHERE id = ANY(${ids}::uuid[])
        `;

        if (existentes.length !== ids.length) {
          throw new ApiError(400, "Dados inválidos.", "VALIDATION_ERROR", {
            materiais_ids: "Tipo de material inválido.",
          });
        }
      }

      const atualizados = await sql`
        UPDATE detalhes_parceiro
        SET
          responsavel_nome = COALESCE(${responsavel?.trim() ?? null}, responsavel_nome),
          endereco_coleta = COALESCE(${endereco?.trim() ?? null}, endereco_coleta),
          capacidade_diaria_kg = CASE
            WHEN ${capacidade !== undefined} THEN ${capacidade ?? null}
            ELSE capacidade_diaria_kg
          END,
          disponivel = COALESCE(${disponivel ?? null}, disponivel)
        WHERE usuario_id = ${req.usuario_id}
        RETURNING usuario_id
      `;

      if (atualizados.length === 0) {
        throw perfilNaoEncontrado();
      }

      if (ids) {
        await sql`
          DELETE FROM parceiro_materiais WHERE parceiro_id = ${req.usuario_id}
        `;
        await sql`
          INSERT INTO parceiro_materiais (parceiro_id, material_id)
          SELECT ${req.usuario_id}, unnest(${ids}::uuid[])
        `;
      }

      return parceirosController.obter(req, res);
    } catch (error) {
      return tratarErro(res, error, "Erro ao atualizar perfil do parceiro:");
    }
  },

  /** GET /api/parceiros/me/area */
  async obterArea(req, res) {
    try {
      const linhas = await sql`
        SELECT centro_lat, centro_lng, raio_atuacao_km, area_atualizada_em
        FROM detalhes_parceiro
        WHERE usuario_id = ${req.usuario_id}
      `;

      if (linhas.length === 0) {
        throw perfilNaoEncontrado();
      }

      const area = areaDaLinha(linhas[0]);

      return sendSuccess(res, {
        definida: area.definida,
        latitude: area.latitude,
        longitude: area.longitude,
        raio_km: area.raioKm,
        atualizada_em: linhas[0].area_atualizada_em,
      });
    } catch (error) {
      return tratarErro(res, error, "Erro ao ler a área do parceiro:");
    }
  },

  /** PUT /api/parceiros/me/area  { latitude, longitude, raio_km } */
  async salvarArea(req, res) {
    try {
      const { latitude, longitude, raio_km: raioKm } = req.body;

      const linhas = await sql`
        UPDATE detalhes_parceiro
        SET
          centro_lat = ${latitude},
          centro_lng = ${longitude},
          raio_atuacao_km = ${raioKm},
          area_atualizada_em = NOW()
        WHERE usuario_id = ${req.usuario_id}
        RETURNING centro_lat, centro_lng, raio_atuacao_km, area_atualizada_em
      `;

      if (linhas.length === 0) {
        throw perfilNaoEncontrado();
      }

      const area = areaDaLinha(linhas[0]);

      return sendSuccess(
        res,
        {
          definida: area.definida,
          latitude: area.latitude,
          longitude: area.longitude,
          raio_km: area.raioKm,
          atualizada_em: linhas[0].area_atualizada_em,
        },
        200,
        "Área de atuação atualizada.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao salvar a área do parceiro:");
    }
  },

  /** GET /api/parceiros/me/pendencias */
  async pendencias(req, res) {
    try {
      const linhas = await sql`
        SELECT
          centro_lat, centro_lng, raio_atuacao_km, assinatura_path,
          (SELECT COUNT(*)::int FROM parceiro_materiais
            WHERE parceiro_id = ${req.usuario_id}) AS materiais
        FROM detalhes_parceiro
        WHERE usuario_id = ${req.usuario_id}
      `;

      const linha = linhas[0];
      const pendencias = [];

      if (!linha || !areaDaLinha(linha).definida) {
        pendencias.push("AREA_ATUACAO");
      }

      if (!linha?.assinatura_path) {
        pendencias.push("ASSINATURA");
      }

      if (!linha || linha.materiais === 0) {
        pendencias.push("MATERIAIS");
      }

      return sendSuccess(res, { pendencias });
    } catch (error) {
      return tratarErro(res, error, "Erro ao ler pendências do parceiro:");
    }
  },

  /**
   * PUT /api/parceiros/me/assinatura
   * PNG em base64 (mesmas regras da assinatura da empresa do caçambeiro).
   * Aparece no documento de toda coleta agendada daqui para a frente.
   */
  async salvarAssinatura(req, res) {
    let arquivoGravado = null;

    try {
      const imagem = decodificarAssinaturaEmpresa(req.body.assinatura_base64);

      arquivoGravado = await salvarArquivo(
        "private/assinaturas",
        imagem.extensao,
        imagem.buffer,
      );

      const linhas = await sql`
        WITH antigo AS (
          SELECT assinatura_path
          FROM detalhes_parceiro
          WHERE usuario_id = ${req.usuario_id}
        ),
        atualizado AS (
          UPDATE detalhes_parceiro
          SET
            assinatura_path = ${arquivoGravado},
            assinatura_atualizada_em = NOW()
          WHERE usuario_id = ${req.usuario_id}
          RETURNING assinatura_atualizada_em
        )
        SELECT
          atualizado.assinatura_atualizada_em,
          (SELECT assinatura_path FROM antigo) AS anterior
        FROM atualizado
      `;

      if (linhas.length === 0) {
        await removerArquivo(arquivoGravado);
        throw perfilNaoEncontrado();
      }

      await removerArquivo(linhas[0].anterior);

      return sendSuccess(
        res,
        {
          tem_assinatura: true,
          atualizada_em: linhas[0].assinatura_atualizada_em,
        },
        200,
        "Assinatura atualizada com sucesso.",
      );
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "PARTNER_PROFILE_NOT_FOUND")) {
        await removerArquivo(arquivoGravado);
      }

      return tratarErro(res, error, "Erro ao salvar assinatura do parceiro:");
    }
  },

  /** GET /api/parceiros/me/assinatura  (PNG ou JPEG) */
  async obterAssinatura(req, res) {
    try {
      const linhas = await sql`
        SELECT assinatura_path FROM detalhes_parceiro
        WHERE usuario_id = ${req.usuario_id}
      `;

      const chave = linhas[0]?.assinatura_path;

      if (!chave) {
        throw new ApiError(
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
          throw new ApiError(
            404,
            "Nenhuma assinatura cadastrada.",
            "SIGNATURE_NOT_FOUND",
          );
        }

        throw error;
      }

      res.set({
        "Content-Type":
          formatoDaImagem(conteudo)?.mime ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });

      return res.status(200).send(conteudo);
    } catch (error) {
      return tratarErro(res, error, "Erro ao ler assinatura do parceiro:");
    }
  },

  /** DELETE /api/parceiros/me/assinatura */
  async removerAssinatura(req, res) {
    try {
      const linhas = await sql`
        WITH antigo AS (
          SELECT assinatura_path
          FROM detalhes_parceiro
          WHERE usuario_id = ${req.usuario_id}
        ),
        atualizado AS (
          UPDATE detalhes_parceiro
          SET assinatura_path = NULL, assinatura_atualizada_em = NOW()
          WHERE usuario_id = ${req.usuario_id}
          RETURNING usuario_id
        )
        SELECT (SELECT assinatura_path FROM antigo) AS anterior
        FROM atualizado
      `;

      if (linhas.length > 0) {
        await removerArquivo(linhas[0].anterior);
      }

      return sendSuccess(
        res,
        { tem_assinatura: false },
        200,
        "Assinatura removida.",
      );
    } catch (error) {
      return tratarErro(res, error, "Erro ao remover assinatura do parceiro:");
    }
  },
};

module.exports = parceirosController;
