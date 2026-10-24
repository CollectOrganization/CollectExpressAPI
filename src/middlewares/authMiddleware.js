const jwt = require("jsonwebtoken");

const sql = require("../config/db");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Token inválido ou expirado.",
      code: "INVALID_ACCESS_TOKEN",
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Token inválido ou expirado.",
      code: "INVALID_ACCESS_TOKEN",
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET,
    );

    const revoked = await sql`
      SELECT 1
      FROM revoked_tokens
      WHERE token = ${token}
      LIMIT 1
    `;

    if (revoked.length > 0) {
      return res.status(401).json({
        success: false,
        message: "Token revogado.",
        code: "REVOKED_ACCESS_TOKEN",
      });
    }

    const users = await sql`
      SELECT
        id,
        tipo_perfil,
        status,
        token_version
      FROM usuarios
      WHERE id = ${decoded.id}
    `;

    const user = users[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Usuário não encontrado.",
        code: "USER_NOT_FOUND",
      });
    }

    /*
    * A verificação de `token_version` vem ANTES do `status` de
    * propósito.
    *
    * Motivo: toda suspensão incrementa `token_version`. Portanto,
    * qualquer token emitido antes da suspensão está estruturalmente
    * inválido. Retornamos 401 (sessão encerrada) para que o cliente
    * saiba que precisa reautenticar.
    *
    * O 403 USER_NOT_ACTIVE só aparece quando um usuário suspenso
    * ainda consegue apresentar um token válido — caso raro, mas
    * possível (ex.: conta suspensa manualmente no banco sem
    * incrementar `token_version`).
    */
    if (
      Number(decoded.token_version) !==
      Number(user.token_version)
    ) {
      return res.status(401).json({
        success: false,
        message: "Sua sessão foi encerrada. Entre novamente.",
        code: "SESSION_INVALIDATED",
      });
    }

    if (user.status !== "ATIVO") {
      return res.status(403).json({
        success: false,
        message: "Usuário sem acesso ao sistema.",
        code: "USER_NOT_ACTIVE",
      });
    }
    /*
    if (user.status !== "ATIVO") {
      return res.status(403).json({
        success: false,
        message: "Usuário sem acesso ao sistema.",
        code: "USER_NOT_ACTIVE",
      });
    }

    if (
      Number(decoded.token_version) !==
      Number(user.token_version)
    ) {
      return res.status(401).json({
        success: false,
        message: "Sua sessão foi encerrada. Entre novamente.",
        code: "SESSION_INVALIDATED",
      });
    }*/

    req.usuario_id = user.id;
    req.tipo_perfil = user.tipo_perfil;
    req.token = token;

    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token inválido ou expirado.",
      code: "INVALID_ACCESS_TOKEN",
    });
  }
}

module.exports = authMiddleware;