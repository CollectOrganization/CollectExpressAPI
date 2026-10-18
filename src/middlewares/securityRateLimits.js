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
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
});

const passwordRecoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
});

const refreshTokenLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: standardHandler,
});

module.exports = {
  loginLimiter,
  registerLimiter,
  passwordRecoveryLimiter,
  refreshTokenLimiter,
};