/*
 * Chat de texto entre as partes do aluguel.
 *
 * Tipos de conversa:
 * - PEDIDO              cliente x caçambeiro, uma por pedido.
 * - SUPORTE_CACAMBEIRO  caçambeiro x equipe (admins), uma por caçambeiro.
 * - CHAMADO             cliente x equipe (admins), aberto pelo cliente e
 *                       fechado por um admin. Um aberto por vez.
 *
 * O lado ADMIN é compartilhado: qualquer admin lê e responde, e a mensagem
 * conta como lida para todos quando um deles abre a conversa. Nas conversas
 * de PEDIDO o admin só acompanha (leitura) e cada abertura fica registrada.
 */

const sql = require("../config/db");

const ApiError = require("../utils/apiError");
const { enviarEmail } = require("./emailService");
const { montarEmail } = require("./emailTemplates");
const { codigoDoPedido } = require("./contratoService");

const TIPOS = Object.freeze({
  PEDIDO: "PEDIDO",
  SUPORTE: "SUPORTE_CACAMBEIRO",
  CHAMADO: "CHAMADO",
});

const LADOS = Object.freeze({
  CLIENTE: "CLIENTE",
  CACAMBEIRO: "CACAMBEIRO",
  ADMIN: "ADMIN",
});

const LADO_POR_PERFIL = Object.freeze({
  CONSUMIDOR: LADOS.CLIENTE,
  CACAMBEIRO: LADOS.CACAMBEIRO,
  ADMIN: LADOS.ADMIN,
});

const NOME_SUPORTE = "Suporte CollectExpress";
const LIMITE_TEXTO = 1000;
const LIMITE_ASSUNTO = 120;
const LIMITE_MOTIVO = 300;
const POR_PAGINA = 30;
const MENSAGENS_POR_CONSULTA = 50;

/** Depois de finalizado, o pedido ainda aceita mensagens por este tempo. */
const DIAS_CONVERSA_APOS_PEDIDO = 7;

/** Tempo sem leitura até o aviso por e-mail. */
const HORAS_ATE_AVISO = 8;

function usuarioDaRequisicao(req) {
  return { id: req.usuario_id, perfil: req.tipo_perfil };
}

/**
 * Como o usuário se relaciona com a conversa, ou null se ela não é dele.
 * `observador` é o admin diante de uma conversa de pedido: só lê.
 */
function acessoA(conversa, usuario) {
  if (usuario.perfil === "ADMIN") {
    return conversa.tipo === TIPOS.PEDIDO
      ? { lado: null, observador: true }
      : { lado: LADOS.ADMIN, observador: false };
  }

  if (
    usuario.perfil === "CONSUMIDOR" &&
    conversa.consumidor_id === usuario.id
  ) {
    return { lado: LADOS.CLIENTE, observador: false };
  }

  if (
    usuario.perfil === "CACAMBEIRO" &&
    conversa.cacambeiro_id === usuario.id
  ) {
    return { lado: LADOS.CACAMBEIRO, observador: false };
  }

  return null;
}

/** Por que não dá para escrever, ou null se dá. */
function motivoBloqueio(conversa, acesso, agora = new Date()) {
  if (acesso.observador) {
    return {
      status: 403,
      codigo: "ADMIN_READ_ONLY",
      mensagem: "Administradores apenas acompanham conversas de pedidos.",
    };
  }

  if (conversa.tipo === TIPOS.CHAMADO && conversa.status === "FECHADA") {
    return {
      status: 409,
      codigo: "CONVERSATION_CLOSED",
      mensagem: "Este chamado foi encerrado. Abra um novo se precisar.",
    };
  }

  if (conversa.tipo === TIPOS.PEDIDO && conversa.encerrada_efetiva) {
    const limite = new Date(conversa.encerrada_efetiva);
    limite.setDate(limite.getDate() + DIAS_CONVERSA_APOS_PEDIDO);

    if (agora > limite) {
      return {
        status: 409,
        codigo: "CONVERSATION_CLOSED",
        mensagem:
          `A conversa ficou só para leitura ${DIAS_CONVERSA_APOS_PEDIDO} ` +
          "dias depois do fim do pedido.",
      };
    }
  }

  return null;
}

/** Nome e detalhe que o usuário vê no topo da conversa e na lista. */
function contatoVisto(conversa, perfil) {
  const codigo = conversa.aluguel_id
    ? `Pedido ${codigoDoPedido(conversa.aluguel_id)}`
    : null;

  if (perfil === "CONSUMIDOR") {
    return conversa.tipo === TIPOS.PEDIDO
      ? { nome: conversa.cacambeiro_nome, detalhe: codigo }
      : { nome: NOME_SUPORTE, detalhe: conversa.assunto };
  }

  if (perfil === "CACAMBEIRO") {
    return conversa.tipo === TIPOS.PEDIDO
      ? { nome: conversa.consumidor_nome, detalhe: codigo }
      : { nome: NOME_SUPORTE, detalhe: "Fale com a equipe" };
  }

  if (conversa.tipo === TIPOS.CHAMADO) {
    return { nome: conversa.consumidor_nome, detalhe: conversa.assunto };
  }

  if (conversa.tipo === TIPOS.SUPORTE) {
    return { nome: conversa.cacambeiro_nome, detalhe: "Suporte do fornecedor" };
  }

  return {
    nome: `${conversa.consumidor_nome} × ${conversa.cacambeiro_nome}`,
    detalhe: codigo,
  };
}

function serializarConversa(linha, usuario) {
  const acesso = acessoA(linha, usuario);
  const bloqueio = motivoBloqueio(linha, acesso);
  const contato = contatoVisto(linha, usuario.perfil);

  return {
    id: linha.id,
    tipo: linha.tipo,
    status: linha.status,
    assunto: linha.assunto,
    aluguel_id: linha.aluguel_id,
    pedido_codigo: linha.aluguel_id ? codigoDoPedido(linha.aluguel_id) : null,
    contato_nome: contato.nome,
    contato_detalhe: contato.detalhe,
    ultima_mensagem: linha.ultima_texto
      ? {
          texto: linha.ultima_texto,
          minha: linha.ultima_lado === acesso.lado,
          criada_em: linha.ultima_criada_em,
        }
      : null,
    ultima_atividade_em: linha.ultima_mensagem_em ?? linha.criada_em,
    nao_lidas: linha.nao_lidas ?? 0,
    denunciada: usuario.perfil === "ADMIN" && Boolean(linha.denunciada_em),
    pode_enviar: bloqueio === null,
    motivo_bloqueio: bloqueio?.mensagem ?? null,
    somente_leitura: acesso.observador,
    fechada_em: linha.fechada_em,
    criada_em: linha.criada_em,
  };
}

function serializarMensagem(linha, acesso, perfil) {
  return {
    id: linha.id,
    texto: linha.texto,
    lado: linha.lado,
    minha: acesso.lado !== null && linha.lado === acesso.lado,
    criada_em: linha.criada_em,
    lida: linha.lida_em !== null && linha.lida_em !== undefined,
    // Dentro da equipe, mostra qual admin respondeu.
    remetente_nome:
      perfil === "ADMIN" && linha.lado === LADOS.ADMIN
        ? (linha.remetente_nome ?? null)
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

/**
 * SELECT das conversas com nomes, última mensagem e não lidas do
 * ponto de vista de quem consulta.
 */
function selecionarConversas(usuario, filtro, ordem = sql``) {
  const lado = LADO_POR_PERFIL[usuario.perfil];
  // Admin só recebe alerta das conversas em que responde.
  const naoLidasDoAdmin =
    usuario.perfil === "ADMIN" ? sql`AND c.tipo <> 'PEDIDO'` : sql``;

  return sql`
    SELECT
      c.id, c.tipo, c.aluguel_id, c.consumidor_id, c.cacambeiro_id,
      c.assunto, c.status, c.fechada_em, c.ultima_mensagem_em,
      c.denunciada_em, c.criada_em,
      COALESCE(
        c.encerrada_em,
        CASE
          WHEN a.status_aluguel = 'FINALIZADO'
          THEN (a.data_inicio + a.dias_aluguel)::timestamptz
        END
      ) AS encerrada_efetiva,
      cons.nome_completo AS consumidor_nome,
      cac.nome_completo AS cacambeiro_nome,
      ult.texto AS ultima_texto,
      ult.lado AS ultima_lado,
      ult.criada_em AS ultima_criada_em,
      (
        SELECT COUNT(*)::int
        FROM mensagens m
        WHERE m.conversa_id = c.id
          AND m.lado <> ${lado}
          AND m.lida_em IS NULL
          ${naoLidasDoAdmin}
      ) AS nao_lidas
    FROM conversas c
    LEFT JOIN alugueis a ON a.id = c.aluguel_id
    LEFT JOIN usuarios cons ON cons.id = c.consumidor_id
    LEFT JOIN usuarios cac ON cac.id = c.cacambeiro_id
    LEFT JOIN LATERAL (
      SELECT texto, lado, criada_em
      FROM mensagens
      WHERE conversa_id = c.id
      ORDER BY id DESC
      LIMIT 1
    ) ult ON TRUE
    WHERE ${filtro}
    ${ordem}
  `;
}

function escopoDoUsuario(usuario) {
  if (usuario.perfil === "CONSUMIDOR") {
    return sql`c.consumidor_id = ${usuario.id}`;
  }

  if (usuario.perfil === "CACAMBEIRO") {
    return sql`c.cacambeiro_id = ${usuario.id}`;
  }

  return sql`TRUE`;
}

/** A conversa, se existir e o usuário puder vê-la. */
async function carregarConversa(usuario, conversaId) {
  const linhas = await selecionarConversas(
    usuario,
    sql`c.id = ${conversaId}`,
  );

  const linha = linhas[0];
  const acesso = linha ? acessoA(linha, usuario) : null;

  // Mesmo erro nos dois casos, para não revelar que a conversa existe.
  if (!linha || !acesso) {
    throw new ApiError(
      404,
      "Conversa não encontrada.",
      "CONVERSATION_NOT_FOUND",
    );
  }

  return { linha, acesso };
}

async function garantirSuporteDoCacambeiro(cacambeiroId) {
  await sql`
    INSERT INTO conversas (tipo, cacambeiro_id)
    VALUES ('SUPORTE_CACAMBEIRO', ${cacambeiroId})
    ON CONFLICT (cacambeiro_id) WHERE tipo = 'SUPORTE_CACAMBEIRO'
    DO NOTHING
  `;
}

/** O admin pode puxar conversa com qualquer fornecedor ativo. */
async function garantirSuporteDeTodos() {
  await sql`
    INSERT INTO conversas (tipo, cacambeiro_id)
    SELECT 'SUPORTE_CACAMBEIRO', u.id
    FROM usuarios u
    WHERE u.tipo_perfil = 'CACAMBEIRO' AND u.status = 'ATIVO'
    ON CONFLICT (cacambeiro_id) WHERE tipo = 'SUPORTE_CACAMBEIRO'
    DO NOTHING
  `;
}

function normalizarPagina(valor) {
  const pagina = Number.parseInt(valor, 10);
  return Number.isInteger(pagina) && pagina > 0 ? pagina : 1;
}

async function listarConversas(usuario, filtros = {}) {
  const { tipo, status, denunciadas, busca } = filtros;
  const ehAdmin = usuario.perfil === "ADMIN";
  const pagina = normalizarPagina(filtros.page);
  const deslocamento = (pagina - 1) * POR_PAGINA;

  if (usuario.perfil === "CACAMBEIRO") {
    await garantirSuporteDoCacambeiro(usuario.id);
  }

  if (ehAdmin && tipo === TIPOS.SUPORTE) {
    await garantirSuporteDeTodos();
  }

  const termo = busca
    ? `%${String(busca).trim().replace(/[\\%_]/g, "\\$&")}%`
    : null;

  const filtro = sql`
    ${escopoDoUsuario(usuario)}
    ${tipo ? sql`AND c.tipo = ${tipo}` : sql``}
    ${status ? sql`AND c.status = ${status}` : sql``}
    ${ehAdmin && denunciadas ? sql`AND c.denunciada_em IS NOT NULL` : sql``}
    ${
      ehAdmin && tipo !== TIPOS.SUPORTE
        ? sql`AND c.ultima_mensagem_em IS NOT NULL`
        : sql``
    }
    ${
      ehAdmin && termo
        ? sql`AND (
            cons.nome_completo ILIKE ${termo}
            OR cac.nome_completo ILIKE ${termo}
            OR c.assunto ILIKE ${termo}
          )`
        : sql``
    }
  `;

  const total = await sql`
    SELECT COUNT(*)::int AS total
    FROM conversas c
    LEFT JOIN usuarios cons ON cons.id = c.consumidor_id
    LEFT JOIN usuarios cac ON cac.id = c.cacambeiro_id
    WHERE ${filtro}
  `;

  const linhas = await selecionarConversas(
    usuario,
    filtro,
    sql`
      ORDER BY
        ${ehAdmin ? sql`(c.denunciada_em IS NOT NULL) DESC,` : sql``}
        COALESCE(c.ultima_mensagem_em, c.criada_em) DESC,
        c.id
      LIMIT ${POR_PAGINA}
      OFFSET ${deslocamento}
    `,
  );

  return {
    items: linhas.map((linha) => serializarConversa(linha, usuario)),
    pagination: {
      total: total[0].total,
      page: pagina,
      per_page: POR_PAGINA,
      total_pages: Math.ceil(total[0].total / POR_PAGINA),
    },
  };
}

/** Quantas conversas e mensagens esperam leitura do usuário. */
async function contarNaoLidas(usuario) {
  const lado = LADO_POR_PERFIL[usuario.perfil];
  const soDoSuporte =
    usuario.perfil === "ADMIN" ? sql`AND c.tipo <> 'PEDIDO'` : sql``;

  const linhas = await sql`
    SELECT
      COUNT(DISTINCT m.conversa_id)::int AS conversas,
      COUNT(*)::int AS mensagens
    FROM mensagens m
    INNER JOIN conversas c ON c.id = m.conversa_id
    WHERE ${escopoDoUsuario(usuario)}
      AND m.lado <> ${lado}
      AND m.lida_em IS NULL
      ${soDoSuporte}
  `;

  return {
    conversas: linhas[0]?.conversas ?? 0,
    mensagens: linhas[0]?.mensagens ?? 0,
  };
}

/** Dados do pedido para a tela de detalhes da conversa. */
async function resumoDoPedido(aluguelId) {
  const pedidos = await sql`
    SELECT
      a.id, a.data_pedido, a.data_inicio, a.dias_aluguel,
      a.preco_final, a.status_pagamento, a.status_aluguel,
      e.cep, e.logradouro, e.numero, e.bairro, e.cidade_estado
    FROM alugueis a
    LEFT JOIN enderecos e ON e.id = a.endereco_id
    WHERE a.id = ${aluguelId}
  `;

  const pedido = pedidos[0];

  if (!pedido) {
    return null;
  }

  const itens = await sql`
    SELECT
      c.nome, c.tipo_residuo, c.tamanho_m3,
      ia.quantidade, ia.dias_aluguel, ia.preco_diaria
    FROM itens_aluguel ia
    INNER JOIN cacambas c ON c.id = ia.cacamba_id
    WHERE ia.aluguel_id = ${aluguelId}
    ORDER BY c.nome
  `;

  return {
    id: pedido.id,
    codigo: codigoDoPedido(pedido.id),
    status_aluguel: pedido.status_aluguel,
    status_pagamento: pedido.status_pagamento,
    data_pedido: pedido.data_pedido,
    data_inicio: pedido.data_inicio,
    dias_aluguel: pedido.dias_aluguel,
    preco_final: Number(pedido.preco_final),
    endereco: {
      cep: pedido.cep,
      logradouro: pedido.logradouro,
      numero: pedido.numero,
      bairro: pedido.bairro,
      cidade_estado: pedido.cidade_estado,
    },
    itens: itens.map((item) => ({
      nome: item.nome,
      tipo_residuo: item.tipo_residuo,
      tamanho_m3: Number(item.tamanho_m3),
      quantidade: item.quantidade,
      dias_aluguel: item.dias_aluguel,
      preco_diaria: Number(item.preco_diaria),
    })),
  };
}

async function detalheDaConversa(usuario, conversaId) {
  const { linha, acesso } = await carregarConversa(usuario, conversaId);

  if (acesso.observador) {
    await sql`
      INSERT INTO chat_acessos_admin (admin_id, conversa_id)
      VALUES (${usuario.id}, ${linha.id})
    `;
  }

  return {
    ...serializarConversa(linha, usuario),
    pedido: linha.aluguel_id ? await resumoDoPedido(linha.aluguel_id) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

function normalizarLimite(valor) {
  const limite = Number.parseInt(valor, 10);

  return Number.isInteger(limite) && limite > 0
    ? Math.min(limite, 100)
    : MENSAGENS_POR_CONSULTA;
}

function normalizarCursor(valor) {
  const cursor = Number.parseInt(valor, 10);
  return Number.isInteger(cursor) && cursor >= 0 ? cursor : null;
}

/**
 * Mensagens em ordem cronológica. Sem cursor: as mais recentes.
 * `depois` traz só as novas (atualização); `antes` traz as anteriores.
 * Abrir a conversa marca como lidas as mensagens do outro lado.
 */
async function listarMensagens(usuario, conversaId, consulta = {}) {
  const { acesso } = await carregarConversa(usuario, conversaId);
  const limite = normalizarLimite(consulta.limite);
  const depois = normalizarCursor(consulta.depois);
  const antes = normalizarCursor(consulta.antes);

  if (!acesso.observador) {
    await sql`
      UPDATE mensagens
      SET lida_em = NOW()
      WHERE conversa_id = ${conversaId}
        AND lado <> ${acesso.lado}
        AND lida_em IS NULL
    `;
  }

  let linhas;

  if (depois !== null) {
    linhas = await sql`
      SELECT m.*, u.nome_completo AS remetente_nome
      FROM mensagens m
      LEFT JOIN usuarios u ON u.id = m.remetente_id
      WHERE m.conversa_id = ${conversaId} AND m.id > ${depois}
      ORDER BY m.id ASC
      LIMIT ${limite}
    `;
  } else {
    const filtroAntes = antes !== null ? sql`AND m.id < ${antes}` : sql``;

    const recentes = await sql`
      SELECT m.*, u.nome_completo AS remetente_nome
      FROM mensagens m
      LEFT JOIN usuarios u ON u.id = m.remetente_id
      WHERE m.conversa_id = ${conversaId} ${filtroAntes}
      ORDER BY m.id DESC
      LIMIT ${limite + 1}
    `;

    linhas = recentes.slice(0, limite).reverse();

    return {
      items: linhas.map((linha) =>
        serializarMensagem(linha, acesso, usuario.perfil),
      ),
      tem_anteriores: recentes.length > limite,
    };
  }

  return {
    items: linhas.map((linha) =>
      serializarMensagem(linha, acesso, usuario.perfil),
    ),
    tem_anteriores: false,
  };
}

function validarTexto(texto) {
  const limpo = typeof texto === "string" ? texto.trim() : "";

  if (limpo.length === 0 || limpo.length > LIMITE_TEXTO) {
    throw new ApiError(
      400,
      `Escreva uma mensagem de 1 a ${LIMITE_TEXTO} caracteres.`,
      "VALIDATION_ERROR",
      { texto: `Use de 1 a ${LIMITE_TEXTO} caracteres.` },
    );
  }

  return limpo;
}

async function enviarMensagem(usuario, conversaId, textoBruto) {
  const texto = validarTexto(textoBruto);
  const { linha, acesso } = await carregarConversa(usuario, conversaId);
  const bloqueio = motivoBloqueio(linha, acesso);

  if (bloqueio) {
    throw new ApiError(bloqueio.status, bloqueio.mensagem, bloqueio.codigo);
  }

  const criadas = await sql`
    WITH nova AS (
      INSERT INTO mensagens (conversa_id, remetente_id, lado, texto)
      VALUES (${conversaId}, ${usuario.id}, ${acesso.lado}, ${texto})
      RETURNING *
    ),
    atualizada AS (
      UPDATE conversas
      SET ultima_mensagem_em = NOW()
      WHERE id = ${conversaId}
    )
    SELECT * FROM nova
  `;

  return serializarMensagem(criadas[0], acesso, usuario.perfil);
}

/* ------------------------------------------------------------------ */
/* Pedidos                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cria (se ainda não existir) a conversa de um pedido. Não confere
 * permissão: quem chama já sabe que o pedido é válido.
 */
async function garantirConversaDoPedido(aluguelId) {
  await sql`
    INSERT INTO conversas (
      tipo, aluguel_id, consumidor_id, cacambeiro_id, encerrada_em
    )
    SELECT
      'PEDIDO', a.id, a.consumidor_id, a.cacambeiro_id,
      CASE
        WHEN a.status_aluguel = 'FINALIZADO'
        THEN (a.data_inicio + a.dias_aluguel)::timestamptz
      END
    FROM alugueis a
    WHERE a.id = ${aluguelId}
    ON CONFLICT (aluguel_id) WHERE tipo = 'PEDIDO' DO NOTHING
  `;

  const linhas = await sql`
    SELECT id FROM conversas
    WHERE tipo = 'PEDIDO' AND aluguel_id = ${aluguelId}
  `;

  return linhas[0]?.id ?? null;
}

/** Pedido finalizado: a conversa segue aberta por mais alguns dias. */
async function registrarFimDoPedido(aluguelId) {
  await garantirConversaDoPedido(aluguelId);

  await sql`
    UPDATE conversas
    SET encerrada_em = NOW()
    WHERE tipo = 'PEDIDO' AND aluguel_id = ${aluguelId}
  `;
}

/** Conversa do pedido para quem faz parte dele (cria se faltar). */
async function conversaDoPedido(usuario, aluguelId) {
  const pedidos = await sql`
    SELECT consumidor_id, cacambeiro_id
    FROM alugueis
    WHERE id = ${aluguelId}
  `;

  const pedido = pedidos[0];
  const permitido =
    pedido &&
    (usuario.perfil === "ADMIN" ||
      pedido.consumidor_id === usuario.id ||
      pedido.cacambeiro_id === usuario.id);

  if (!permitido) {
    throw new ApiError(404, "Pedido não encontrado.", "ORDER_NOT_FOUND");
  }

  const conversaId = await garantirConversaDoPedido(aluguelId);

  return detalheDaConversa(usuario, conversaId);
}

/* ------------------------------------------------------------------ */
/* Chamados                                                            */
/* ------------------------------------------------------------------ */

async function abrirChamado(usuario, { assunto, mensagem, aluguelId }) {
  const assuntoLimpo = String(assunto ?? "").trim();

  if (assuntoLimpo.length === 0 || assuntoLimpo.length > LIMITE_ASSUNTO) {
    throw new ApiError(
      400,
      `Informe um assunto de 1 a ${LIMITE_ASSUNTO} caracteres.`,
      "VALIDATION_ERROR",
      { assunto: `Use de 1 a ${LIMITE_ASSUNTO} caracteres.` },
    );
  }

  const texto = validarTexto(mensagem);

  if (aluguelId) {
    const pedidos = await sql`
      SELECT id FROM alugueis
      WHERE id = ${aluguelId} AND consumidor_id = ${usuario.id}
    `;

    if (pedidos.length === 0) {
      throw new ApiError(404, "Pedido não encontrado.", "ORDER_NOT_FOUND");
    }
  }

  let criadas;

  try {
    criadas = await sql`
      WITH nova AS (
        INSERT INTO conversas (
          tipo, consumidor_id, aluguel_id, assunto, ultima_mensagem_em
        )
        VALUES (
          'CHAMADO', ${usuario.id}, ${aluguelId ?? null},
          ${assuntoLimpo}, NOW()
        )
        RETURNING id
      ),
      primeira AS (
        INSERT INTO mensagens (conversa_id, remetente_id, lado, texto)
        SELECT id, ${usuario.id}, 'CLIENTE', ${texto} FROM nova
      )
      SELECT id FROM nova
    `;
  } catch (error) {
    if (error?.code === "23505") {
      const abertos = await sql`
        SELECT id FROM conversas
        WHERE tipo = 'CHAMADO'
          AND status = 'ABERTA'
          AND consumidor_id = ${usuario.id}
      `;

      const erro = new ApiError(
        409,
        "Você já tem um chamado aberto. Continue por ele ou aguarde o encerramento.",
        "CHAMADO_ALREADY_OPEN",
        { conversa_id: abertos[0]?.id },
      );

      throw erro;
    }

    throw error;
  }

  return detalheDaConversa(usuario, criadas[0].id);
}

async function fecharChamado(usuario, conversaId) {
  const fechados = await sql`
    UPDATE conversas
    SET status = 'FECHADA', fechada_em = NOW(), fechada_por = ${usuario.id}
    WHERE id = ${conversaId}
      AND tipo = 'CHAMADO'
      AND status = 'ABERTA'
    RETURNING id
  `;

  if (fechados.length === 0) {
    const existentes = await sql`
      SELECT status FROM conversas
      WHERE id = ${conversaId} AND tipo = 'CHAMADO'
    `;

    if (existentes.length === 0) {
      throw new ApiError(
        404,
        "Chamado não encontrado.",
        "CONVERSATION_NOT_FOUND",
      );
    }

    throw new ApiError(
      409,
      "Este chamado já está encerrado.",
      "CONVERSATION_CLOSED",
    );
  }

  return detalheDaConversa(usuario, conversaId);
}

/* ------------------------------------------------------------------ */
/* Denúncias                                                           */
/* ------------------------------------------------------------------ */

const NOME_DO_PERFIL = Object.freeze({
  CONSUMIDOR: "Cliente",
  CACAMBEIRO: "Caçambeiro",
  ADMIN: "Administrador",
});

function urlDoApp() {
  return process.env.FRONTEND_URL?.trim() || null;
}

async function adminsAtivos() {
  return sql`
    SELECT id, nome_completo, email
    FROM usuarios
    WHERE tipo_perfil = 'ADMIN' AND status = 'ATIVO'
  `;
}

/** Envia o e-mail a cada destinatário; devolve quantos foram aceitos. */
async function enviarParaTodos(destinatarios, montar) {
  const resultados = await Promise.allSettled(
    destinatarios.map((destino) =>
      enviarEmail({
        para: destino.email,
        nome: destino.nome_completo,
        ...montar(destino),
      }),
    ),
  );

  resultados.forEach((resultado, indice) => {
    if (resultado.status === "rejected") {
      console.error(
        `Falha ao enviar e-mail do chat para ${destinatarios[indice].email}:`,
        resultado.reason?.message,
      );
    }
  });

  return resultados.filter((r) => r.status === "fulfilled").length;
}

async function denunciar(usuario, conversaId, motivoBruto) {
  const { linha, acesso } = await carregarConversa(usuario, conversaId);

  // Admin acompanhando um pedido não é parte da conversa.
  if (acesso.observador) {
    throw new ApiError(
      403,
      "Administradores não denunciam conversas de pedidos.",
      "FORBIDDEN",
    );
  }

  const motivo = String(motivoBruto ?? "").trim().slice(0, LIMITE_MOTIVO);

  const recentes = await sql`
    SELECT id FROM denuncias_chat
    WHERE conversa_id = ${conversaId}
      AND denunciante_id = ${usuario.id}
      AND criada_em > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `;

  if (recentes.length > 0) {
    throw new ApiError(
      409,
      "Você já denunciou esta conversa. A equipe vai analisar.",
      "ALREADY_REPORTED",
    );
  }

  await sql`
    INSERT INTO denuncias_chat (conversa_id, denunciante_id, motivo)
    VALUES (${conversaId}, ${usuario.id}, ${motivo || null})
  `;

  await sql`
    UPDATE conversas
    SET denunciada_em = COALESCE(denunciada_em, NOW())
    WHERE id = ${conversaId}
  `;

  const denunciantes = await sql`
    SELECT nome_completo FROM usuarios WHERE id = ${usuario.id}
  `;
  const nomeDenunciante = denunciantes[0]?.nome_completo ?? "Usuário";
  const sobre = contatoVisto(linha, "ADMIN");
  const app = urlDoApp();

  const destinatarios = await adminsAtivos();

  await enviarParaTodos(destinatarios, (admin) => ({
    assunto: "Conversa denunciada no chat",
    ...montarEmail({
      titulo: "Uma conversa precisa de atenção",
      saudacao: `Olá, ${admin.nome_completo}.`,
      paragrafos: [
        `${nomeDenunciante} (${NOME_DO_PERFIL[usuario.perfil]}) denunciou ` +
          "uma conversa. Abra o aplicativo, na aba Conversas, para analisar.",
      ],
      detalhes: [
        ["Conversa", sobre.nome],
        ["Referência", sobre.detalhe ?? "-"],
        ["Motivo", motivo || "Não informado"],
      ],
      botao: app ? { texto: "Abrir o aplicativo", url: app } : undefined,
    }),
  }));

  return { denunciada: true };
}

async function resolverDenuncia(usuario, conversaId) {
  await carregarConversa(usuario, conversaId);

  await sql`
    UPDATE conversas SET denunciada_em = NULL WHERE id = ${conversaId}
  `;

  await sql`
    UPDATE denuncias_chat
    SET analisada_em = NOW(), analisada_por = ${usuario.id}
    WHERE conversa_id = ${conversaId} AND analisada_em IS NULL
  `;

  return detalheDaConversa(usuario, conversaId);
}

/* ------------------------------------------------------------------ */
/* Aviso por e-mail de mensagens sem leitura                           */
/* ------------------------------------------------------------------ */

/** Para quem vai a mensagem escrita por `ladoRemetente`. */
function ladoDestino(tipo, ladoRemetente) {
  if (tipo === TIPOS.PEDIDO) {
    return ladoRemetente === LADOS.CLIENTE ? LADOS.CACAMBEIRO : LADOS.CLIENTE;
  }

  if (tipo === TIPOS.SUPORTE) {
    return ladoRemetente === LADOS.CACAMBEIRO
      ? LADOS.ADMIN
      : LADOS.CACAMBEIRO;
  }

  return ladoRemetente === LADOS.CLIENTE ? LADOS.ADMIN : LADOS.CLIENTE;
}

function textoDoAviso(grupo, ladoRecebe) {
  const quantidade = grupo.total;
  const mensagens = quantidade === 1 ? "mensagem" : "mensagens";
  const codigo = grupo.aluguel_id ? codigoDoPedido(grupo.aluguel_id) : null;

  if (grupo.tipo === TIPOS.PEDIDO) {
    const quem =
      ladoRecebe === LADOS.CLIENTE
        ? grupo.cacambeiro_nome
        : grupo.consumidor_nome;

    return {
      rotulo: `Pedido ${codigo} · ${quem}`,
      resumo: `${quantidade} ${mensagens}`,
    };
  }

  if (grupo.tipo === TIPOS.SUPORTE) {
    return {
      rotulo:
        ladoRecebe === LADOS.ADMIN
          ? `Suporte · ${grupo.cacambeiro_nome}`
          : NOME_SUPORTE,
      resumo: `${quantidade} ${mensagens}`,
    };
  }

  return {
    rotulo:
      ladoRecebe === LADOS.ADMIN
        ? `Chamado · ${grupo.consumidor_nome} · ${grupo.assunto}`
        : `${NOME_SUPORTE} · ${grupo.assunto}`,
    resumo: `${quantidade} ${mensagens}`,
  };
}

async function destinatariosDoGrupo(grupo, ladoRecebe) {
  if (ladoRecebe === LADOS.ADMIN) {
    return adminsAtivos();
  }

  const quem =
    ladoRecebe === LADOS.CLIENTE
      ? {
          id: grupo.consumidor_id,
          nome_completo: grupo.consumidor_nome,
          email: grupo.consumidor_email,
          status: grupo.consumidor_status,
        }
      : {
          id: grupo.cacambeiro_id,
          nome_completo: grupo.cacambeiro_nome,
          email: grupo.cacambeiro_email,
          status: grupo.cacambeiro_status,
        };

  return quem.email && quem.status === "ATIVO" ? [quem] : [];
}

/**
 * Avisa por e-mail quem tem mensagem sem ler há mais de 8 horas.
 *
 * - Um e-mail por pessoa em cada rodada, listando as conversas.
 * - Uma conversa só é avisada de novo depois que a pessoa lê tudo e
 *   chega mensagem nova.
 * - O e-mail não leva o texto das mensagens.
 *
 * @returns {Promise<{conversas: number, emails: number}>}
 */
async function avisarMensagensNaoLidas(horas = HORAS_ATE_AVISO) {
  const grupos = await sql`
    SELECT
      m.conversa_id,
      m.lado,
      COUNT(*)::int AS total,
      c.tipo, c.aluguel_id, c.assunto, c.status,
      c.consumidor_id, c.cacambeiro_id,
      cons.nome_completo AS consumidor_nome,
      cons.email AS consumidor_email,
      cons.status AS consumidor_status,
      cac.nome_completo AS cacambeiro_nome,
      cac.email AS cacambeiro_email,
      cac.status AS cacambeiro_status
    FROM mensagens m
    INNER JOIN conversas c ON c.id = m.conversa_id
    LEFT JOIN usuarios cons ON cons.id = c.consumidor_id
    LEFT JOIN usuarios cac ON cac.id = c.cacambeiro_id
    WHERE m.lida_em IS NULL
    GROUP BY
      m.conversa_id, m.lado, c.tipo, c.aluguel_id, c.assunto, c.status,
      c.consumidor_id, c.cacambeiro_id,
      cons.nome_completo, cons.email, cons.status,
      cac.nome_completo, cac.email, cac.status
    HAVING MIN(m.criada_em) <= NOW() - make_interval(hours => ${horas})
      AND COUNT(*) FILTER (WHERE m.aviso_email_em IS NOT NULL) = 0
  `;

  if (grupos.length === 0) {
    return { conversas: 0, emails: 0 };
  }

  // email -> { destino, itens, grupos }
  const porPessoa = new Map();
  const semDestino = [];

  for (const grupo of grupos) {
    const ladoRecebe = ladoDestino(grupo.tipo, grupo.lado);

    // Ninguém responde chamado fechado: não há o que avisar à equipe.
    if (
      grupo.tipo === TIPOS.CHAMADO &&
      grupo.status === "FECHADA" &&
      ladoRecebe === LADOS.ADMIN
    ) {
      semDestino.push(grupo);
      continue;
    }

    const destinos = await destinatariosDoGrupo(grupo, ladoRecebe);

    if (destinos.length === 0) {
      semDestino.push(grupo);
      continue;
    }

    const aviso = textoDoAviso(grupo, ladoRecebe);

    for (const destino of destinos) {
      const entrada = porPessoa.get(destino.email) ?? {
        destino,
        itens: [],
        grupos: [],
      };

      entrada.itens.push(aviso);
      entrada.grupos.push(grupo);
      porPessoa.set(destino.email, entrada);
    }
  }

  const app = urlDoApp();
  const aceitosPorGrupo = new Map();

  for (const { destino, itens, grupos: gruposDaPessoa } of porPessoa.values()) {
    const total = itens.length;
    const mostrados = itens.slice(0, 10);
    const detalhes = mostrados.map((item) => [item.rotulo, item.resumo]);

    if (total > mostrados.length) {
      detalhes.push([`E mais ${total - mostrados.length}`, "conversas"]);
    }

    const [primeiro] = itens;

    try {
      await enviarEmail({
        para: destino.email,
        nome: destino.nome_completo,
        assunto:
          total === 1
            ? `Você tem mensagens não lidas: ${primeiro.rotulo}`
            : `Você tem mensagens não lidas em ${total} conversas`,
        ...montarEmail({
          titulo: "Você tem mensagens não lidas",
          saudacao: `Olá, ${destino.nome_completo}.`,
          paragrafos: [
            `Há mais de ${horas} horas você tem mensagens esperando ` +
              "resposta no chat da Collect Express.",
          ],
          detalhes,
          botao: app ? { texto: "Abrir o aplicativo", url: app } : undefined,
        }),
      });

      for (const grupo of gruposDaPessoa) {
        aceitosPorGrupo.set(grupo, true);
      }
    } catch (error) {
      console.error(
        `Falha ao avisar ${destino.email} sobre mensagens não lidas:`,
        error.message,
      );
    }
  }

  // Quem falhou em todos os envios fica para a próxima rodada.
  const marcar = [...aceitosPorGrupo.keys(), ...semDestino];

  for (const grupo of marcar) {
    await sql`
      UPDATE mensagens
      SET aviso_email_em = NOW()
      WHERE conversa_id = ${grupo.conversa_id}
        AND lado = ${grupo.lado}
        AND lida_em IS NULL
        AND aviso_email_em IS NULL
    `;
  }

  return { conversas: marcar.length, emails: porPessoa.size };
}

function iniciarVarreduraDoChat(intervaloMs = 15 * 60 * 1000) {
  const executar = () =>
    avisarMensagensNaoLidas().catch((error) => {
      console.error("Erro na varredura do chat:", error.message);
    });

  executar();

  const intervalo = setInterval(executar, intervaloMs);

  // Não impede o Node de finalizar.
  intervalo.unref();

  return intervalo;
}

module.exports = {
  TIPOS,
  LADOS,
  NOME_SUPORTE,
  LIMITE_TEXTO,
  DIAS_CONVERSA_APOS_PEDIDO,
  HORAS_ATE_AVISO,
  usuarioDaRequisicao,
  acessoA,
  motivoBloqueio,
  contatoVisto,
  ladoDestino,
  listarConversas,
  contarNaoLidas,
  detalheDaConversa,
  listarMensagens,
  enviarMensagem,
  garantirConversaDoPedido,
  registrarFimDoPedido,
  conversaDoPedido,
  abrirChamado,
  fecharChamado,
  denunciar,
  resolverDenuncia,
  avisarMensagensNaoLidas,
  iniciarVarreduraDoChat,
};
