const jwt = require("jsonwebtoken");

const { registrar } = require("../services/logService");

const NIVEIS = ["ERRO", "AVISO", "INFO"];

/** Quem enviou, se mandou um token válido. Nunca falha por causa dele. */
function usuarioDoToken(req) {
  const cabecalho = req.headers.authorization;

  if (!cabecalho?.startsWith("Bearer ")) {
    return {};
  }

  try {
    const decodificado = jwt.verify(
      cabecalho.slice(7).trim(),
      process.env.JWT_SECRET,
    );

    return { usuarioId: decodificado.id, perfil: decodificado.tipo_perfil };
  } catch (_) {
    // Token vencido: o relato vale do mesmo jeito, só sem usuário.
    return {};
  }
}

function texto(valor, limite) {
  return typeof valor === "string" ? valor.trim().slice(0, limite) : "";
}

const logsController = {
  /**
   * POST /api/logs/app
   *
   * O app Flutter relata erros que a API nunca vê (queda de rede,
   * timeout, exceção na tela). Aceita requisições sem login porque o
   * erro pode ser justamente no login. Sempre responde 202: um relato
   * perdido não pode virar outro erro para a pessoa.
   */
  async registrarDoApp(req, res) {
    const corpo = req.body && typeof req.body === "object" ? req.body : {};
    const mensagem = texto(corpo.mensagem, 1000);

    if (!mensagem) {
      return res.status(400).json({
        success: false,
        message: "Informe a mensagem do log.",
        code: "VALIDATION_ERROR",
        fields: { mensagem: "A mensagem é obrigatória." },
      });
    }

    const nivel = NIVEIS.includes(corpo.nivel) ? corpo.nivel : "ERRO";
    const codigo = texto(corpo.codigo, 80) || "APP_ERROR";
    const tela = texto(corpo.tela, 120);

    registrar(
      {
        origem: "APP",
        nivel,
        codigo,
        mensagem,
        ...usuarioDoToken(req),
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        tela,
        appVersao: texto(corpo.app_versao, 40),
        plataforma: texto(corpo.plataforma, 40),
        statusHttp: Number.isInteger(corpo.status_http)
          ? corpo.status_http
          : undefined,
        rota: texto(corpo.rota, 300),
        metodo: texto(corpo.metodo, 10),
        detalhes:
          corpo.detalhes && typeof corpo.detalhes === "object"
            ? corpo.detalhes
            : null,
      },
      ["APP", codigo, tela, mensagem.slice(0, 120)].join("|"),
    );

    return res.status(202).json({ success: true, data: { registrado: true } });
  },
};

module.exports = logsController;
