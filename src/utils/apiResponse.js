function sendSuccess(
  res,
  data,
  statusCode = 200,
  message = undefined,
) {
  return res.status(statusCode).json({
    success: true,
    ...(message ? { message } : {}),
    data,
  });
}

function sendError(
  res,
  statusCode,
  message,
  code = "API_ERROR",
  fields = undefined,
) {
  return res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(fields ? { fields } : {}),
  });
}

module.exports = {
  sendSuccess,
  sendError,
};