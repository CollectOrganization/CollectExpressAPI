class ApiError extends Error {
  constructor(
    statusCode,
    message,
    code = "API_ERROR",
    fields = undefined,
  ) {
    super(message);

    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

module.exports = ApiError;