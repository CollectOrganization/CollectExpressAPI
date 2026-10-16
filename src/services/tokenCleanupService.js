const sql = require("../config/db");

async function cleanupExpiredTokens() {
  try {
    await sql`
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW()
         OR revoked_at < NOW() - INTERVAL '7 days'
    `;

    await sql`
      DELETE FROM password_recovery_tokens
      WHERE expires_at < NOW()
         OR used_at < NOW() - INTERVAL '1 day'
    `;

    await sql`
      DELETE FROM revoked_tokens
      WHERE expires_at IS NOT NULL
        AND expires_at < NOW()
    `;

    console.log("Limpeza de tokens concluída.");
  } catch (error) {
    console.error("Erro ao limpar tokens:", error);
  }
}

function startTokenCleanup() {
  cleanupExpiredTokens();

  const interval = setInterval(
    cleanupExpiredTokens,
    60 * 60 * 1000,
  );

  // Não impede o Node de finalizar.
  interval.unref();
}

module.exports = {
  cleanupExpiredTokens,
  startTokenCleanup,
};