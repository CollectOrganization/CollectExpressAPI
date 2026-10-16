const sql = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const {
  recordFailedAttempt,
  resetAttempts,
  getClientIp,
} = require("../middlewares/rateLimitMiddleware");

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
 */
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
      } = req.body;

      /**
       * Normaliza os dados antes de salvar.
       *
       * Isso evita cadastrar e-mails como:
       * Usuario@Email.com
       * usuario@email.com
       *
       * como se fossem contas diferentes.
       */
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
       */
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
      const statusUsuario =
        tipo_perfil === "CACAMBEIRO"
          ? "PENDENTE"
          : "ATIVO";

      // Gera o hash seguro da senha com fator de custo 10.
      const senhaHash = await bcrypt.hash(senha, 10);

      /**
       * Insere o usuário.
       *
       * Atenção: usamos emailNormalizado, e não o email original.
       */
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
       */
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
       */
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
   * Autentica qualquer perfil existente:
   * - CONSUMIDOR
   * - CACAMBEIRO
   * - ADMIN
   */
  async login(req, res) {
    try {
      const { email, senha } = req.body;
      const ip = getClientIp(req);

      // Normaliza o e-mail recebido.
      const emailNormalizado = email.trim().toLowerCase();

      /**
       * Busca case-insensitive.
       *
       * Isso permite que o usuário faça login mesmo digitando
       * letras maiúsculas no e-mail.
       */
      const usuarios = await sql`
        SELECT *
        FROM usuarios
        WHERE LOWER(email) = ${emailNormalizado}
      `;

      const usuario = usuarios[0];

      if (!usuario) {
        // Aguarda o registro da tentativa antes de responder.
        await recordFailedAttempt(ip);

        return res.status(401).json({
          error: "Credenciais inválidas",
        });
      }

      if (usuario.status === "PENDENTE") {
        return res.status(403).json({
          success: false,
          message: "Seu cadastro ainda está aguardando aprovação.",
          code: "USER_PENDING",
        });
      }

      if (usuario.status === "SUSPENSO") {
        return res.status(403).json({
          success: false,
          message: "Sua conta está suspensa.",
          code: "USER_SUSPENDED",
        });
      }

      // Compara a senha informada com o hash armazenado.
      const senhaValida = await bcrypt.compare(
        senha,
        usuario.senha_hash,
      );

      if (!senhaValida) {
        await recordFailedAttempt(ip);

        return res.status(401).json({
          error: "Credenciais inválidas",
        });
      }

      // Login válido: limpa as tentativas anteriores desse IP.
      await resetAttempts(ip);

      /**
       * O token contém apenas as informações necessárias
       * para identificar e autorizar o usuário.
       */
      const payload = {
        id: usuario.id,
        tipo_perfil: usuario.tipo_perfil,
      };

      /**
       * O tempo de expiração é configurado pelo .env.
       *
       * Exemplo:
       * JWT_EXPIRES_IN=1h
       */
      const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.JWT_EXPIRES_IN || "1h",
        },
      );

      // Nunca retornar senha_hash para o frontend.
      return res.status(200).json({
        token,
        usuario: {
          id: usuario.id,
          nome_completo: usuario.nome_completo,
          email: usuario.email,
          tipo_perfil: usuario.tipo_perfil,
        },
      });
    } catch (error) {
      console.error("Erro no login:", error);

      return res.status(500).json({
        error: "Erro interno no servidor",
      });
    }
  },

  /**
   * POST /api/auth/logout
   *
   * Adiciona o JWT atual à lista de tokens revogados.
   * Requer authMiddleware.
   */
  async logout(req, res) {
    try {
      const token = req.token;

      if (token) {
        await sql`
          INSERT INTO revoked_tokens (
            token,
            revoked_at
          )
          VALUES (
            ${token},
            NOW()
          )
          ON CONFLICT DO NOTHING
        `;
      }

      return res.status(200).json({
        message: "Logout realizado com sucesso",
      });
    } catch (error) {
      console.error("Erro no logout:", error);

      return res.status(500).json({
        error: "Erro interno no servidor",
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
   */
  async forgotPassword(req, res) {
    try {
      const { email } = req.body;

      const emailNormalizado = email.trim().toLowerCase();

      const successMessage =
        "Se o email estiver cadastrado, você receberá instruções de recuperação";

      const usuarios = await sql`
        SELECT id
        FROM usuarios
        WHERE LOWER(email) = ${emailNormalizado}
      `;

      const usuario = usuarios[0];

      if (usuario) {
        /**
         * Remove tokens anteriores desse usuário.
         * Assim, apenas o token mais recente permanece válido.
         */
        for (const [key, entry] of recoveryTokens.entries()) {
          if (entry.usuario_id === usuario.id) {
            recoveryTokens.delete(key);
          }
        }

        const token = crypto
          .randomBytes(32)
          .toString("hex");

        const expiresAt = new Date(
          Date.now() + 15 * 60 * 1000,
        );

        recoveryTokens.set(token, {
          token,
          usuario_id: usuario.id,
          expires_at: expiresAt,
          used: false,
        });

        /**
         * Temporário para ambiente acadêmico.
         *
         * Em produção, o token deverá ser enviado por e-mail
         * e jamais exibido em logs.
         */
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `Token de recuperação para ${emailNormalizado}: ${token}`,
          );
        }
      }

      return res.status(200).json({
        message: successMessage,
      });
    } catch (error) {
      console.error("Erro no forgot-password:", error);

      return res.status(500).json({
        error: "Erro interno no servidor",
      });
    }
  },

  /**
   * POST /api/auth/reset-password
   *
   * Valida o token de recuperação e atualiza a senha.
   */
  async resetPassword(req, res) {
    try {
      const { token, nova_senha } = req.body;

      const tokenEntry = recoveryTokens.get(token);

      /**
       * Verifica se:
       * - o token existe;
       * - ainda não foi usado;
       * - não está expirado.
       */
      if (
        !tokenEntry ||
        tokenEntry.used ||
        new Date() > tokenEntry.expires_at
      ) {
        return res.status(400).json({
          error: "Token inválido ou expirado",
        });
      }

      /**
       * Política de senha:
       * - mínimo de 8 caracteres;
       * - uma letra maiúscula;
       * - uma letra minúscula;
       * - um número.
       */
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
          error:
            "A senha deve ter no mínimo 8 caracteres, uma letra maiúscula, uma minúscula e um dígito",
        });
      }

      const senhaHash = await bcrypt.hash(
        nova_senha,
        10,
      );

      await sql`
        UPDATE usuarios
        SET senha_hash = ${senhaHash}
        WHERE id = ${tokenEntry.usuario_id}
      `;

      // Marca o token atual como utilizado.
      tokenEntry.used = true;

      // Remove qualquer outro token do mesmo usuário.
      for (const [key, entry] of recoveryTokens.entries()) {
        if (
          entry.usuario_id === tokenEntry.usuario_id &&
          key !== token
        ) {
          recoveryTokens.delete(key);
        }
      }

      return res.status(200).json({
        message: "Senha atualizada com sucesso",
      });
    } catch (error) {
      console.error("Erro no reset-password:", error);

      return res.status(500).json({
        error: "Erro interno no servidor",
      });
    }
  },
};

/**
 * Exportado somente para os testes automatizados atuais.
 * Não deve ser usado por controllers ou rotas da aplicação.
 */
authController._recoveryTokens = recoveryTokens;

module.exports = authController;