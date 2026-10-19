/**
 * Middleware de validação - Factory function
 * Aceita regras de schema e retorna middleware Express que valida req.body
 *
 * Regras suportadas por campo:
 *   required: boolean - campo obrigatório
 *   type: 'string' | 'number' | 'boolean' | 'integer'
 *   minLength / maxLength: para strings
 *   min / max: para números
 *   format: 'email' | 'digits'
 *   custom: function(value) => true | string (mensagem de erro)
 */

// RFC 5322 simplified email regex - covers standard email formats
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const DIGITS_REGEX = /^\d+$/;

/**
 * Valida um único campo contra suas regras
 * @param {string} campo - Nome do campo
 * @param {*} valor - Valor do campo
 * @param {object} regras - Regras de validação
 * @returns {Array} Lista de erros encontrados
 */
function validarCampo(campo, valor, regras) {
  const erros = [];

  // Verificação de presença (required)
  if (regras.required) {
    if (valor === undefined || valor === null || valor === '') {
      erros.push({
        campo,
        mensagem: `O campo '${campo}' é obrigatório`
      });
      return erros; // Se campo obrigatório está ausente, não valida o resto
    }
  }

  // Se o valor não está presente e não é obrigatório, pula validações
  if (valor === undefined || valor === null || valor === '') {
    return erros;
  }

  // Verificação de tipo
  if (regras.type) {
    const tipoInvalido = verificarTipo(valor, regras.type);
    if (tipoInvalido) {
      erros.push({
        campo,
        mensagem: `O campo '${campo}' deve ser do tipo '${regras.type}'`
      });
      return erros; // Se tipo é inválido, não valida o resto
    }
  }

  // Verificação de comprimento mínimo (strings)
  if (regras.minLength !== undefined && typeof valor === 'string') {
    if (valor.length < regras.minLength) {
      erros.push({
        campo,
        mensagem: `O campo '${campo}' deve ter no mínimo ${regras.minLength} caracteres`
      });
    }
  }

  // Verificação de comprimento máximo (strings)
  if (regras.maxLength !== undefined && typeof valor === 'string') {
    if (valor.length > regras.maxLength) {
      erros.push({
        campo,
        mensagem: `O campo '${campo}' deve ter no máximo ${regras.maxLength} caracteres`
      });
    }
  }

  // Verificação de valor mínimo (números)
  if (regras.min !== undefined && typeof valor === 'number') {
    if (valor < regras.min) {
      erros.push({
        campo,
        mensagem: `O campo '${campo}' deve ser no mínimo ${regras.min}`
      });
    }
  }

  // Verificação de valor máximo (números)
  if (regras.max !== undefined && typeof valor === 'number') {
    if (valor > regras.max) {
      erros.push({
        campo,
        mensagem: `O campo '${campo}' deve ser no máximo ${regras.max}`
      });
    }
  }

  // Verificação de formato
  if (regras.format) {
    const erroFormato = verificarFormato(campo, valor, regras.format);
    if (erroFormato) {
      erros.push(erroFormato);
    }
  }

  // Validador customizado
  if (regras.custom && typeof regras.custom === 'function') {
    const resultado = regras.custom(valor);
    if (resultado !== true) {
      erros.push({
        campo,
        mensagem: typeof resultado === 'string' ? resultado : `O campo '${campo}' é inválido`
      });
    }
  }

  return erros;
}

/**
 * Verifica se o valor corresponde ao tipo esperado
 * @returns {boolean} true se tipo é inválido
 */
function verificarTipo(valor, tipo) {
  switch (tipo) {
    case 'string':
      return typeof valor !== 'string';
    case 'number':
      return typeof valor !== 'number' || isNaN(valor);
    case 'integer':
      return typeof valor !== 'number' || !Number.isInteger(valor);
    case 'boolean':
      return typeof valor !== 'boolean';
    default:
      return false;
  }
}

/**
 * Verifica formato do valor
 * @returns {object|null} Objeto de erro ou null se válido
 */
function verificarFormato(campo, valor, formato) {
  switch (formato) {
    case 'email':
      if (typeof valor !== 'string' || !EMAIL_REGEX.test(valor)) {
        return {
          campo,
          mensagem: `O campo '${campo}' deve ser um email válido`
        };
      }
      return null;

    case 'digits':
      if (typeof valor !== 'string' || !DIGITS_REGEX.test(valor)) {
        return {
          campo,
          mensagem: `O campo '${campo}' deve conter apenas dígitos`
        };
      }
      return null;

    default:
      return null;
  }
}

/**
 * Factory function que cria middleware de validação
 * @param {object} schema - Objeto com regras de validação por campo
 * @param {string} [source='body'] - Fonte dos dados: 'body', 'params', ou 'query'
 * @returns {Function} Middleware Express
 *
 * Exemplo de uso:
 *   const validate = validationMiddleware({
 *     nome_completo: { required: true, type: 'string', minLength: 3, maxLength: 150 },
 *     email: { required: true, type: 'string', format: 'email', maxLength: 255 },
 *     documento: { required: true, type: 'string', format: 'digits', custom: (v) => (v.length === 11 || v.length === 14) || "Documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos" }
 *   });
 *   router.post('/endpoint', validate, controller);
 */
function validationMiddleware(schema, source = 'body') {
  return function (req, res, next) {
    const dados = req[source] || {};
    const erros = [];

    for (const [campo, regras] of Object.entries(schema)) {
      const valor = dados[campo];
      const errosCampo = validarCampo(campo, valor, regras);
      erros.push(...errosCampo);
    }

    if (erros.length > 0) {
      return res.status(400).json({ errors: erros });
    }

    return next();
  };
}

module.exports = validationMiddleware;
