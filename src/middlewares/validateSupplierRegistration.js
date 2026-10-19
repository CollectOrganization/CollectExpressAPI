function validateSupplierRegistration(req, res, next) {
  if (req.body.tipo_perfil !== "CACAMBEIRO") {
    return next();
  }

  const {
    horario_inicio,
    horario_fim,
    raio_entrega_km,
    taxa_entrega,
  } = req.body;

  const fields = {};
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (
    typeof horario_inicio !== "string" ||
    !timeRegex.test(horario_inicio)
  ) {
    fields.horario_inicio =
      "Informe o horário inicial no formato HH:MM.";
  }

  if (
    typeof horario_fim !== "string" ||
    !timeRegex.test(horario_fim)
  ) {
    fields.horario_fim =
      "Informe o horário final no formato HH:MM.";
  }

  if (
    timeRegex.test(horario_inicio || "") &&
    timeRegex.test(horario_fim || "") &&
    horario_fim <= horario_inicio
  ) {
    fields.horario_fim =
      "O horário final deve ser posterior ao inicial.";
  }

  if (
    typeof raio_entrega_km !== "number" ||
    !Number.isFinite(raio_entrega_km) ||
    raio_entrega_km < 1 ||
    raio_entrega_km > 200
  ) {
    fields.raio_entrega_km =
      "O raio deve estar entre 1 e 200 km.";
  }

  if (
    typeof taxa_entrega !== "number" ||
    !Number.isFinite(taxa_entrega) ||
    taxa_entrega < 0.01 ||
    taxa_entrega > 99999.99
  ) {
    fields.taxa_entrega =
      "A taxa deve estar entre 0,01 e 99.999,99.";
  }

  if (Object.keys(fields).length > 0) {
    return res.status(400).json({
      success: false,
      message: "Dados do fornecedor inválidos.",
      code: "VALIDATION_ERROR",
      fields,
    });
  }

  return next();
}

module.exports = validateSupplierRegistration;