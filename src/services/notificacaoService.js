/*
 * Notificações por e-mail a cada passo do aluguel.
 *
 * `notificar` nunca bloqueia nem lança: é chamado depois que a operação
 * principal já foi gravada, e um e-mail que falhar só vira log.
 */

const sql = require("../config/db");

const { enviarEmail } = require("./emailService");
const { montarEmail } = require("./emailTemplates");
const {
  codigoDoPedido,
  emitirContrato,
} = require("./contratoService");
const {
  formatarMoeda,
  formatarData,
} = require("./contratoPdfService");

const EVENTOS = Object.freeze({
  PEDIDO_CRIADO: "PEDIDO_CRIADO",
  PAGAMENTO_CONFIRMADO: "PAGAMENTO_CONFIRMADO",
  ENTREGUE: "ENTREGUE",
  RETIRADA_SOLICITADA: "RETIRADA_SOLICITADA",
  FINALIZADO: "FINALIZADO",
  EXTENSAO_SOLICITADA: "EXTENSAO_SOLICITADA",
  EXTENSAO_ACEITA: "EXTENSAO_ACEITA",
  EXTENSAO_RECUSADA: "EXTENSAO_RECUSADA",
  EXTENSAO_PAGA: "EXTENSAO_PAGA",
  EXTENSAO_SEM_RESPOSTA: "EXTENSAO_SEM_RESPOSTA",
  EXTENSAO_PAGAMENTO_EXPIRADO: "EXTENSAO_PAGAMENTO_EXPIRADO",
});

/** Evento correspondente a cada novo status do aluguel. */
const EVENTO_POR_STATUS = Object.freeze({
  EM_USO: EVENTOS.ENTREGUE,
  AGUARDANDO_RETIRADA: EVENTOS.RETIRADA_SOLICITADA,
  FINALIZADO: EVENTOS.FINALIZADO,
});

function urlDoApp() {
  return process.env.FRONTEND_URL?.trim() || null;
}

async function carregarDadosDoPedido(aluguelId) {
  const rows = await sql`
    SELECT
      a.id,
      a.data_inicio,
      a.dias_aluguel,
      a.preco_final,

      consumidor.nome_completo AS consumidor_nome,
      consumidor.email AS consumidor_email,

      cacambeiro.nome_completo AS cacambeiro_nome,
      cacambeiro.email AS cacambeiro_email,

      e.logradouro,
      e.numero,
      e.bairro,
      e.cidade_estado

    FROM alugueis a

    INNER JOIN usuarios consumidor
      ON consumidor.id = a.consumidor_id

    INNER JOIN usuarios cacambeiro
      ON cacambeiro.id = a.cacambeiro_id

    INNER JOIN enderecos e
      ON e.id = a.endereco_id

    WHERE a.id = ${aluguelId}
  `;

  return rows[0] ?? null;
}

function enderecoEmTexto(pedido) {
  return (
    `${pedido.logradouro}, ${pedido.numero} - ${pedido.bairro}, ` +
    `${pedido.cidade_estado}`
  );
}

function formatarDataHoraBr(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);

  return Number.isNaN(data.getTime())
    ? "-"
    : data.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      });
}

/**
 * Monta as mensagens de um evento. Cada item tem o destinatário e o
 * conteúdo; anexos só vão quando informados.
 */
function montarMensagens(evento, pedido, contexto = {}) {
  const codigo = codigoDoPedido(pedido.id);
  const app = urlDoApp();
  const botaoApp = app ? { texto: "Abrir o aplicativo", url: app } : undefined;

  const detalhesPedido = [
    ["Pedido", codigo],
    ["Endereço de entrega", enderecoEmTexto(pedido)],
    ["Início", formatarData(pedido.data_inicio)],
    ["Valor total", formatarMoeda(pedido.preco_final)],
  ];

  const paraConsumidor = (assunto, conteudo, anexos) => ({
    para: pedido.consumidor_email,
    nome: pedido.consumidor_nome,
    assunto,
    anexos,
    ...montarEmail({
      saudacao: `Olá, ${pedido.consumidor_nome}.`,
      botao: botaoApp,
      ...conteudo,
    }),
  });

  const paraCacambeiro = (assunto, conteudo, anexos) => ({
    para: pedido.cacambeiro_email,
    nome: pedido.cacambeiro_nome,
    assunto,
    anexos,
    ...montarEmail({
      saudacao: `Olá, ${pedido.cacambeiro_nome}.`,
      botao: botaoApp,
      ...conteudo,
    }),
  });

  const extensao = contexto.extensao;

  const detalhesExtensao = extensao
    ? [
        ["Pedido", codigo],
        ["Dias adicionais", String(extensao.dias_adicionais)],
        ["Valor da extensão", formatarMoeda(extensao.valor)],
      ]
    : [];

  switch (evento) {
    case EVENTOS.PEDIDO_CRIADO: {
      const anexos = contexto.contratoPdf
        ? [
            {
              nome: `contrato-${codigo}.pdf`,
              conteudo: contexto.contratoPdf,
            },
          ]
        : undefined;

      return [
        paraConsumidor(
          `Pedido ${codigo} recebido`,
          {
            titulo: "Seu pedido foi registrado",
            paragrafos: [
              "Recebemos o seu pedido de locação e o contrato assinado segue em anexo. Para confirmar, conclua o pagamento por PIX no aplicativo.",
            ],
            detalhes: detalhesPedido,
          },
          anexos,
        ),
        paraCacambeiro(
          `Novo pedido ${codigo}`,
          {
            titulo: "Você recebeu um novo pedido",
            paragrafos: [
              `${pedido.consumidor_nome} solicitou uma locação. O contrato assinado segue em anexo.`,
            ],
            detalhes: detalhesPedido,
          },
          anexos,
        ),
      ];
    }

    case EVENTOS.PAGAMENTO_CONFIRMADO:
      return [
        paraConsumidor(`Pagamento do pedido ${codigo} confirmado`, {
          titulo: "Pagamento confirmado",
          paragrafos: [
            "Recebemos o seu pagamento. O fornecedor fará a entrega na data combinada.",
          ],
          detalhes: detalhesPedido,
        }),
        paraCacambeiro(`Pedido ${codigo} pago`, {
          titulo: "Pagamento confirmado",
          paragrafos: [
            `${pedido.consumidor_nome} pagou o pedido. Providencie a entrega na data de início.`,
          ],
          detalhes: detalhesPedido,
        }),
      ];

    case EVENTOS.ENTREGUE:
      return [
        paraConsumidor(`Caçamba entregue - pedido ${codigo}`, {
          titulo: "Caçamba entregue",
          paragrafos: [
            "O fornecedor informou que a caçamba foi entregue no seu endereço. O prazo da locação está em andamento.",
          ],
          detalhes: detalhesPedido,
        }),
      ];

    case EVENTOS.RETIRADA_SOLICITADA:
      return [
        paraConsumidor(`Retirada da caçamba - pedido ${codigo}`, {
          titulo: "Retirada a caminho",
          paragrafos: [
            "O fornecedor vai retirar a caçamba do seu endereço. Mantenha o acesso livre.",
          ],
          detalhes: detalhesPedido,
        }),
      ];

    case EVENTOS.FINALIZADO:
      return [
        paraConsumidor(`Pedido ${codigo} finalizado`, {
          titulo: "Locação finalizada",
          paragrafos: [
            "A locação foi concluída. Obrigado por usar a Collect Express! Avalie o fornecedor no aplicativo.",
          ],
          detalhes: detalhesPedido,
        }),
      ];

    case EVENTOS.EXTENSAO_SOLICITADA:
      return [
        paraCacambeiro(`Pedido de extensão - ${codigo}`, {
          titulo: "Pedido de extensão de aluguel",
          paragrafos: [
            `${pedido.consumidor_nome} quer estender a locação. Aceite ou recuse até ${formatarDataHoraBr(extensao.solicitacao_expira_em)}.`,
          ],
          detalhes: detalhesExtensao,
          botao: contexto.linkResposta
            ? { texto: "Responder ao pedido", url: contexto.linkResposta }
            : botaoApp,
        }),
      ];

    case EVENTOS.EXTENSAO_ACEITA:
      return [
        paraConsumidor(`Extensão aceita - ${codigo}`, {
          titulo: "Sua extensão foi aceita",
          paragrafos: [
            `O fornecedor aceitou. Você tem até ${formatarDataHoraBr(extensao.pagamento_expira_em)} (24 horas) para pagar no aplicativo. Sem o pagamento, a renovação é cancelada.`,
          ],
          detalhes: detalhesExtensao,
        }),
      ];

    case EVENTOS.EXTENSAO_RECUSADA:
      return [
        paraConsumidor(`Extensão não aceita - ${codigo}`, {
          titulo: "O fornecedor não aceitou a extensão",
          paragrafos: [
            "A locação segue com o prazo original. Combine a retirada da caçamba com o fornecedor.",
          ],
          detalhes: detalhesExtensao,
        }),
      ];

    case EVENTOS.EXTENSAO_PAGA:
      return [
        paraConsumidor(`Extensão confirmada - ${codigo}`, {
          titulo: "Extensão confirmada",
          paragrafos: [
            `Pagamento recebido. A locação foi estendida em ${extensao.dias_adicionais} dia(s).`,
          ],
          detalhes: detalhesExtensao,
        }),
        paraCacambeiro(`Extensão paga - ${codigo}`, {
          titulo: "Extensão paga",
          paragrafos: [
            `${pedido.consumidor_nome} pagou a extensão de ${extensao.dias_adicionais} dia(s). A retirada deve ser reagendada.`,
          ],
          detalhes: detalhesExtensao,
        }),
      ];

    case EVENTOS.EXTENSAO_SEM_RESPOSTA:
      return [
        paraConsumidor(`Extensão cancelada - ${codigo}`, {
          titulo: "Pedido de extensão cancelado",
          paragrafos: [
            "O fornecedor não respondeu a tempo e o pedido de extensão foi cancelado. A locação segue com o prazo original.",
          ],
          detalhes: detalhesExtensao,
        }),
        paraCacambeiro(`Pedido de extensão expirou - ${codigo}`, {
          titulo: "Pedido de extensão expirado",
          paragrafos: [
            "O pedido de extensão não foi respondido a tempo e foi cancelado.",
          ],
          detalhes: detalhesExtensao,
        }),
      ];

    case EVENTOS.EXTENSAO_PAGAMENTO_EXPIRADO:
      return [
        paraConsumidor(`Renovação cancelada - ${codigo}`, {
          titulo: "Renovação cancelada",
          paragrafos: [
            "O prazo de 24 horas para pagar a extensão terminou e a renovação foi cancelada. A locação segue com o prazo original.",
          ],
          detalhes: detalhesExtensao,
        }),
        paraCacambeiro(`Renovação não paga - ${codigo}`, {
          titulo: "Renovação cancelada",
          paragrafos: [
            `${pedido.consumidor_nome} não pagou a extensão no prazo e ela foi cancelada.`,
          ],
          detalhes: detalhesExtensao,
        }),
      ];

    default:
      return [];
  }
}

/**
 * Envia os e-mails de um evento e devolve quantos foram enviados.
 * Falhas individuais são registradas e não interrompem as demais.
 */
async function notificarAguardando(evento, aluguelId, contexto = {}) {
  const pedido = await carregarDadosDoPedido(aluguelId);

  if (!pedido) {
    return 0;
  }

  // Pedido recém-criado: se o PDF não veio, tenta gerar/ler agora.
  const ctx = { ...contexto };

  if (evento === EVENTOS.PEDIDO_CRIADO && !ctx.contratoPdf) {
    try {
      ctx.contratoPdf = await emitirContrato(aluguelId);
    } catch (error) {
      console.error("Contrato indisponível para anexar:", error.message);
    }
  }

  let enviados = 0;

  for (const mensagem of montarMensagens(evento, pedido, ctx)) {
    try {
      await enviarEmail(mensagem);
      enviados += 1;
    } catch (error) {
      console.error(
        `Falha ao enviar e-mail (${evento}) para ${mensagem.para}:`,
        error.message,
      );
    }
  }

  return enviados;
}

/** Dispara e esquece: nunca lança e não bloqueia quem chamou. */
function notificar(evento, aluguelId, contexto) {
  notificarAguardando(evento, aluguelId, contexto).catch((error) => {
    console.error(`Falha ao notificar ${evento}:`, error.message);
  });
}

module.exports = {
  EVENTOS,
  EVENTO_POR_STATUS,
  montarMensagens,
  notificar,
  notificarAguardando,
};
