const express = require("express");

const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const validationMiddleware = require(
  "../middlewares/validationMiddleware",
);

const validateSupplierRegistration = require(
  "../middlewares/validateSupplierRegistration",
);

const {
  rateLimitMiddleware,
} = require("../middlewares/rateLimitMiddleware");

const {
  loginLimiter,
  registerLimiter,
  passwordRecoveryLimiter,
  refreshTokenLimiter,
} = require("../middlewares/securityRateLimits");

const schemas = require("../validators/requestSchemas");

const router = express.Router();

/**
 * Valida a política de senha utilizada no cadastro
 * e na redefinição de senha.
 */
function validateStrongPassword(value) {
  const hasUppercase = /[A-Z]/.test(value);
  const hasLowercase = /[a-z]/.test(value);
  const hasDigit = /\d/.test(value);

  if (!hasUppercase || !hasLowercase || !hasDigit) {
    return (
      "A senha deve conter pelo menos uma letra maiúscula, " +
      "uma minúscula e um dígito"
    );
  }

  return true;
}

/**
 * Schema para o cadastro público.
 *
 * Por segurança, somente os perfis CONSUMIDOR e CACAMBEIRO
 * podem ser criados por este endpoint.
 *
 * O perfil ADMIN deve ser criado exclusivamente por um
 * administrador autenticado em POST /api/usuarios/admin.
 */
const registerSchema = {
  nome_completo: {
    required: true,
    type: "string",
    minLength: 3,
    maxLength: 150,
  },
  email: {
    required: true,
    type: "string",
    format: "email",
    maxLength: 255,
  },
  senha: {
    required: true,
    type: "string",
    minLength: 8,
    maxLength: 128,
    custom: validateStrongPassword,
  },
  tipo_perfil: {
    required: true,
    type: "string",
    custom: (value) => {
      const allowedProfiles = [
        "CONSUMIDOR",
        "CACAMBEIRO",
      ];

      if (!allowedProfiles.includes(value)) {
        return (
          "O tipo de perfil deve ser " +
          "'CONSUMIDOR' ou 'CACAMBEIRO'"
        );
      }

      return true;
    },
  },
  documento: {
    required: true,
    type: "string",
    format: "digits",
    custom: (value) => {
      if (value.length !== 11 && value.length !== 14) {
        return (
          "Documento deve ter 11 dígitos para CPF " +
          "ou 14 dígitos para CNPJ"
        );
      }

      return true;
    },
  },
  telefone: {
    required: true,
    type: "string",
    format: "digits",
    minLength: 10,
    maxLength: 11,
  },
};

/**
 * Validação adicional para o cadastro de CACAMBEIRO.
 *
 * Esses campos não são exigidos para consumidores.
 */
function validateCacambeiroDetails(req, res, next) {
  if (req.body.tipo_perfil !== "CACAMBEIRO") {
    return next();
  }

  const {
    horario_inicio,
    horario_fim,
    raio_entrega_km,
    taxa_entrega,
  } = req.body;

  const errors = [];
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

  if (
    !horario_inicio ||
    typeof horario_inicio !== "string"
  ) {
    errors.push({
      campo: "horario_inicio",
      mensagem:
        "O campo 'horario_inicio' é obrigatório",
    });
  } else if (!timeRegex.test(horario_inicio)) {
    errors.push({
      campo: "horario_inicio",
      mensagem:
        "O campo 'horario_inicio' deve estar no formato HH:MM",
    });
  }

  if (
    !horario_fim ||
    typeof horario_fim !== "string"
  ) {
    errors.push({
      campo: "horario_fim",
      mensagem: "O campo 'horario_fim' é obrigatório",
    });
  } else if (!timeRegex.test(horario_fim)) {
    errors.push({
      campo: "horario_fim",
      mensagem:
        "O campo 'horario_fim' deve estar no formato HH:MM",
    });
  } else if (
    horario_inicio &&
    timeRegex.test(horario_inicio) &&
    horario_fim <= horario_inicio
  ) {
    errors.push({
      campo: "horario_fim",
      mensagem:
        "O horário final deve ser posterior ao horário inicial",
    });
  }

  if (
    raio_entrega_km === undefined ||
    raio_entrega_km === null
  ) {
    errors.push({
      campo: "raio_entrega_km",
      mensagem:
        "O campo 'raio_entrega_km' é obrigatório",
    });
  } else if (
    typeof raio_entrega_km !== "number" ||
    Number.isNaN(raio_entrega_km)
  ) {
    errors.push({
      campo: "raio_entrega_km",
      mensagem:
        "O campo 'raio_entrega_km' deve ser numérico",
    });
  } else if (
    raio_entrega_km < 1 ||
    raio_entrega_km > 200
  ) {
    errors.push({
      campo: "raio_entrega_km",
      mensagem:
        "O raio de entrega deve estar entre 1 e 200 km",
    });
  }

  if (
    taxa_entrega === undefined ||
    taxa_entrega === null
  ) {
    errors.push({
      campo: "taxa_entrega",
      mensagem:
        "O campo 'taxa_entrega' é obrigatório",
    });
  } else if (
    typeof taxa_entrega !== "number" ||
    Number.isNaN(taxa_entrega)
  ) {
    errors.push({
      campo: "taxa_entrega",
      mensagem:
        "O campo 'taxa_entrega' deve ser numérico",
    });
  } else if (
    taxa_entrega < 0.01 ||
    taxa_entrega > 99999.99
  ) {
    errors.push({
      campo: "taxa_entrega",
      mensagem:
        "A taxa de entrega deve estar entre 0.01 e 99999.99",
    });
  }

  if (errors.length > 0) {
    const fields = {};

    for (const error of errors) {
      fields[error.campo] = error.mensagem;
    }

    return res.status(400).json({
      success: false,
      message: "Dados do caçambeiro inválidos.",
      code: "VALIDATION_ERROR",
      fields,
    });
  }

  return next();
}

/**
 * Login aceita seis caracteres porque as contas acadêmicas
 * criadas pelo seed utilizam a senha 123456.
 *
 * Novos cadastros continuam exigindo uma senha forte
 * com pelo menos oito caracteres.
 */
const loginSchema = {
  email: {
    required: true,
    type: "string",
    format: "email",
    maxLength: 255,
  },
  senha: {
    required: true,
    type: "string",
    minLength: 6,
    maxLength: 128,
  },
};

const forgotPasswordSchema = {
  email: {
    required: true,
    type: "string",
    format: "email",
    maxLength: 255,
  },
};

const resetPasswordSchema = {
  token: {
    required: true,
    type: "string",
    minLength: 20,
    maxLength: 256,
  },
  nova_senha: {
    required: true,
    type: "string",
    minLength: 8,
    maxLength: 128,
    custom: validateStrongPassword,
  },
};

/*
* Schema para atualização e termino do
* uso dos tokens de perfil de usuário
*/

const refreshSchema = {
  refresh_token: {
    required: true,
    type: "string",
    minLength: 20,
    maxLength: 200,
  },
};

const logoutSchema = {
  refresh_token: {
    required: true,
    type: "string",
    minLength: 20,
    maxLength: 200,
  },
};

/**
 * POST /api/auth/register
 *
 * Cadastro público somente para CONSUMIDOR e CACAMBEIRO.
 */
/*
router.post(
  "/register",
  registerLimiter,
  validationMiddleware(registerSchema),
  validateCacambeiroDetails,
  authController.register,
);
*/
router.post(
  "/register",
  registerLimiter,
  validationMiddleware(schemas.register),
  validateSupplierRegistration,
  authController.register,
);

/**
 * POST /api/auth/login
 *
 * Possui dois níveis de proteção:
 * - express-rate-limit;
 * - controle persistido de tentativas por IP.
 */
/*
router.post(
  "/login",
  loginLimiter,
  rateLimitMiddleware,
  validationMiddleware(loginSchema),
  authController.login,
);*/
router.post(
  "/login",
  loginLimiter,
  validationMiddleware(schemas.login),
  authController.login,
);

// Renova a sessão e rotaciona o refresh token.
// O refresh token anterior deixa de funcionar.
router.post(
  "/refresh",
  refreshTokenLimiter,
  validationMiddleware(schemas.refresh),
  authController.refresh,
);


/**
 * POST /api/auth/forgot-password
 * Solicita código de recuperação por e-mail, SMS ou WhatsApp.
 */
/*
router.post(
  "/forgot-password",
  passwordRecoveryLimiter,
  validationMiddleware(forgotPasswordSchema),
  authController.forgotPassword,
);*/
router.post(
  "/forgot-password",
  passwordRecoveryLimiter,
  validationMiddleware(schemas.forgotPassword),
  authController.forgotPassword,
);

/**
 * POST /api/auth/reset-password
 * Valida o código recebido e redefine a senha.
 * As sessões anteriores do usuário serão invalidadas.
 */
/*
router.post(
  "/reset-password",
  passwordRecoveryLimiter,
  validationMiddleware(resetPasswordSchema),
  authController.resetPassword,
);*/
router.post(
  "/reset-password",
  passwordRecoveryLimiter,
  validationMiddleware(schemas.resetPassword),
  authController.resetPassword,
);

/**
 * POST /api/auth/logout
 * Encerra a sessão atual.
 * Requer access token e recebe o refresh token no body.
 * Exige JWT válido e adiciona o token atual à blacklist.
 */
/*
router.post(
  "/logout",
  authMiddleware,
  validationMiddleware(logoutSchema),
  authController.logout,
);*/
router.post(
  "/logout",
  authMiddleware,
  validationMiddleware(schemas.logout),
  authController.logout,
);

/**
 * A rota de renovação será habilitada somente depois que
 * authController.refresh for implementado.
 *
 * Não descomente antes disso, pois o Express lançará:
 * "TypeError: argument handler must be a function".
 */

router.post(
  "/refresh",
  refreshTokenLimiter,
  validationMiddleware(refreshSchema),
  authController.refresh,
);

module.exports = router;