const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida os dados específicos do cadastro de parceiro de reciclagem
 * (tipo_perfil PARCEIRO): CNPJ, responsável, endereço da empresa e os
 * tipos de material que aceita. Os campos comuns (nome, e-mail, senha,
 * telefone) já foram validados pelo schema de cadastro.
 */
function validatePartnerRegistration(req, res, next) {
  if (req.body.tipo_perfil !== "PARCEIRO") {
    return next();
  }

  const {
    documento,
    responsavel_nome: responsavel,
    endereco_coleta: endereco,
    capacidade_diaria_kg: capacidade,
    materiais_ids: materiais,
  } = req.body;

  const fields = {};

  if (!/^\d{14}$/.test(String(documento ?? "").replace(/\D/g, ""))) {
    fields.documento = "Informe um CNPJ com 14 dígitos.";
  }

  if (
    typeof responsavel !== "string" ||
    responsavel.trim().length < 3 ||
    responsavel.trim().length > 150
  ) {
    fields.responsavel_nome = "Informe o nome do responsável.";
  }

  if (
    typeof endereco !== "string" ||
    endereco.trim().length < 5 ||
    endereco.trim().length > 255
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

  if (
    !Array.isArray(materiais) ||
    materiais.length === 0 ||
    materiais.length > 20 ||
    materiais.some((id) => typeof id !== "string" || !UUID_REGEX.test(id))
  ) {
    fields.materiais_ids = "Escolha ao menos um tipo de material.";
  }

  if (Object.keys(fields).length > 0) {
    return res.status(400).json({
      success: false,
      message: "Dados do parceiro inválidos.",
      code: "VALIDATION_ERROR",
      fields,
    });
  }

  return next();
}

module.exports = validatePartnerRegistration;
