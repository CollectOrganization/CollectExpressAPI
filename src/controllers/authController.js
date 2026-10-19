const bcrypt = require("bcryptjs");

const sql = require("../config/db");

const {
  createAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAccessToken,
} = require("../services/tokenService");

const {
  recordFailedAttempt,
  resetAttempts,
  getClientIp,
} = require("../middlewares/rateLimitMiddleware");

const {
  createPasswordRecovery,
  resetPassword: persistPasswordReset,
} = require("../services/passwordRecoveryService");

/**
 * Converte o status recebido do PostgreSQL para o padrão
 * utilizado nas respostas e validações da API.
 */
function normalizeUserStatus(status) {
  return String(status ?? "")
    .trim()
    .toUpperCase();
}

/**
 * Retorna resposta padronizada para conflitos de cadastro.
 */
function handleRegistrationConflict(error, res) {
  if (error.code !== "23505") {
    return null;
  }

  const constraint = String(error.constraint ?? "").toLowerCase();
  const detail = String(error.detail ?? "").toLowerCase();

  if (
    constraint.includes("email") ||
    detail.includes("email")
  ) {
    return res.status(409).json({
      success: false,
      message: "E-mail já cadastrado.",
      code: "EMAIL_ALREADY_EXISTS",
    });
  }

  if (
    constraint.includes("documento") ||
    detail.includes("documento")
  ) {
    return res.status(409).json({
      success: false,
      message: "Documento já cadastrado.",
      code: "DOCUMENT_ALREADY_EXISTS",
    });
  }

  return res.status(409).json({
    success: false,
    message: "Registro duplicado.",
    code: "DUPLICATE_RECORD",
  });
}

const authController = {
  /**
   * POST /api/auth/register
   *
   * Cadastro público de:
   * - CONSUMIDOR;
   * - CACAMBEIRO.
   *
   * O cadastro de ADMIN não é permitido neste endpoint.
   *
   * Para CACAMBEIRO, o usuário e os detalhes comerciais
   * são criados atomicamente através de um único CTE.
   */
  async register(req, res) {
    try {
      const {
        nome_completo,
        email,
        senha,
        tipo_perfil,
        documento,
        telefone,
        horario_inicio,
        horario_fim,
        raio_entrega_km,
        taxa_entrega,
      } = req.body;

      // Defesa adicional além do middleware de validação.
      if (
        tipo_perfil !== "CONSUMIDOR" &&
        tipo_perfil !== "CACAMBEIRO"
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Tipo de perfil não permitido no cadastro público.",
          code: "PROFILE_NOT_ALLOWED",
        });
      }

      const nomeNormalizado = nome_completo.trim();
      const emailNormalizado = email.trim().toLowerCase();
      const documentoNormalizado = documento.replace(/\D/g, "");
      const telefoneNormalizado = telefone.replace(/\D/g, "");

      /*
       * O banco atual utiliza os estados em letras minúsculas.
       *
       * CONSUMIDOR pode acessar imediatamente.
       * CACAMBEIRO precisa ser aprovado por um ADMIN.
       */
      const statusInicial =
        tipo_perfil === "CACAMBEIRO"
          ? "pendente"
          : "ativo";

      const senhaHash = await bcrypt.hash(senha, 10);

      /*
       * Uma única instrução SQL garante atomicidade.
       *
       * Se o cadastro dos detalhes do caçambeiro falhar,
       * o usuário também não será persistido.
       */
      const resultado = await sql`
        WITH novo_usuario AS (
          INSERT INTO usuarios (
            nome_completo,
            email,
            senha_hash,
            tipo_perfil,
            documento,
            telefone,
            status
          )
          VALUES (
            ${nomeNormalizado},
            ${emailNormalizado},
            ${senhaHash},
            ${tipo_perfil},
            ${documentoNormalizado},
            ${telefoneNormalizado},
            ${statusInicial}
          )
          RETURNING
            id,
            nome_completo,
            email,
            tipo_perfil,
            documento,
            telefone,
            status,
            token_version,
            criado_em
        ),

        novos_detalhes AS (
          INSERT INTO detalhes_cacambeiro (
            usuario_id,
            horario_inicio,
            horario_fim,
            raio_entrega_km,
            taxa_entrega
          )
          SELECT
            id,
            ${horario_inicio ?? null},
            ${horario_fim ?? null},
            ${raio_entrega_km ?? null},
            ${taxa_entrega ?? null}
          FROM novo_usuario
          WHERE tipo_perfil = 'CACAMBEIRO'
          RETURNING usuario_id
        )

        SELECT *
        FROM novo_usuario
      `;

      const usuario = resultado[0];

      return res.status(201).json({
        success: true,
        message:
          tipo_perfil === "CACAMBEIRO"
            ? "Cadastro enviado para aprovação."
            : "Cadastro realizado com sucesso.",
        data: {
          ...usuario,
          status: normalizeUserStatus(usuario.status),
        },
      });
    } catch (error) {
      const conflictResponse = handleRegistrationConflict(
        error,
        res,
      );

      if (conflictResponse) {
        return conflictResponse;
      }

      console.error("Erro no registro:", error);

      return res.status(500).json({
        success: false,
        message:
          "Erro interno no servidor ao realizar o cadastro.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/login
   *
   * Autentica CONSUMIDOR, CACAMBEIRO ou ADMIN.
   * Retorna access token e refresh token.
   */
  async login(req, res) {
    try {
      const { email, senha } = req.body;
      const ip = getClientIp(req);

      if (
        typeof email !== "string" ||
        typeof senha !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "E-mail e senha são obrigatórios.",
          code: "VALIDATION_ERROR",
        });
      }

      const emailNormalizado = email.trim().toLowerCase();

      const usuarios = await sql`
        SELECT
          id,
          nome_completo,
          email,
          senha_hash,
          tipo_perfil,
          status,
          token_version
        FROM usuarios
        WHERE LOWER(email) = ${emailNormalizado}
        LIMIT 1
      `;

      const usuario = usuarios[0];

      /*
       * A mesma resposta é usada para usuário inexistente
       * e senha incorreta.
       */
      if (!usuario) {
        await recordFailedAttempt(ip);

        return res.status(401).json({
          success: false,
          message: "Credenciais inválidas.",
          code: "INVALID_CREDENTIALS",
        });
      }

      const senhaValida = await bcrypt.compare(
        senha,
        usuario.senha_hash,
      );

      if (!senhaValida) {
        await recordFailedAttempt(ip);

        return res.status(401).json({
          success: false,
          message: "Credenciais inválidas.",
          code: "INVALID_CREDENTIALS",
        });
      }

      const statusUsuario = normalizeUserStatus(
        usuario.status,
      );

      if (statusUsuario === "PENDENTE") {
        return res.status(403).json({
          success: false,
          message:
            "Seu cadastro ainda está aguardando aprovação.",
          code: "USER_PENDING",
        });
      }

      if (statusUsuario === "SUSPENSO") {
        return res.status(403).json({
          success: false,
          message: "Sua conta está suspensa.",
          code: "USER_SUSPENDED",
        });
      }

      if (statusUsuario !== "ATIVO") {
        console.error("Status inesperado no login:", {
          usuario_id: usuario.id,
          status: usuario.status,
        });

        return res.status(403).json({
          success: false,
          message:
            "Sua conta não está disponível para acesso.",
          code: "USER_INACTIVE",
        });
      }

      await resetAttempts(ip);

      /*
       * Mantém o status normalizado na resposta.
       * createAccessToken também receberá token_version.
       */
      usuario.status = statusUsuario;

      const accessToken = createAccessToken(usuario);
      const refresh = await createRefreshToken(usuario.id);

      return res.status(200).json({
        success: true,
        data: {
          access_token: accessToken,
          refresh_token: refresh.refreshToken,
          token_type: "Bearer",
          expires_in:
            process.env.JWT_EXPIRES_IN || "15m",
          refresh_expires_at:
            refresh.expiresAt.toISOString(),
          usuario: {
            id: usuario.id,
            nome_completo: usuario.nome_completo,
            email: usuario.email,
            tipo_perfil: usuario.tipo_perfil,
            status: statusUsuario,
          },
        },
      });
    } catch (error) {
      console.error("Erro no login:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/refresh
   *
   * Revoga o refresh token atual e gera um novo par
   * de access token e refresh token.
   */
  async refresh(req, res) {
    try {
      const { refresh_token } = req.body;

      const rotated = await rotateRefreshToken(
        refresh_token,
      );

      if (!rotated) {
        return res.status(401).json({
          success: false,
          message:
            "Refresh token inválido, expirado ou já utilizado.",
          code: "INVALID_REFRESH_TOKEN",
        });
      }

      const accessToken = createAccessToken(
        rotated.usuario,
      );

      return res.status(200).json({
        success: true,
        data: {
          access_token: accessToken,
          refresh_token: rotated.refreshToken,
          token_type: "Bearer",
          expires_in:
            process.env.JWT_EXPIRES_IN || "15m",
          refresh_expires_at:
            rotated.expiresAt.toISOString(),
          usuario: {
            id: rotated.usuario.id,
            nome_completo:
              rotated.usuario.nome_completo,
            email: rotated.usuario.email,
            tipo_perfil:
              rotated.usuario.tipo_perfil,
            status: normalizeUserStatus(
              rotated.usuario.status,
            ),
          },
        },
      });
    } catch (error) {
      console.error("Erro ao renovar sessão:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno ao renovar a sessão.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/logout
   *
   * Revoga o access token atual e o refresh token
   * informado no corpo da requisição.
   */
  async logout(req, res) {
    try {
      const { refresh_token } = req.body;

      await revokeAccessToken(req.token);
      await revokeRefreshToken(refresh_token);

      return res.status(200).json({
        success: true,
        message: "Logout realizado com sucesso.",
        data: null,
      });
    } catch (error) {
      console.error("Erro no logout:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/forgot-password
   *
   * Solicita um código por:
   * - EMAIL;
   * - SMS;
   * - WHATSAPP.
   */
  async forgotPassword(req, res) {
    try {
      const { identifier, channel } = req.body;

      const result = await createPasswordRecovery({
        identifier,
        channel,
      });

      const data = {
        request_id: result.requestId,
        destination_masked:
          result.destinationMasked,
      };

      /*
       * Apenas no desenvolvimento acadêmico.
       * Em produção, o código nunca deve ser retornado.
       */
      if (result.developmentCode) {
        data.development_code =
          result.developmentCode;
      }

      return res.status(200).json({
        success: true,
        message:
          "Se os dados estiverem cadastrados, você receberá um código de recuperação.",
        data,
      });
    } catch (error) {
      console.error(
        "Erro ao solicitar recuperação:",
        error,
      );

      return res.status(500).json({
        success: false,
        message:
          "Não foi possível enviar o código de recuperação.",
        code: "RECOVERY_DELIVERY_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/reset-password
   *
   * Confirma o código e define a nova senha.
   */
  async resetPassword(req, res) {
    try {
      const {
        request_id,
        code,
        nova_senha,
      } = req.body;

      const senhaForte =
        nova_senha.length >= 8 &&
        /[A-Z]/.test(nova_senha) &&
        /[a-z]/.test(nova_senha) &&
        /\d/.test(nova_senha);

      if (!senhaForte) {
        return res.status(400).json({
          success: false,
          message:
            "A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, uma minúscula e um número.",
          code: "WEAK_PASSWORD",
        });
      }

      const alterada = await persistPasswordReset({
        requestId: request_id,
        code,
        newPassword: nova_senha,
      });

      if (!alterada) {
        return res.status(400).json({
          success: false,
          message: "Código inválido ou expirado.",
          code: "INVALID_RECOVERY_CODE",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Senha atualizada com sucesso.",
        data: null,
      });
    } catch (error) {
      console.error(
        "Erro ao redefinir senha:",
        error,
      );

      return res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },
};

module.exports = authController;


//----------------- Old Version -----------------
/*const sql = require("../config/db");
const bcrypt = require("bcryptjs");

/* vai ser centralizado no tokenservice.js agora
const jwt = require("jsonwebtoken");*

const {
  createAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAccessToken,
} = require("../services/tokenService");

const crypto = require("crypto");

const {
  recordFailedAttempt,
  resetAttempts,
  getClientIp,
} = require("../middlewares/rateLimitMiddleware");

const {
  createPasswordRecovery,
  resetPassword: persistPasswordReset,
} = require("../services/passwordRecoveryService");

/**
 * Armazenamento temporário dos tokens de recuperação de senha.
 *
 * Importante:
 * - Os tokens serão perdidos quando a API for reiniciada.
 * - Em produção, eles deverão ser armazenados no banco de dados.
 *
 * Estrutura:
 * Map<string, {
 *   token,
 *   usuario_id,
 *   expires_at,
 *   used
 * }>
 *
const recoveryTokens = new Map();

const authController = {
  /**
   * POST /api/auth/register
   *
   * Registra:
   * - CONSUMIDOR
   * - CACAMBEIRO
   *
   * Para um CACAMBEIRO, também cria o registro em
   * detalhes_cacambeiro.
   *
  async register(req, res) {
    try {
      const {
        nome_completo,
        email,
        senha,
        tipo_perfil,
        documento,
        telefone,
      } = req.body;

      /**
       * Normaliza os dados antes de salvar.
       *
       * Isso evita cadastrar e-mails como:
       * Usuario@Email.com
       * usuario@email.com
       *
       * como se fossem contas diferentes.
       *
      const nomeNormalizado = nome_completo.trim();
      const emailNormalizado = email.trim().toLowerCase();
      const documentoNormalizado = documento.replace(/\D/g, "");
      const telefoneNormalizado = telefone.replace(/\D/g, "");

      /**
       * Defesa adicional:
       * o cadastro público só permite CONSUMIDOR e CACAMBEIRO.
       *
       * Mesmo que a validação da rota seja removida ou alterada,
       * não será possível criar um ADMIN por este controller.
       *
      if (
        tipo_perfil !== "CONSUMIDOR" &&
        tipo_perfil !== "CACAMBEIRO"
      ) {
        return res.status(403).json({
          success: false,
          message: "Tipo de perfil não permitido no cadastro público.",
          code: "PROFILE_NOT_ALLOWED",
        });
      }

      /**
       * Status inicial:
       *
       * - Consumidor pode acessar imediatamente;
       * - Caçambeiro precisa ser aprovado por um administrador.
       */
      /*Versao sera descontinuada
      const statusUsuario =
        tipo_perfil === "CACAMBEIRO"
          ? "PENDENTE"
          : "ATIVO";*
      const statusUsuario = String(usuario.status)
        .trim()
        .toUpperCase();

      if (statusUsuario === "PENDENTE") {
        return res.status(403).json({
          success: false,
          message: "Seu cadastro ainda aguarda aprovação.",
          code: "USER_PENDING",
        });
      }

      if (statusUsuario === "SUSPENSO") {
        return res.status(403).json({
          success: false,
          message: "Sua conta está suspensa.",
          code: "USER_SUSPENDED",
        });
      }

      if (statusUsuario !== "ATIVO") {
        console.error("Status inesperado no login:", {
          usuario_id: usuario.id,
          status: usuario.status,
        });

        return res.status(403).json({
          success: false,
          message: "Sua conta não está disponível para acesso.",
          code: "USER_INACTIVE",
        });
      }

      // Gera o hash seguro da senha com fator de custo 10.
      const senhaHash = await bcrypt.hash(senha, 10);

      /**
       * Insere o usuário.
       *
       * Atenção: usamos emailNormalizado, e não o email original.
       *
      const resultado = await sql`
      INSERT INTO usuarios (
        nome_completo,
        email,
        senha_hash,
        tipo_perfil,
        documento,
        telefone,
        status
      )
      VALUES (
        ${nomeNormalizado},
        ${emailNormalizado},
        ${senhaHash},
        ${tipo_perfil},
        ${documentoNormalizado},
        ${telefoneNormalizado},
        ${statusUsuario}
      )
      RETURNING
        id,
        nome_completo,
        email,
        tipo_perfil,
        documento,
        telefone,
        status,
        criado_em
    `;

      const usuario = resultado[0];

      /**
       * Se for um fornecedor de caçambas, salva também os
       * dados específicos do negócio.
       *
      if (
        tipo_perfil !== "CONSUMIDOR" &&
        tipo_perfil !== "CACAMBEIRO"
      ) {
        return res.status(403).json({
          success: false,
          message: "Tipo de perfil não permitido no cadastro público.",
          code: "PROFILE_NOT_ALLOWED",
        });
      }

      if (tipo_perfil === "CACAMBEIRO") {
        const {
          horario_inicio,
          horario_fim,
          raio_entrega_km,
          taxa_entrega,
        } = req.body;

        await sql`
          INSERT INTO detalhes_cacambeiro (
            usuario_id,
            horario_inicio,
            horario_fim,
            raio_entrega_km,
            taxa_entrega
          )
          VALUES (
            ${usuario.id},
            ${horario_inicio},
            ${horario_fim},
            ${raio_entrega_km},
            ${taxa_entrega}
          )
        `;
      }

      return res.status(201).json(usuario);
    } catch (error) {
      /**
       * Código 23505:
       * violação de uma restrição UNIQUE do PostgreSQL.
       *
      if (error.code === "23505") {
        if (
          error.constraint &&
          error.constraint.includes("email")
        ) {
          return res.status(409).json({
            error: "Email já cadastrado",
          });
        }

        if (
          error.constraint &&
          error.constraint.includes("documento")
        ) {
          return res.status(409).json({
            error: "Documento já cadastrado",
          });
        }

        // Fallback caso o nome da constraint não esteja disponível.
        if (error.detail && error.detail.includes("email")) {
          return res.status(409).json({
            error: "Email já cadastrado",
          });
        }

        if (
          error.detail &&
          error.detail.includes("documento")
        ) {
          return res.status(409).json({
            error: "Documento já cadastrado",
          });
        }

        return res.status(409).json({
          error: "Registro duplicado",
        });
      }

      console.error("Erro no registro:", error);

      return res.status(500).json({
        error:
          "Erro interno no servidor ao tentar realizar o registro.",
      });
    }
  },

  /**
   * POST /api/auth/login
   *
   * Autentica CONSUMIDOR, CACAMBEIRO ou ADMIN.
   * Retorna um access token de curta duração e um refresh token.
   *
  async login(req, res) {
    try {
      const { email, senha } = req.body;
      const ip = getClientIp(req);

      // Defesa adicional, mesmo existindo validationMiddleware.
      if (
        typeof email !== "string" ||
        typeof senha !== "string"
      ) {
        return res.status(400).json({
          success: false,
          message: "E-mail e senha são obrigatórios.",
          code: "VALIDATION_ERROR",
        });
      }

      // Normaliza o e-mail para evitar diferenças por caixa e espaços.
      const emailNormalizado = email.trim().toLowerCase();

      /*const usuarios = await sql`
        SELECT
          id,
          nome_completo,
          email,
          senha_hash,
          tipo_perfil,
          status
          token_version
        FROM usuarios
        WHERE LOWER(email) = ${emailNormalizado}
        LIMIT 1
      `;*
      const usuarios = await sql`
        SELECT
          id,
          nome_completo,
          email,
          senha_hash,
          tipo_perfil,
          status
          token_version
        FROM usuarios
        WHERE LOWER(email) = ${emailNormalizado}
      `;

      const usuario = usuarios[0];

      /*
      * A mesma resposta é utilizada para usuário inexistente e senha
      * incorreta, evitando revelar quais e-mails estão cadastrados.
      *
      if (!usuario) {
        await recordFailedAttempt(ip);

        return res.status(401).json({
          success: false,
          message: "Credenciais inválidas.",
          code: "INVALID_CREDENTIALS",
        });
      }

      // A senha é conferida antes de revelar o status da conta.
      const senhaValida = await bcrypt.compare(
        senha,
        usuario.senha_hash,
      );

      if (!senhaValida) {
        await recordFailedAttempt(ip);

        return res.status(401).json({
          success: false,
          message: "Credenciais inválidas.",
          code: "INVALID_CREDENTIALS",
        });
      }

      // Impede que contas ainda não aprovadas iniciem uma sessão.
      if (usuario.status === "PENDENTE") {
        return res.status(403).json({
          success: false,
          message: "Seu cadastro ainda está aguardando aprovação.",
          code: "USER_PENDING",
        });
      }

      // Impede login de contas suspensas.
      if (usuario.status === "SUSPENSO") {
        return res.status(403).json({
          success: false,
          message: "Sua conta está suspensa.",
          code: "USER_SUSPENDED",
        });
      }

      /*
      * Proteção para valores inesperados ou registros antigos sem
      * status válido.
      *
      if (usuario.status !== "ATIVO") {
        return res.status(403).json({
          success: false,
          message: "Sua conta não está disponível para acesso.",
          code: "USER_INACTIVE",
        });
      }

      // Login válido: remove tentativas anteriores associadas ao IP.
      await resetAttempts(ip);

      /*
      * Access token:
      * - usado no header Authorization;
      * - possui duração curta;
      * - contém id e perfil.
      *
      const accessToken = createAccessToken(usuario);

      /*
      * Refresh token:
      * - possui duração maior;
      * - permite renovar a sessão;
      * - somente seu hash é armazenado no banco.
      *
      const refresh = await createRefreshToken(usuario.id);

      // Nunca retornar senha_hash.
      return res.status(200).json({
        success: true,
        data: {
          access_token: accessToken,
          refresh_token: refresh.refreshToken,
          token_type: "Bearer",
          expires_in: process.env.JWT_EXPIRES_IN || "15m",
          refresh_expires_at: refresh.expiresAt.toISOString(),
          usuario: {
            id: usuario.id,
            nome_completo: usuario.nome_completo,
            email: usuario.email,
            tipo_perfil: usuario.tipo_perfil,
            status: usuario.status,
          },
        },
      });
    } catch (error) {
      console.error("Erro no login:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/logout
   *
   * Adiciona o JWT atual à lista de tokens revogados.
   * Requer authMiddleware.
   *
  async logout(req, res) {
    try {
      const { refresh_token } = req.body;

      await revokeAccessToken(req.token);
      await revokeRefreshToken(refresh_token);

      return res.status(200).json({
        success: true,
        message: "Logout realizado com sucesso.",
        data: null,
      });
    } catch (error) {
      console.error("Erro no logout:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/forgot-password
   *
   * Gera um token de recuperação com validade de 15 minutos.
   *
   * A resposta é sempre igual, independentemente de o e-mail
   * existir, evitando revelar quais contas estão cadastradas.
   *
  async forgotPassword(req, res) {
    try {
      const result = await createPasswordRecovery(
        req.body.email,
      );

      const response = {
        success: true,
        message:
          "Se o email estiver cadastrado, você receberá instruções de recuperação.",
        data: null,
      };

      /**
       * Somente para desenvolvimento acadêmico.
       * Em produção, o token deverá ser enviado por e-mail.
       *
      if (
        result &&
        process.env.EXPOSE_RECOVERY_TOKEN === "true" &&
        process.env.NODE_ENV !== "production"
      ) {
        response.data = {
          recovery_token: result.token,
          expires_at: result.expiresAt,
        };
      }

      return res.status(200).json(response);
    } catch (error) {
      console.error("Erro no forgot-password:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  /**
   * POST /api/auth/reset-password
   *
   * Valida o token de recuperação e atualiza a senha.
   *
  async resetPassword(req, res) {
    try {
      const { token, nova_senha } = req.body;

      const hasUppercase = /[A-Z]/.test(nova_senha);
      const hasLowercase = /[a-z]/.test(nova_senha);
      const hasDigit = /\d/.test(nova_senha);

      if (
        nova_senha.length < 8 ||
        !hasUppercase ||
        !hasLowercase ||
        !hasDigit
      ) {
        return res.status(400).json({
          success: false,
          message:
            "A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, uma minúscula e um número.",
          code: "WEAK_PASSWORD",
        });
      }

      const changed = await persistPasswordReset({
        token,
        newPassword: nova_senha,
      });

      if (!changed) {
        return res.status(400).json({
          success: false,
          message: "Token inválido, expirado ou já utilizado.",
          code: "INVALID_RECOVERY_TOKEN",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Senha atualizada com sucesso.",
        data: null,
      });
    } catch (error) {
      console.error("Erro no reset-password:", error);

      return res.status(500).json({
        success: false,
        message: "Erro interno no servidor.",
        code: "INTERNAL_SERVER_ERROR",
      });
    }
  },

  async refresh(req, res) {
  try {
    const { refresh_token } = req.body;

    const rotated = await rotateRefreshToken(refresh_token);

    if (!rotated) {
      return res.status(401).json({
        success: false,
        message: "Refresh token inválido, expirado ou já utilizado.",
        code: "INVALID_REFRESH_TOKEN",
      });
    }

    const accessToken = createAccessToken(rotated.usuario);

    return res.status(200).json({
      success: true,
      data: {
        access_token: accessToken,
        refresh_token: rotated.refreshToken,
        token_type: "Bearer",
        expires_in: process.env.JWT_EXPIRES_IN || "15m",
        usuario: {
          id: rotated.usuario.id,
          nome_completo: rotated.usuario.nome_completo,
          email: rotated.usuario.email,
          tipo_perfil: rotated.usuario.tipo_perfil,
          status: rotated.usuario.status,
        },
      },
    });
  } catch (error) {
    console.error("Erro ao renovar sessão:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno ao renovar a sessão.",
      code: "INTERNAL_SERVER_ERROR",
    });
  }
},
};

/**
 * Exportado somente para os testes automatizados atuais.
 * Não deve ser usado por controllers ou rotas da aplicação.
 *
authController._recoveryTokens = recoveryTokens;

module.exports = authController;
*/