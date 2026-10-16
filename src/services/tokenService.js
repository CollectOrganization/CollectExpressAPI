const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const sql = require("../config/db");

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

function createOpaqueToken() {
  return crypto.randomBytes(48).toString("hex");
}

function createAccessToken(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      tipo_perfil: usuario.tipo_perfil,

      // Garante que dois access tokens emitidos no mesmo segundo
      // ainda sejam diferentes.
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
    },
  );
}

function getRefreshExpiration() {
  const expiresInDays = Math.max(
    1,
    Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 30,
  );

  return new Date(
    Date.now() + expiresInDays * 24 * 60 * 60 * 1000,
  );
}

async function createRefreshToken(usuarioId) {
  const refreshToken = createOpaqueToken();
  const tokenHash = hashToken(refreshToken);
  const expiresAt = getRefreshExpiration();

  await sql`
    INSERT INTO refresh_tokens (
      usuario_id,
      token_hash,
      expires_at
    )
    VALUES (
      ${usuarioId},
      ${tokenHash},
      ${expiresAt}
    )
  `;

  return {
    refreshToken,
    expiresAt,
  };
}

/**
 * Revoga o refresh token atual e cria outro atomicamente.
 *
 * Como tudo ocorre em uma única instrução SQL, apenas uma tentativa
 * concorrente consegue utilizar o token atual.
 */
async function rotateRefreshToken(currentToken) {
  const currentHash = hashToken(currentToken);
  const newToken = createOpaqueToken();
  const newHash = hashToken(newToken);
  const expiresAt = getRefreshExpiration();

  const rows = await sql`
    WITH revoked AS (
      UPDATE refresh_tokens rt
      SET revoked_at = NOW()
      FROM usuarios u
      WHERE rt.usuario_id = u.id
        AND rt.token_hash = ${currentHash}
        AND rt.revoked_at IS NULL
        AND rt.expires_at > NOW()
        AND u.status = 'ATIVO'
      RETURNING rt.usuario_id
    ),
    inserted AS (
      INSERT INTO refresh_tokens (
        usuario_id,
        token_hash,
        expires_at
      )
      SELECT
        usuario_id,
        ${newHash},
        ${expiresAt}
      FROM revoked
      RETURNING usuario_id
    )
    SELECT
      u.id,
      u.nome_completo,
      u.email,
      u.tipo_perfil,
      u.status
    FROM inserted i
    JOIN usuarios u ON u.id = i.usuario_id
  `;

  if (rows.length === 0) {
    return null;
  }

  return {
    usuario: rows[0],
    refreshToken: newToken,
    expiresAt,
  };
}

async function revokeRefreshToken(token) {
  if (!token) return;

  await sql`
    UPDATE refresh_tokens
    SET revoked_at = NOW()
    WHERE token_hash = ${hashToken(token)}
      AND revoked_at IS NULL
  `;
}

async function revokeAllUserRefreshTokens(usuarioId) {
  await sql`
    UPDATE refresh_tokens
    SET revoked_at = NOW()
    WHERE usuario_id = ${usuarioId}
      AND revoked_at IS NULL
  `;
}

async function revokeAccessToken(token) {
  if (!token) return;

  const decoded = jwt.decode(token);
  const expiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : null;

  await sql`
    INSERT INTO revoked_tokens (
      token,
      revoked_at,
      expires_at
    )
    VALUES (
      ${token},
      NOW(),
      ${expiresAt}
    )
    ON CONFLICT (token) DO NOTHING
  `;
}

module.exports = {
  hashToken,
  createAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  revokeAccessToken,
};