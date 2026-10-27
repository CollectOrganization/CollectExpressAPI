const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

const DIGITS_REGEX = /^\d+$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function verificarTipo(valor, tipo) {
  switch (tipo) {
    case "string":
      return typeof valor === "string";

    case "number":
      return (
        typeof valor === "number" &&
        Number.isFinite(valor)
      );

    case "integer":
      return Number.isInteger(valor);

    case "boolean":
      return typeof valor === "boolean";

    case "array":
      return Array.isArray(valor);

    default:
      return true;
  }
}

function verificarFormato(valor, formato) {
  if (typeof valor !== "string") {
    return false;
  }

  switch (formato) {
    case "email":
      return EMAIL_REGEX.test(valor);

    case "digits":
      return DIGITS_REGEX.test(valor);

    case "uuid":
      return UUID_REGEX.test(valor);

    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(valor) &&
        !Number.isNaN(
          new Date(`${valor}T00:00:00`).getTime(),
        );

    case "time":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(valor);

    case "url":
      try {
        const url = new URL(valor);
        return ["http:", "https:"].includes(url.protocol);
      } catch (_) {
        return false;
      }

    default:
      return true;
  }
}

function validarCampo(campo, valor, regras, dados) {
  const erros = [];

  const ausente =
    valor === undefined ||
    valor === null ||
    (typeof valor === "string" &&
      valor.trim().length === 0);

  if (regras.required && ausente) {
    erros.push(`O campo '${campo}' é obrigatório.`);
    return erros;
  }

  if (ausente) {
    return erros;
  }

  if (
    regras.type &&
    !verificarTipo(valor, regras.type)
  ) {
    erros.push(
      `O campo '${campo}' deve ser do tipo '${regras.type}'.`,
    );
    return erros;
  }

  if (typeof valor === "string") {
    const trimmed = valor.trim();

    if (
      regras.minLength !== undefined &&
      trimmed.length < regras.minLength
    ) {
      erros.push(
        `O campo '${campo}' deve ter no mínimo ${regras.minLength} caracteres.`,
      );
    }

    if (
      regras.maxLength !== undefined &&
      trimmed.length > regras.maxLength
    ) {
      erros.push(
        `O campo '${campo}' deve ter no máximo ${regras.maxLength} caracteres.`,
      );
    }

    if (
      regras.pattern &&
      !new RegExp(regras.pattern).test(valor)
    ) {
      erros.push(
        `O campo '${campo}' possui formato inválido.`,
      );
    }
  }

  if (
    typeof valor === "number" &&
    regras.min !== undefined &&
    valor < regras.min
  ) {
    erros.push(
      `O campo '${campo}' deve ser no mínimo ${regras.min}.`,
    );
  }

  if (
    typeof valor === "number" &&
    regras.max !== undefined &&
    valor > regras.max
  ) {
    erros.push(
      `O campo '${campo}' deve ser no máximo ${regras.max}.`,
    );
  }

  if (
    regras.format &&
    !verificarFormato(valor, regras.format)
  ) {
    erros.push(
      `O campo '${campo}' possui formato inválido.`,
    );
  }

  if (
    regras.enum &&
    !regras.enum.includes(valor)
  ) {
    erros.push(
      `O campo '${campo}' deve ser um dos valores: ${regras.enum.join(", ")}.`,
    );
  }

  if (typeof regras.custom === "function") {
    const resultado = regras.custom(valor, dados);

    if (resultado !== true) {
      erros.push(
        typeof resultado === "string"
          ? resultado
          : `O campo '${campo}' é inválido.`,
      );
    }
  }

  return erros;
}

function validationMiddleware(
  schema,
  source = "body",
  options = {},
) {
   if (!schema || typeof schema !== "object") {
    throw new TypeError(
      `Schema de validação inválido para a fonte '${source}'.`,
    );
  }

  return function validate(req, res, next) {
    const dados = req[source] || {};
    const fields = {};

    if (options.atLeastOne) {
      const hasField = options.atLeastOne.some(
        (field) => dados[field] !== undefined,
      );

      if (!hasField) {
        return res.status(400).json({
          success: false,
          message: "Nenhum campo válido foi informado.",
          code: "VALIDATION_ERROR",
          fields: {
            request: `Informe ao menos um destes campos: ${options.atLeastOne.join(", ")}.`,
          },
        });
      }
    }

    for (const [campo, regras] of Object.entries(schema)) {
      const erros = validarCampo(
        campo,
        dados[campo],
        regras,
        dados,
      );

      if (erros.length > 0) {
        fields[campo] = erros[0];
      }
    }

    if (Object.keys(fields).length > 0) {
      return res.status(400).json({
        success: false,
        message: "Dados inválidos.",
        code: "VALIDATION_ERROR",
        fields,
      });
    }

    return next();
  };
}

module.exports = validationMiddleware;