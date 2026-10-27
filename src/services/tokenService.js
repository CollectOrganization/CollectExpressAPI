const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const sql = require("../config/db");

/**
 * Gera um hash SHA-256 para que o refresh token original
 * nunca seja armazenado no banco.
 */
function hashToken(token) {
  if (typeof token !== "string" || !token) {
    throw new TypeError("Token inválido para geração de hash.");
  }

  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

/**
 * Gera um token opaco de 96 caracteres hexadecimais.
 */
function createOpaqueToken() {
  return crypto.randomBytes(48).toString("hex");
}

/**
 * Cria o JWT de curta duração.
 *
 * token_version permite encerrar todas as sessões antigas
 * após uma troca de senha ou evento de segurança.
 */
function createAccessToken(usuario) {
  const tokenVersion = Number(usuario.token_version);

  if (
    !usuario?.id ||
    !usuario?.tipo_perfil ||
    !Number.isInteger(tokenVersion)
  ) {
    throw new Error(
      "Não foi possível gerar o access token: dados do usuário incompletos.",
    );
  }

  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET não foi configurado.");
  }

  return jwt.sign(
    {
      id: usuario.id,
      tipo_perfil: usuario.tipo_perfil,
      token_version: tokenVersion,
      jti: crypto.randomUUID(),
    },
    process.env.JWT_SECRET,
    {
      expiresIn:
        process.env.JWT_EXPIRES_IN || "15m",
    },
  );
}

/**
 * Calcula a expiração do refresh token.
 */
function getRefreshExpiration() {
  const configuredDays = Number(
    process.env.REFRESH_TOKEN_EXPIRES_DAYS,
  );

  const expiresInDays =
    Number.isFinite(configuredDays) &&
    configuredDays >= 1
      ? configuredDays
      : 30;

  return new Date(
    Date.now() +
      expiresInDays * 24 * 60 * 60 * 1000,
  );
}

/**
 * Cria e persiste um refresh token.
 */
async function createRefreshToken(usuarioId) {
  if (!usuarioId) {
    throw new Error(
      "usuarioId é obrigatório para criar refresh token.",
    );
  }

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
 * Rotaciona o refresh token atomicamente.
 *
 * O token atual é revogado e um novo é criado na mesma
 * instrução SQL. Reutilizar o token antigo retornará null.
 */
async function rotateRefreshToken(currentToken) {
  if (
    typeof currentToken !== "string" ||
    currentToken.trim().length < 20
  ) {
    return null;
  }

  const currentHash = hashToken(
    currentToken.trim(),
  );

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

        /*
         * O banco atual possui status em minúsculas.
         * A conversão torna a verificação compatível.
         */
        AND UPPER(u.status::text) = 'ATIVO'

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
      u.status,
      u.token_version
    FROM inserted i
    INNER JOIN usuarios u
      ON u.id = i.usuario_id
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

/**
 * Revoga um refresh token específico.
 */
async function revokeRefreshToken(token) {
  if (
    typeof token !== "string" ||
    token.trim().length === 0
  ) {
    return;
  }

  await sql`
    UPDATE refresh_tokens
    SET revoked_at = NOW()
    WHERE token_hash = ${hashToken(token.trim())}
      AND revoked_at IS NULL
  `;
}

/**
 * Revoga todas as sessões renováveis de um usuário.
 *
 * Útil para:
 * - troca de senha;
 * - suspensão;
 * - incidente de segurança.
 */
async function revokeAllUserRefreshTokens(usuarioId) {
  if (!usuarioId) return;

  await sql`
    UPDATE refresh_tokens
    SET revoked_at = NOW()
    WHERE usuario_id = ${usuarioId}
      AND revoked_at IS NULL
  `;
}

/**
 * Insere um access token na blacklist até sua expiração.
 */
async function revokeAccessToken(token) {
  if (
    typeof token !== "string" ||
    token.trim().length === 0
  ) {
    return;
  }

  const normalizedToken = token.trim();
  const decoded = jwt.decode(normalizedToken);

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
      ${normalizedToken},
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

//----------------- Old Version -----------------
/*const crypto = require("crypto");
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
  const tokenVersion = Number(usuario.token_version);

  if (!Number.isInteger(tokenVersion)) {
    throw new Error(
      "Não foi possível gerar o token: token_version ausente.",
    );
  }

  return jwt.sign(
    {
      id: usuario.id,
      tipo_perfil: usuario.tipo_perfil,
      token_version: tokenVersion,
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
/*
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
      u.token_version
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
}*
async function rotateRefreshToken(currentToken) {
  if (
    typeof currentToken !== "string" ||
    currentToken.trim().length < 20
  ) {
    return null;
  }

  const currentHash = hashToken(currentToken);

  /*
   * Verifica primeiro se o token existe, não expirou, não foi
   * revogado e pertence a um usuário ativo.
   *
   * Isso faz tokens revogados retornarem null sem tentar executar
   * a operação de rotação.
   *
  const eligibleTokens = await sql`
    SELECT rt.usuario_id
    FROM refresh_tokens rt
    JOIN usuarios u ON u.id = rt.usuario_id
    WHERE rt.token_hash = ${currentHash}
      AND rt.revoked_at IS NULL
      AND rt.expires_at > NOW()
      AND u.status = 'ATIVO'
    LIMIT 1
  `;

  if (eligibleTokens.length === 0) {
    return null;
  }

  const newToken = createOpaqueToken();
  const newHash = hashToken(newToken);
  const expiresAt = getRefreshExpiration();

  /*
   * A atualização continua atômica. Se duas requisições tentarem
   * reutilizar o mesmo token, somente uma conseguirá revogá-lo.
   *
  const rows = await sql`
    WITH revoked AS (
      UPDATE refresh_tokens
      SET revoked_at = NOW()
      WHERE token_hash = ${currentHash}
        AND revoked_at IS NULL
        AND expires_at > NOW()
      RETURNING usuario_id
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
      u.status,
      u.token_version
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
};*/