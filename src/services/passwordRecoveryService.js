/*
 * Recuperação de senha por código de 6 dígitos.
 *
 * 1. POST /api/auth/forgot-password { identifier, channel }
 *    Gera um pedido (request_id) e envia o código para o e-mail da conta.
 * 2. POST /api/auth/reset-password { request_id, code, nova_senha }
 *    Confere o código daquele pedido e troca a senha.
 *
 * Na tabela password_recovery_tokens, o `id` é o request_id e o
 * `token_hash` guarda o hash do código (nunca o código em si).
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const sql = require("../config/db");
const { hashToken } = require("./tokenService");
const { driverAtual, enviarEmail } = require("./emailService");
const { montarEmail } = require("./emailTemplates");

const VALIDADE_MINUTOS = 15;

/** SMS e WhatsApp estão no schema, mas ainda não têm provedor de envio. */
const CANAIS_DISPONIVEIS = ["EMAIL"];

class CanalIndisponivelError extends Error {
  constructor(channel) {
    super(`O canal ${channel} ainda não está disponível.`);
    this.name = "CanalIndisponivelError";
  }
}

/** 000000 a 999999, com zeros à esquerda. */
function gerarCodigo() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/*
 * O hash leva o request_id junto: o mesmo código em dois pedidos não
 * colide no token_hash (UNIQUE), e um código só vale para o seu pedido.
 */
function hashDoCodigo(requestId, code) {
  return hashToken(`${requestId}:${code}`);
}

/** "maria@reformas.com" vira "ma***@reformas.com". */
function mascararEmail(email) {
  const [usuario, dominio] = email.split("@");

  if (!usuario || !dominio) {
    return null;
  }

  return `${usuario.slice(0, usuario.length > 2 ? 2 : 1)}***@${dominio}`;
}

/*
 * Sem provedor de e-mail (driver console) e fora de produção, ninguém
 * receberia o código; então ele volta na resposta, para testar o fluxo.
 * Com o Brevo configurado, ou em produção, nunca volta.
 */
function devolveCodigoNaResposta() {
  return (
    process.env.NODE_ENV !== "production" && driverAtual() === "console"
  );
}

function mensagemDoCodigo(usuario, code) {
  return {
    para: usuario.email,
    nome: usuario.nome_completo,
    assunto: "Seu código para redefinir a senha",
    ...montarEmail({
      titulo: "Redefinição de senha",
      saudacao: `Olá, ${usuario.nome_completo}.`,
      paragrafos: [
        "Recebemos um pedido para redefinir a senha da sua conta.",
        `Digite o código abaixo no aplicativo. Ele vale por ${VALIDADE_MINUTOS} minutos e só pode ser usado uma vez.`,
        "Se não foi você, ignore este e-mail: sua senha continua a mesma.",
      ],
      detalhes: [["Código", code]],
    }),
  };
}

/**
 * Cria um pedido de recuperação e envia o código por e-mail.
 *
 * A resposta é igual exista a conta ou não (mesmo formato, request_id
 * novo e o e-mail digitado mascarado), para não revelar quem tem cadastro.
 *
 * @returns {Promise<{requestId: string, destinationMasked: string|null, developmentCode: string|null}>}
 */
async function createPasswordRecovery({ identifier, channel }) {
  if (!CANAIS_DISPONIVEIS.includes(channel)) {
    throw new CanalIndisponivelError(channel);
  }

  const email = String(identifier ?? "").trim().toLowerCase();
  const requestId = crypto.randomUUID();
  const resultado = {
    requestId,
    destinationMasked: mascararEmail(email),
    developmentCode: null,
  };

  const [usuario] = await sql`
    SELECT id, nome_completo, email, status
    FROM usuarios
    WHERE LOWER(email) = ${email}
  `;

  // A suspensão já invalida os códigos pendentes; não gera outro.
  if (!usuario || String(usuario.status).toUpperCase() === "SUSPENSO") {
    return resultado;
  }

  const code = gerarCodigo();
  const expiresAt = new Date(Date.now() + VALIDADE_MINUTOS * 60 * 1000);

  // Pedir um código novo invalida os anteriores.
  await sql`
    WITH invalidated AS (
      UPDATE password_recovery_tokens
      SET used_at = NOW()
      WHERE usuario_id = ${usuario.id}
        AND used_at IS NULL
      RETURNING id
    )
    INSERT INTO password_recovery_tokens (
      id,
      usuario_id,
      token_hash,
      expires_at
    )
    VALUES (
      ${requestId},
      ${usuario.id},
      ${hashDoCodigo(requestId, code)},
      ${expiresAt}
    )
  `;

  // Sem await: a resposta não espera o Brevo, e o tempo de resposta não
  // fica diferente para quem tem conta.
  enviarEmail(mensagemDoCodigo(usuario, code)).catch((error) => {
    console.error(
      `Falha ao enviar o código de recuperação para ${usuario.email}:`,
      error.message,
    );
  });

  if (devolveCodigoNaResposta()) {
    resultado.developmentCode = code;
  }

  return resultado;
}

/**
 * Troca a senha se o código do pedido estiver certo, valendo e sem uso.
 *
 * Também invalida os outros códigos do usuário, incrementa token_version
 * e revoga os refresh tokens (todas as sessões abertas saem).
 *
 * @returns {Promise<boolean>} `false` se o código não valer.
 */
async function resetPassword({ requestId, code, newPassword }) {
  const tokenHash = hashDoCodigo(requestId, code);
  const passwordHash = await bcrypt.hash(newPassword, 10);

  const result = await sql`
    WITH valid_token AS (
      UPDATE password_recovery_tokens
      SET used_at = NOW()
      WHERE id = ${requestId}
        AND token_hash = ${tokenHash}
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING usuario_id
    ),
    updated_user AS (
      UPDATE usuarios u
      SET
        senha_hash = ${passwordHash},
        token_version = token_version + 1
      FROM valid_token vt
      WHERE u.id = vt.usuario_id
      RETURNING u.id
    ),
    invalidated_recovery_tokens AS (
      UPDATE password_recovery_tokens pr
      SET used_at = NOW()
      FROM valid_token vt
      WHERE pr.usuario_id = vt.usuario_id
        AND pr.used_at IS NULL
      RETURNING pr.id
    ),
    revoked_refresh_tokens AS (
      UPDATE refresh_tokens rt
      SET revoked_at = NOW()
      FROM valid_token vt
      WHERE rt.usuario_id = vt.usuario_id
        AND rt.revoked_at IS NULL
      RETURNING rt.id
    )
    SELECT id
    FROM updated_user
  `;

  return result.length > 0;
}

module.exports = {
  CANAIS_DISPONIVEIS,
  CanalIndisponivelError,
  VALIDADE_MINUTOS,
  createPasswordRecovery,
  resetPassword,
};
