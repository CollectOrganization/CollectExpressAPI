const rateLimit = require("express-rate-limit");

function standardHandler(req, res) {
  return res.status(429).json({
    success: false,
    message: "Muitas solicitações. Tente novamente mais tarde.",
    code: "RATE_LIMIT_EXCEEDED",
  });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  skip: bypassForTests,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  skip: bypassForTests,
});

const passwordRecoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  skip: bypassForTests,
});

const refreshTokenLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
  skip: bypassForTests,
});

/**
 * Bypass controlado para testes automatizados.
 *
 * Regras:
 * - NUNCA funciona em produção, independentemente do header;
 * - só é aceito se `TEST_RATE_LIMIT_BYPASS` existir no .env;
 * - o header precisa coincidir exatamente com o segredo.
 *
 * Isso permite que o script `test:seed` execute sem esbarrar
 * no limite de login, mantendo o limiter ativo em produção.
 */
function bypassForTests(req) {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const expected = process.env.TEST_RATE_LIMIT_BYPASS;

  if (!expected) {
    return false;
  }

  return req.headers["x-test-bypass"] === expected;
}

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordRecoveryLimiter,
  refreshTokenLimiter,
  bypassForTests,
};

