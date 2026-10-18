const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const sql = require("../config/db");
const { hashToken } = require("./tokenService");

function createRecoveryToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function createPasswordRecovery(email) {
  const normalizedEmail = email.trim().toLowerCase();

  const users = await sql`
    SELECT id
    FROM usuarios
    WHERE LOWER(email) = ${normalizedEmail}
  `;

  if (users.length === 0) {
    return null;
  }

  const userId = users[0].id;
  const token = createRecoveryToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await sql`
    WITH invalidated AS (
      UPDATE password_recovery_tokens
      SET used_at = NOW()
      WHERE usuario_id = ${userId}
        AND used_at IS NULL
      RETURNING id
    )
    INSERT INTO password_recovery_tokens (
      usuario_id,
      token_hash,
      expires_at
    )
    VALUES (
      ${userId},
      ${tokenHash},
      ${expiresAt}
    )
  `;

  return {
    token,
    expiresAt,
  };
}

async function resetPassword({
  token,
  newPassword,
}) {
  const tokenHash = hashToken(token);
  const passwordHash = await bcrypt.hash(newPassword, 10);

  const result = await sql`
    WITH valid_token AS (
      UPDATE password_recovery_tokens
      SET used_at = NOW()
      WHERE token_hash = ${tokenHash}
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
  createPasswordRecovery,
  resetPassword,
};