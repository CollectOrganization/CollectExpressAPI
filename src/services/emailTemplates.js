/*
 * Layout comum dos e-mails (HTML simples, estilos inline).
 * Todo texto vindo do banco passa por escaparHtml.
 */

const VERDE = "#4C7A1E";

function escaparHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Só aceita links http(s), para o botão nunca virar javascript:. */
function linkSeguro(url) {
  try {
    const analisada = new URL(url);

    return ["http:", "https:"].includes(analisada.protocol)
      ? analisada.toString()
      : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} opcoes
 * @param {string} opcoes.titulo
 * @param {string} [opcoes.saudacao]
 * @param {string[]} opcoes.paragrafos
 * @param {Array<[string, string]>} [opcoes.detalhes] pares rótulo/valor.
 * @param {{texto: string, url: string}} [opcoes.botao]
 * @returns {{html: string, texto: string}}
 */
function montarEmail({
  titulo,
  saudacao,
  paragrafos,
  detalhes = [],
  botao,
}) {
  const url = botao ? linkSeguro(botao.url) : null;

  const linhasDetalhes = detalhes
    .map(
      ([rotulo, valor]) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#666;font-size:13px">${escaparHtml(rotulo)}</td>` +
        `<td style="padding:4px 0;font-size:13px;font-weight:bold">${escaparHtml(valor)}</td>` +
        `</tr>`,
    )
    .join("");

  const html =
    `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#222">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden">` +
    `<tr><td style="background:${VERDE};padding:16px 24px;color:#fff;font-size:18px;font-weight:bold">COLLECT XPRESS</td></tr>` +
    `<tr><td style="padding:24px">` +
    `<h2 style="margin:0 0 12px;font-size:19px">${escaparHtml(titulo)}</h2>` +
    (saudacao
      ? `<p style="margin:0 0 12px;font-size:14px">${escaparHtml(saudacao)}</p>`
      : "") +
    paragrafos
      .map(
        (p) =>
          `<p style="margin:0 0 12px;font-size:14px;line-height:1.5">${escaparHtml(p)}</p>`,
      )
      .join("") +
    (linhasDetalhes
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px">${linhasDetalhes}</table>`
      : "") +
    (url
      ? `<p style="margin:16px 0"><a href="${escaparHtml(url)}" style="background:${VERDE};color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-size:14px;font-weight:bold;display:inline-block">${escaparHtml(botao.texto)}</a></p>`
      : "") +
    `</td></tr>` +
    `<tr><td style="padding:12px 24px;background:#fafafa;color:#888;font-size:11px">Mensagem automática da plataforma Collect Express. Não responda a este e-mail.</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const texto = [
    titulo,
    "",
    saudacao,
    ...paragrafos,
    "",
    ...detalhes.map(([rotulo, valor]) => `${rotulo}: ${valor}`),
    url ? `\n${botao.texto}: ${url}` : "",
    "",
    "Mensagem automática da plataforma Collect Express.",
  ]
    .filter((linha) => linha !== undefined && linha !== null)
    .join("\n");

  return { html, texto };
}

module.exports = {
  escaparHtml,
  linkSeguro,
  montarEmail,
};
