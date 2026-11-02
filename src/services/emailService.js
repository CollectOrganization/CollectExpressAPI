/*
 * Envio de e-mail.
 *
 * Drivers (EMAIL_DRIVER):
 * - brevo   API HTTPS do Brevo (plano gratuito). Usa fetch, como o
 *           abacatePayService, e não depende de porta SMTP.
 * - console só registra no log. É o padrão quando não há BREVO_API_KEY,
 *           para dev e testes não enviarem nada de verdade.
 *
 * Variáveis:
 * - BREVO_API_KEY    chave da API (Brevo > SMTP & API > API Keys).
 * - EMAIL_FROM       remetente; precisa estar verificado no Brevo.
 * - EMAIL_FROM_NAME  nome exibido (padrão: Collect Express).
 */

const BREVO_URL = "https://api.brevo.com/v3/smtp/email";
const TIMEOUT_MS = 15000;

const REMETENTE_PADRAO = "collectexpress.app@gmail.com";

class EmailError extends Error {
  constructor(message) {
    super(message);
    this.name = "EmailError";
  }
}

function driverAtual() {
  const configurado = process.env.EMAIL_DRIVER?.trim().toLowerCase();

  if (configurado) {
    return configurado;
  }

  return process.env.BREVO_API_KEY ? "brevo" : "console";
}

function remetente() {
  return {
    email: process.env.EMAIL_FROM?.trim() || REMETENTE_PADRAO,
    name: process.env.EMAIL_FROM_NAME?.trim() || "Collect Express",
  };
}

async function enviarPeloBrevo({ para, nome, assunto, html, texto, anexos }) {
  const apiKey = process.env.BREVO_API_KEY?.trim();

  if (!apiKey) {
    throw new EmailError("BREVO_API_KEY não configurada.");
  }

  const corpo = {
    sender: remetente(),
    to: [{ email: para, ...(nome ? { name: nome } : {}) }],
    subject: assunto,
    htmlContent: html,
    textContent: texto,
  };

  if (anexos?.length) {
    corpo.attachment = anexos.map((anexo) => ({
      name: anexo.nome,
      content: Buffer.from(anexo.conteudo).toString("base64"),
    }));
  }

  let resposta;

  try {
    resposta = await fetch(BREVO_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new EmailError(`Brevo indisponível: ${error.message}`);
  }

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => "");

    // O corpo do erro não leva a chave nem o conteúdo do e-mail.
    throw new EmailError(
      `Brevo recusou o envio (${resposta.status}): ${detalhe.slice(0, 300)}`,
    );
  }
}

/**
 * Envia um e-mail. Lança EmailError se o envio falhar; quem chama
 * decide o que fazer (as notificações só registram o erro).
 *
 * @param {object} mensagem
 * @param {string} mensagem.para
 * @param {string} [mensagem.nome]
 * @param {string} mensagem.assunto
 * @param {string} mensagem.html
 * @param {string} mensagem.texto
 * @param {Array<{nome: string, conteudo: Buffer}>} [mensagem.anexos]
 */
async function enviarEmail(mensagem) {
  if (!mensagem?.para) {
    throw new EmailError("Destinatário não informado.");
  }

  const driver = driverAtual();

  if (driver === "brevo") {
    return enviarPeloBrevo(mensagem);
  }

  if (driver === "console") {
    console.log(
      `[email:console] para=${mensagem.para} assunto="${mensagem.assunto}"` +
        (mensagem.anexos?.length
          ? ` anexos=${mensagem.anexos.map((a) => a.nome).join(",")}`
          : ""),
    );

    return undefined;
  }

  throw new EmailError(`Driver de e-mail desconhecido: ${driver}`);
}

module.exports = {
  EmailError,
  enviarEmail,
};
