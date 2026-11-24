/*
 * Coleta de materiais recicláveis.
 *
 * Fluxo: quem tem o material (cliente ou caçambeiro) faz uma SINALIZAÇÃO
 * (ofertas_coleta) com janela de data e hora, aceita o termo e assina. Um
 * parceiro aprovado escolhe uma sinalização e AGENDA a coleta (coletas):
 * gera-se o documento com 3 assinaturas e saem os e-mails. Quem entrega
 * pode cancelar em até 24 horas do agendamento, e o parceiro só pode
 * marcar a retirada para 24 horas depois do agendamento.
 *
 * Telefone e e-mail das partes não aparecem para a outra parte: a conversa
 * acontece no chat (conversa do tipo COLETA).
 */

const crypto = require("crypto");

const sql = require("../config/db");

const ApiError = require("../utils/apiError");
const {
  decodificarAssinaturaConsumidor,
  formatoDaImagem,
} = require("../utils/imageUpload");
const {
  salvarArquivo,
  lerArquivo,
  removerArquivo,
} = require("./storageService");
const { enviarEmail } = require("./emailService");
const { montarEmail } = require("./emailTemplates");
const { formatarDataHora } = require("./contratoPdfService");
const chatService = require("./chatService");
const {
  VERSAO_TERMOS_COLETA,
  codigoDaColeta,
  calcularAutenticacao,
  autenticacaoCurta,
  autenticacaoConfere,
  gerarDocumentoPdf,
} = require("./documentoColetaService");

const HORA_MS = 60 * 60 * 1000;

/** Antecedência mínima da retirada e prazo de cancelamento de quem entrega. */
const HORAS_ANTECEDENCIA = 24;
const MIN_HORAS_JANELA = 2;
const MAX_DIAS_ANTECEDENCIA = 60;
const MAX_MATERIAIS = 8;
const POR_PAGINA = 20;

const PERFIS_QUE_ENTREGAM = ["CONSUMIDOR", "CACAMBEIRO"];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIPO_DO_PERFIL = Object.freeze({
  CONSUMIDOR: "Cliente",
  CACAMBEIRO: "Fornecedor",
});

function urlDoApp() {
  return process.env.FRONTEND_URL?.trim() || null;
}

function erroDeValidacao(campo, mensagem) {
  return new ApiError(400, mensagem, "VALIDATION_ERROR", {
    [campo]: mensagem,
  });
}

function lerData(valor, campo) {
  const data = new Date(valor);

  if (typeof valor !== "string" || Number.isNaN(data.getTime())) {
    throw erroDeValidacao(campo, "Informe uma data e hora válidas.");
  }

  return data;
}

function somarHoras(data, horas) {
  return new Date(data.getTime() + horas * HORA_MS);
}

function textoObrigatorio(valor, campo, min, max, rotulo) {
  const texto = typeof valor === "string" ? valor.trim() : "";

  if (texto.length < min || texto.length > max) {
    throw erroDeValidacao(
      campo,
      `${rotulo}: use de ${min} a ${max} caracteres.`,
    );
  }

  return texto;
}

/* ------------------------------------------------------------------ */
/* Regras de data                                                      */
/* ------------------------------------------------------------------ */

/**
 * Valida a janela de uma sinalização. Precisa sobrar pelo menos 1 hora
 * de retirada possível depois das 24 horas em que o cliente pode recusar.
 */
function validarJanela(inicioBruto, fimBruto, agora) {
  const inicio = lerData(inicioBruto, "janela_inicio");
  const fim = lerData(fimBruto, "janela_fim");

  if (fim.getTime() - inicio.getTime() < MIN_HORAS_JANELA * HORA_MS) {
    throw erroDeValidacao(
      "janela_fim",
      `A janela precisa ter pelo menos ${MIN_HORAS_JANELA} horas.`,
    );
  }

  if (fim.getTime() < somarHoras(agora, HORAS_ANTECEDENCIA + 1).getTime()) {
    throw erroDeValidacao(
      "janela_fim",
      "A janela precisa terminar daqui a mais de 25 horas: o parceiro só " +
        `pode retirar ${HORAS_ANTECEDENCIA} horas depois de agendar, para ` +
        "você ter tempo de recusar.",
    );
  }

  if (fim.getTime() > agora.getTime() + MAX_DIAS_ANTECEDENCIA * 24 * HORA_MS) {
    throw erroDeValidacao(
      "janela_fim",
      `A janela não pode passar de ${MAX_DIAS_ANTECEDENCIA} dias.`,
    );
  }

  return { inicio, fim };
}

/** Primeiro horário em que um parceiro pode marcar a retirada. */
function primeiroHorarioPossivel(janelaInicio, agora) {
  const minimo = somarHoras(agora, HORAS_ANTECEDENCIA);
  return new Date(Math.max(new Date(janelaInicio).getTime(), minimo.getTime()));
}

/* ------------------------------------------------------------------ */
/* Sinalizações                                                        */
/* ------------------------------------------------------------------ */

function listaDeIds(valor, campo) {
  const ids = [...new Set(Array.isArray(valor) ? valor : [])];

  if (
    ids.length === 0 ||
    ids.length > MAX_MATERIAIS ||
    ids.some((id) => typeof id !== "string" || !UUID_REGEX.test(id))
  ) {
    throw erroDeValidacao(
      campo,
      `Escolha de 1 a ${MAX_MATERIAIS} tipos de material.`,
    );
  }

  return ids;
}

async function assinaturaDeQuemEntrega(usuario, corpo) {
  if (usuario.perfil === "CONSUMIDOR") {
    if (!corpo.assinatura_base64) {
      throw erroDeValidacao(
        "assinatura_base64",
        "Assine na tela para concordar com o termo.",
      );
    }

    const imagem = decodificarAssinaturaConsumidor(corpo.assinatura_base64);
    return salvarArquivo(
      "private/assinaturas",
      imagem.extensao,
      imagem.buffer,
    );
  }

  // Caçambeiro: usa a assinatura da empresa; guarda uma cópia na sinalização.
  const linhas = await sql`
    SELECT assinatura_path
    FROM detalhes_cacambeiro
    WHERE usuario_id = ${usuario.id}
  `;

  const origem = linhas[0]?.assinatura_path;

  if (!origem) {
    throw new ApiError(
      400,
      "Envie a assinatura da empresa no perfil da loja antes de sinalizar.",
      "SIGNATURE_REQUIRED",
    );
  }

  // A assinatura da empresa pode ser PNG ou JPEG; a cópia mantém o formato.
  let conteudo;

  try {
    conteudo = await lerArquivo(origem);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    // O arquivo se perdeu: pede para enviar de novo, em vez de erro 500.
    throw new ApiError(
      400,
      "Sua assinatura não foi encontrada. Envie-a de novo no perfil da loja.",
      "SIGNATURE_REQUIRED",
    );
  }

  const extensao = formatoDaImagem(conteudo)?.extensao ?? "png";
  return salvarArquivo("private/assinaturas", extensao, conteudo);
}

async function criarOferta(usuario, corpo, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();

  if (!PERFIS_QUE_ENTREGAM.includes(usuario.perfil)) {
    throw new ApiError(403, "Acesso não autorizado.", "FORBIDDEN");
  }

  if (corpo.aceite_termos !== true) {
    throw new ApiError(
      400,
      "Aceite o termo de retirada para sinalizar.",
      "TERMS_NOT_ACCEPTED",
    );
  }

  const materiais = listaDeIds(corpo.materiais_ids, "materiais_ids");
  const descricao = textoObrigatorio(
    corpo.descricao,
    "descricao",
    5,
    1000,
    "Descrição do material",
  );
  const quantidade = textoObrigatorio(
    corpo.quantidade_estimada,
    "quantidade_estimada",
    1,
    100,
    "Quantidade estimada",
  );
  const observacoes =
    typeof corpo.observacoes === "string" && corpo.observacoes.trim()
      ? corpo.observacoes.trim().slice(0, 500)
      : null;

  const { inicio, fim } = validarJanela(
    corpo.janela_inicio,
    corpo.janela_fim,
    agora,
  );

  if (typeof corpo.endereco_id !== "string" || !UUID_REGEX.test(corpo.endereco_id)) {
    throw erroDeValidacao("endereco_id", "Escolha o endereço da retirada.");
  }

  const encontrados = await sql`
    SELECT id FROM materiais_reciclaveis WHERE id = ANY(${materiais}::uuid[])
  `;

  if (encontrados.length !== materiais.length) {
    throw erroDeValidacao("materiais_ids", "Tipo de material inválido.");
  }

  const enderecos = await sql`
    SELECT id FROM enderecos
    WHERE id = ${corpo.endereco_id} AND usuario_id = ${usuario.id}
  `;

  if (enderecos.length === 0) {
    throw new ApiError(404, "Endereço não encontrado.", "ADDRESS_NOT_FOUND");
  }

  const assinaturaPath = await assinaturaDeQuemEntrega(usuario, corpo);

  try {
    const criadas = await sql`
      WITH nova AS (
        INSERT INTO ofertas_coleta (
          anunciante_id, endereco_id, descricao, quantidade_estimada,
          observacoes, janela_inicio, janela_fim, aceite_termos_em,
          aceite_ip, versao_termos, assinatura_path
        )
        VALUES (
          ${usuario.id}, ${corpo.endereco_id}, ${descricao}, ${quantidade},
          ${observacoes}, ${inicio.toISOString()}, ${fim.toISOString()},
          ${agora.toISOString()}, ${opcoes.ip ?? null},
          ${VERSAO_TERMOS_COLETA}, ${assinaturaPath}
        )
        RETURNING id
      ),
      materiais_da_oferta AS (
        INSERT INTO oferta_materiais (oferta_id, material_id)
        SELECT nova.id, unnest(${materiais}::uuid[]) FROM nova
      )
      SELECT id FROM nova
    `;

    return (await minhasOfertas(usuario, { id: criadas[0].id }))[0];
  } catch (error) {
    await removerArquivo(assinaturaPath);
    throw error;
  }
}

const MATERIAIS_JSON = sql`
  (
    SELECT COALESCE(
      json_agg(json_build_object('id', m.id, 'nome', m.nome) ORDER BY m.nome),
      '[]'::json
    )
    FROM oferta_materiais om
    INNER JOIN materiais_reciclaveis m ON m.id = om.material_id
    WHERE om.oferta_id = o.id
  )
`;

function serializarOfertaDoAnunciante(linha, agora = new Date()) {
  const coleta = linha.coleta_id
    ? {
        id: linha.coleta_id,
        codigo: linha.coleta_codigo,
        status: linha.coleta_status,
        data_agendada: linha.data_agendada,
        cancelavel_ate: linha.cancelavel_ate,
        parceiro_nome: linha.parceiro_nome,
        pode_cancelar:
          linha.coleta_status === "AGENDADA" &&
          new Date(linha.cancelavel_ate).getTime() >= agora.getTime(),
      }
    : null;

  return {
    id: linha.id,
    status: linha.status,
    materiais: linha.materiais,
    descricao: linha.descricao,
    quantidade_estimada: linha.quantidade_estimada,
    observacoes: linha.observacoes,
    janela_inicio: linha.janela_inicio,
    janela_fim: linha.janela_fim,
    endereco: {
      cep: linha.cep,
      logradouro: linha.logradouro,
      numero: linha.numero,
      bairro: linha.bairro,
      cidade_estado: linha.cidade_estado,
    },
    criada_em: linha.criada_em,
    coleta,
  };
}

/** Sinalizações de quem entrega (as mais recentes primeiro). */
async function minhasOfertas(usuario, { id, agora } = {}) {
  const filtroId = id ? sql`AND o.id = ${id}` : sql``;

  const linhas = await sql`
    SELECT
      o.id, o.status, o.descricao, o.quantidade_estimada, o.observacoes,
      o.janela_inicio, o.janela_fim, o.criada_em,
      e.cep, e.logradouro, e.numero, e.bairro, e.cidade_estado,
      ${MATERIAIS_JSON} AS materiais,
      c.id AS coleta_id, c.codigo AS coleta_codigo,
      c.status AS coleta_status, c.data_agendada, c.cancelavel_ate,
      p.nome_completo AS parceiro_nome
    FROM ofertas_coleta o
    INNER JOIN enderecos e ON e.id = o.endereco_id
    LEFT JOIN LATERAL (
      SELECT * FROM coletas
      WHERE oferta_id = o.id AND status IN ('AGENDADA', 'CONCLUIDA')
      ORDER BY agendada_em DESC
      LIMIT 1
    ) c ON TRUE
    LEFT JOIN usuarios p ON p.id = c.parceiro_id
    WHERE o.anunciante_id = ${usuario.id} ${filtroId}
    ORDER BY o.criada_em DESC
    LIMIT 50
  `;

  return linhas.map((linha) => serializarOfertaDoAnunciante(linha, agora));
}

/** Cancela uma sinalização que ainda não tem coleta agendada. */
async function cancelarOferta(usuario, ofertaId, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();

  const canceladas = await sql`
    UPDATE ofertas_coleta
    SET status = 'CANCELADA', cancelada_em = ${agora.toISOString()}
    WHERE id = ${ofertaId}
      AND anunciante_id = ${usuario.id}
      AND status = 'ABERTA'
    RETURNING id
  `;

  if (canceladas.length === 0) {
    const existentes = await sql`
      SELECT status FROM ofertas_coleta
      WHERE id = ${ofertaId} AND anunciante_id = ${usuario.id}
    `;

    if (existentes.length === 0) {
      throw new ApiError(404, "Sinalização não encontrada.", "OFFER_NOT_FOUND");
    }

    throw new ApiError(
      409,
      existentes[0].status === "AGENDADA"
        ? "Há uma coleta agendada: cancele a coleta primeiro."
        : "Esta sinalização não pode mais ser cancelada.",
      "OFFER_NOT_CANCELABLE",
    );
  }

  return (await minhasOfertas(usuario, { id: ofertaId }))[0];
}

/* ------------------------------------------------------------------ */
/* Vitrine do parceiro                                                 */
/* ------------------------------------------------------------------ */

function expressaoDeDistancia(centro) {
  if (!centro) {
    return sql`NULL::float8`;
  }

  return sql`(
    6371 * 2 * ASIN(SQRT(LEAST(1,
      POWER(SIN(RADIANS(
        e.latitude::float8 - ${centro.latitude}::float8
      ) / 2), 2)
      + COS(RADIANS(${centro.latitude}::float8))
        * COS(RADIANS(e.latitude::float8))
        * POWER(SIN(RADIANS(
          e.longitude::float8 - ${centro.longitude}::float8
        ) / 2), 2)
    )))
  )`;
}

async function centroDoParceiro(parceiroId) {
  const linhas = await sql`
    SELECT centro_lat, centro_lng
    FROM detalhes_parceiro
    WHERE usuario_id = ${parceiroId}
  `;

  const linha = linhas[0];

  return linha?.centro_lat != null && linha?.centro_lng != null
    ? { latitude: Number(linha.centro_lat), longitude: Number(linha.centro_lng) }
    : null;
}

function serializarOfertaParaParceiro(linha, agora) {
  return {
    id: linha.id,
    materiais: linha.materiais,
    descricao: linha.descricao,
    quantidade_estimada: linha.quantidade_estimada,
    observacoes: linha.observacoes,
    janela_inicio: linha.janela_inicio,
    janela_fim: linha.janela_fim,
    primeiro_horario: primeiroHorarioPossivel(linha.janela_inicio, agora),
    // O endereço completo só aparece depois do agendamento.
    bairro: linha.bairro,
    cidade_estado: linha.cidade_estado,
    distancia_km:
      linha.distancia_km == null
        ? null
        : Math.round(Number(linha.distancia_km) * 10) / 10,
    anunciante_tipo: TIPO_DO_PERFIL[linha.anunciante_perfil] ?? "Cliente",
    criada_em: linha.criada_em,
  };
}

/**
 * Sinalizações abertas que ainda dão tempo de agendar.
 * Filtros: materiais (ids), distancia_km (a partir do centro do
 * parceiro), de/ate (datas ISO, janelas que cruzam o período).
 */
async function ofertasDisponiveis(usuario, filtros = {}, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();
  const pagina = Math.max(Number.parseInt(filtros.page, 10) || 1, 1);
  const deslocamento = (pagina - 1) * POR_PAGINA;

  const ids = String(filtros.materiais ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.some((id) => !UUID_REGEX.test(id))) {
    throw erroDeValidacao("materiais", "Tipo de material inválido.");
  }

  const centro = await centroDoParceiro(usuario.id);
  const distancia = expressaoDeDistancia(centro);
  const maxKm = Number(filtros.distancia_km);

  const de = filtros.de ? lerData(filtros.de, "de") : null;
  const ate = filtros.ate ? lerData(filtros.ate, "ate") : null;

  const filtro = sql`
    o.status = 'ABERTA'
    AND o.janela_fim > ${somarHoras(agora, HORAS_ANTECEDENCIA).toISOString()}
    ${
      ids.length > 0
        ? sql`AND EXISTS (
            SELECT 1 FROM oferta_materiais om
            WHERE om.oferta_id = o.id AND om.material_id = ANY(${ids}::uuid[])
          )`
        : sql``
    }
    ${
      centro && Number.isFinite(maxKm) && maxKm > 0
        ? sql`AND ${distancia} <= ${maxKm}`
        : sql``
    }
    ${de ? sql`AND o.janela_fim >= ${de.toISOString()}` : sql``}
    ${ate ? sql`AND o.janela_inicio <= ${ate.toISOString()}` : sql``}
  `;

  const total = await sql`
    SELECT COUNT(*)::int AS total
    FROM ofertas_coleta o
    INNER JOIN enderecos e ON e.id = o.endereco_id
    WHERE ${filtro}
  `;

  const linhas = await sql`
    SELECT
      o.id, o.descricao, o.quantidade_estimada, o.observacoes,
      o.janela_inicio, o.janela_fim, o.criada_em,
      e.bairro, e.cidade_estado,
      u.tipo_perfil AS anunciante_perfil,
      ${distancia} AS distancia_km,
      ${MATERIAIS_JSON} AS materiais
    FROM ofertas_coleta o
    INNER JOIN enderecos e ON e.id = o.endereco_id
    INNER JOIN usuarios u ON u.id = o.anunciante_id
    WHERE ${filtro}
    ORDER BY o.criada_em DESC
    LIMIT ${POR_PAGINA} OFFSET ${deslocamento}
  `;

  return {
    items: linhas.map((linha) => serializarOfertaParaParceiro(linha, agora)),
    pagination: {
      total: total[0].total,
      page: pagina,
      per_page: POR_PAGINA,
      total_pages: Math.ceil(total[0].total / POR_PAGINA),
    },
    area_definida: centro !== null,
  };
}

async function detalheDaOfertaParaParceiro(usuario, ofertaId, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();
  const centro = await centroDoParceiro(usuario.id);
  const distancia = expressaoDeDistancia(centro);

  const linhas = await sql`
    SELECT
      o.id, o.status, o.descricao, o.quantidade_estimada, o.observacoes,
      o.janela_inicio, o.janela_fim, o.criada_em,
      e.bairro, e.cidade_estado,
      u.tipo_perfil AS anunciante_perfil,
      ${distancia} AS distancia_km,
      ${MATERIAIS_JSON} AS materiais
    FROM ofertas_coleta o
    INNER JOIN enderecos e ON e.id = o.endereco_id
    INNER JOIN usuarios u ON u.id = o.anunciante_id
    WHERE o.id = ${ofertaId}
  `;

  const linha = linhas[0];

  if (!linha) {
    throw new ApiError(404, "Sinalização não encontrada.", "OFFER_NOT_FOUND");
  }

  if (linha.status !== "ABERTA") {
    throw new ApiError(
      409,
      "Esta sinalização não está mais disponível.",
      "OFFER_UNAVAILABLE",
    );
  }

  return serializarOfertaParaParceiro(linha, agora);
}

/* ------------------------------------------------------------------ */
/* Coletas                                                             */
/* ------------------------------------------------------------------ */

function consultaDaColeta(filtro, extra = sql``) {
  return sql`
    SELECT
      c.*,
      g.nome_completo AS gerador_nome,
      g.documento AS gerador_documento,
      g.tipo_perfil AS gerador_perfil,
      g.email AS gerador_email,
      p.nome_completo AS parceiro_nome,
      p.documento AS parceiro_documento,
      p.email AS parceiro_email,
      dp.responsavel_nome,
      e.cep, e.logradouro, e.numero, e.bairro, e.cidade_estado,
      o.descricao, o.quantidade_estimada,
      o.observacoes AS observacoes_oferta,
      o.janela_inicio, o.janela_fim,
      o.aceite_termos_em, o.aceite_ip, o.assinatura_path AS oferta_assinatura,
      ARRAY(
        SELECT m.nome
        FROM oferta_materiais om
        INNER JOIN materiais_reciclaveis m ON m.id = om.material_id
        WHERE om.oferta_id = c.oferta_id
        ORDER BY m.nome
      ) AS materiais_nomes
    FROM coletas c
    INNER JOIN usuarios g ON g.id = c.consumidor_id
    INNER JOIN usuarios p ON p.id = c.parceiro_id
    LEFT JOIN detalhes_parceiro dp ON dp.usuario_id = c.parceiro_id
    INNER JOIN enderecos e ON e.id = c.endereco_id
    INNER JOIN ofertas_coleta o ON o.id = c.oferta_id
    WHERE ${filtro}
    ${extra}
  `;
}

/** A coleta, se o usuário for uma das partes (ou admin). */
async function carregarColeta(usuario, coletaId) {
  const escopo =
    usuario.perfil === "PARCEIRO"
      ? sql`AND c.parceiro_id = ${usuario.id}`
      : usuario.perfil === "ADMIN"
        ? sql``
        : sql`AND c.consumidor_id = ${usuario.id}`;

  const linhas = await consultaDaColeta(sql`c.id = ${coletaId} ${escopo}`);

  if (linhas.length === 0) {
    throw new ApiError(404, "Coleta não encontrada.", "COLLECTION_NOT_FOUND");
  }

  return linhas[0];
}

function permissoes(linha, usuario, agora) {
  const agendada = linha.status === "AGENDADA";
  const ate = new Date(linha.cancelavel_ate).getTime();
  const quando = new Date(linha.data_agendada).getTime();

  const podeCancelar =
    agendada &&
    ((usuario.perfil === "PARCEIRO" && agora.getTime() < quando) ||
      (usuario.perfil === "ADMIN") ||
      (PERFIS_QUE_ENTREGAM.includes(usuario.perfil) &&
        agora.getTime() <= ate));

  const podeConcluir =
    agendada && usuario.perfil === "PARCEIRO" && agora.getTime() >= quando;

  return { podeCancelar, podeConcluir };
}

function serializarColeta(linha, usuario, agora = new Date()) {
  const { podeCancelar, podeConcluir } = permissoes(linha, usuario, agora);

  return {
    id: linha.id,
    codigo: linha.codigo,
    status: linha.status,
    oferta_id: linha.oferta_id,
    data_agendada: linha.data_agendada,
    agendada_em: linha.agendada_em,
    cancelavel_ate: linha.cancelavel_ate,
    pode_cancelar: podeCancelar,
    pode_concluir: podeConcluir,
    materiais: linha.materiais_nomes,
    descricao: linha.descricao,
    quantidade_estimada: linha.quantidade_estimada,
    observacoes: linha.observacoes,
    observacoes_oferta: linha.observacoes_oferta,
    janela_inicio: linha.janela_inicio,
    janela_fim: linha.janela_fim,
    endereco: {
      cep: linha.cep,
      logradouro: linha.logradouro,
      numero: linha.numero,
      bairro: linha.bairro,
      cidade_estado: linha.cidade_estado,
    },
    gerador_nome: linha.gerador_nome,
    gerador_tipo: TIPO_DO_PERFIL[linha.gerador_perfil] ?? "Cliente",
    parceiro_nome: linha.parceiro_nome,
    cancelada_em: linha.cancelada_em,
    cancelamento_motivo: linha.cancelamento_motivo,
    concluida_em: linha.concluida_em,
    peso_real_kg: linha.peso_real_kg == null ? null : Number(linha.peso_real_kg),
    documento_disponivel: true,
  };
}

async function listarColetas(usuario, filtros = {}, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();
  const pagina = Math.max(Number.parseInt(filtros.page, 10) || 1, 1);

  const escopo =
    usuario.perfil === "PARCEIRO"
      ? sql`c.parceiro_id = ${usuario.id}`
      : usuario.perfil === "ADMIN"
        ? sql`TRUE`
        : sql`c.consumidor_id = ${usuario.id}`;

  const porStatus = ["AGENDADA", "CONCLUIDA", "CANCELADA"].includes(
    filtros.status,
  )
    ? sql`AND c.status = ${filtros.status}`
    : sql``;

  const filtro = sql`${escopo} ${porStatus}`;

  const total = await sql`
    SELECT COUNT(*)::int AS total FROM coletas c WHERE ${filtro}
  `;

  const linhas = await consultaDaColeta(
    filtro,
    sql`
      ORDER BY
        CASE WHEN c.status = 'AGENDADA' THEN 0 ELSE 1 END,
        CASE WHEN c.status = 'AGENDADA' THEN c.data_agendada END ASC,
        c.agendada_em DESC
      LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}
    `,
  );

  return {
    items: linhas.map((linha) => serializarColeta(linha, usuario, agora)),
    pagination: {
      total: total[0].total,
      page: pagina,
      per_page: POR_PAGINA,
      total_pages: Math.ceil(total[0].total / POR_PAGINA),
    },
  };
}

async function detalheDaColeta(usuario, coletaId, opcoes = {}) {
  const linha = await carregarColeta(usuario, coletaId);
  return serializarColeta(linha, usuario, opcoes.agora ?? new Date());
}

/** Totais para o início do parceiro e de quem entrega. */
async function resumo(usuario) {
  const escopo =
    usuario.perfil === "PARCEIRO"
      ? sql`parceiro_id = ${usuario.id}`
      : sql`consumidor_id = ${usuario.id}`;

  const linhas = await sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'AGENDADA')::int AS agendadas,
      COUNT(*) FILTER (WHERE status = 'CONCLUIDA')::int AS concluidas,
      COALESCE(SUM(peso_real_kg) FILTER (WHERE status = 'CONCLUIDA'), 0)
        AS kg_coletados
    FROM coletas
    WHERE ${escopo}
  `;

  let ofertasAbertas = 0;

  if (usuario.perfil === "PARCEIRO") {
    const novas = await sql`
      SELECT COUNT(*)::int AS total
      FROM ofertas_coleta
      WHERE status = 'ABERTA'
        AND janela_fim > ${somarHoras(new Date(), HORAS_ANTECEDENCIA).toISOString()}
    `;
    ofertasAbertas = novas[0].total;
  }

  return {
    agendadas: linhas[0].agendadas,
    concluidas: linhas[0].concluidas,
    kg_coletados: Number(linhas[0].kg_coletados),
    ofertas_abertas: ofertasAbertas,
  };
}

/* ------------------------------------------------------------------ */
/* Documento                                                           */
/* ------------------------------------------------------------------ */

async function lerAssinatura(chave) {
  if (!chave) {
    return null;
  }

  try {
    return await lerArquivo(chave);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

/** Link público para conferir a autenticação do documento. */
function urlDeVerificacao(linha) {
  const raiz =
    process.env.PUBLIC_API_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim();

  if (!raiz || !linha.documento_hash) {
    return null;
  }

  return (
    `${raiz.replace(/\/$/, "")}/api/coletas/verificar/${linha.codigo}` +
    `?autenticacao=${autenticacaoCurta(linha.documento_hash)}`
  );
}

async function dadosDoDocumento(linha) {
  const assinaturaGerador = await lerAssinatura(
    linha.assinatura_gerador_path ?? linha.oferta_assinatura,
  );
  const assinaturaParceiro = await lerAssinatura(linha.assinatura_parceiro_path);

  return {
    assinaturas: { assinaturaGerador, assinaturaParceiro },
    pdf: {
      codigo: linha.codigo,
      versao: linha.documento_versao,
      status: linha.status,
      canceladaEm: linha.cancelada_em,
      autenticacao: linha.documento_hash,
      verificacaoUrl: urlDeVerificacao(linha),
      agendadaEm: linha.agendada_em,
      dataAgendada: linha.data_agendada,
      cancelavelAte: linha.cancelavel_ate,
      janela: { inicio: linha.janela_inicio, fim: linha.janela_fim },
      materiais: linha.materiais_nomes,
      descricao: linha.descricao,
      quantidade: linha.quantidade_estimada,
      observacoes: linha.observacoes_oferta,
      aceite: { em: linha.aceite_termos_em, ip: linha.aceite_ip },
      gerador: {
        tipo: TIPO_DO_PERFIL[linha.gerador_perfil] ?? "Cliente",
        nome: linha.gerador_nome,
        documento: linha.gerador_documento,
        endereco:
          `${linha.logradouro}, ${linha.numero} - ${linha.bairro}, ` +
          `${linha.cidade_estado} (CEP ${linha.cep})`,
        assinatura: assinaturaGerador,
      },
      parceiro: {
        nome: linha.parceiro_nome,
        documento: linha.parceiro_documento,
        responsavel: linha.responsavel_nome,
        assinatura: assinaturaParceiro,
      },
    },
  };
}

function hashDaColeta(linha, assinaturas) {
  return calcularAutenticacao({
    codigo: linha.codigo,
    versao: linha.documento_versao,
    geradorId: linha.consumidor_id,
    parceiroId: linha.parceiro_id,
    agendadaEm: linha.agendada_em,
    dataAgendada: linha.data_agendada,
    materiais: linha.materiais_nomes,
    assinaturaGerador: assinaturas.assinaturaGerador,
    assinaturaParceiro: assinaturas.assinaturaParceiro,
  });
}

/**
 * Gera o PDF da coleta (a partir das cópias das assinaturas guardadas) e,
 * enquanto a coleta estiver ativa, grava o arquivo.
 */
async function emitirDocumento(coletaId) {
  const linhas = await consultaDaColeta(sql`c.id = ${coletaId}`);
  const linha = linhas[0];

  if (!linha) {
    throw new ApiError(404, "Coleta não encontrada.", "COLLECTION_NOT_FOUND");
  }

  const { assinaturas, pdf } = await dadosDoDocumento(linha);

  if (!linha.documento_hash) {
    pdf.autenticacao = hashDaColeta(linha, assinaturas);
    pdf.verificacaoUrl = urlDeVerificacao({
      ...linha,
      documento_hash: pdf.autenticacao,
    });

    await sql`
      UPDATE coletas SET documento_hash = ${pdf.autenticacao}
      WHERE id = ${coletaId}
    `;
  }

  const buffer = await gerarDocumentoPdf(pdf);

  if (linha.status !== "CANCELADA" && !linha.documento_path) {
    const caminho = await salvarArquivo("private/coletas", "pdf", buffer);

    await sql`
      UPDATE coletas SET documento_path = ${caminho} WHERE id = ${coletaId}
    `;
  }

  return { buffer, nome: `${linha.codigo}.pdf`, linha };
}

/** PDF para download de quem faz parte da coleta (ou do admin). */
async function documentoDaColeta(usuario, coletaId) {
  const linha = await carregarColeta(usuario, coletaId);

  if (linha.status !== "CANCELADA" && linha.documento_path) {
    try {
      return {
        buffer: await lerArquivo(linha.documento_path),
        nome: `${linha.codigo}.pdf`,
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const { buffer, nome } = await emitirDocumento(coletaId);
  return { buffer, nome };
}

/** Verificação pública: o código de autenticação é de um documento real? */
async function verificarDocumento(codigo, autenticacao) {
  const limpo = String(codigo ?? "").trim().toUpperCase();

  const linhas = await sql`
    SELECT codigo, status, agendada_em, data_agendada, documento_hash
    FROM coletas
    WHERE codigo = ${limpo}
  `;

  const linha = linhas[0];

  if (!linha || !linha.documento_hash || !autenticacaoConfere(linha.documento_hash, autenticacao)) {
    return { valido: false };
  }

  return {
    valido: true,
    codigo: linha.codigo,
    status: linha.status,
    emitido_em: linha.agendada_em,
    data_agendada: linha.data_agendada,
  };
}

/* ------------------------------------------------------------------ */
/* E-mails                                                             */
/* ------------------------------------------------------------------ */

function enderecoEmTexto(linha) {
  return (
    `${linha.logradouro}, ${linha.numero} - ${linha.bairro}, ` +
    `${linha.cidade_estado}`
  );
}

async function enviarSemFalhar(mensagem) {
  try {
    await enviarEmail(mensagem);
  } catch (error) {
    console.error(
      `Falha ao enviar e-mail da coleta para ${mensagem.para}:`,
      error.message,
    );
  }
}

function botaoDoApp() {
  const app = urlDoApp();
  return app ? { texto: "Abrir o aplicativo", url: app } : undefined;
}

/** E-mails do agendamento. Não levam telefone nem e-mail das partes. */
async function avisarAgendamento(linha, pdf) {
  const anexos = pdf ? [{ nome: `${linha.codigo}.pdf`, conteudo: pdf }] : undefined;
  const quando = formatarDataHora(linha.data_agendada);
  const cancelamento = formatarDataHora(linha.cancelavel_ate);
  const materiais = linha.materiais_nomes.join(", ");
  const tipo = TIPO_DO_PERFIL[linha.gerador_perfil] ?? "Cliente";

  await Promise.all([
    enviarSemFalhar({
      para: linha.parceiro_email,
      nome: linha.parceiro_nome,
      assunto: `Coleta agendada: ${linha.codigo}`,
      anexos,
      ...montarEmail({
        titulo: "Coleta agendada",
        saudacao: `Olá, ${linha.parceiro_nome}.`,
        paragrafos: [
          `Você agendou a retirada de material reciclável de ${linha.gerador_nome}. ` +
            "O documento assinado segue em anexo. Combine os detalhes pelo " +
            "chat do aplicativo.",
          `Quem entrega pode cancelar até ${cancelamento}.`,
        ],
        detalhes: [
          ["Documento", linha.codigo],
          ["Quem entrega", `${linha.gerador_nome} (${tipo})`],
          ["Endereço", enderecoEmTexto(linha)],
          ["Retirada", quando],
          ["Materiais", materiais],
          ["Quantidade estimada", linha.quantidade_estimada],
          ["Descrição", linha.descricao],
          ...(linha.observacoes_oferta
            ? [["Observações", linha.observacoes_oferta]]
            : []),
        ],
        botao: botaoDoApp(),
      }),
    }),
    enviarSemFalhar({
      para: linha.gerador_email,
      nome: linha.gerador_nome,
      assunto: `Retirada agendada: ${linha.codigo}`,
      anexos,
      ...montarEmail({
        titulo: "A retirada do seu material foi agendada",
        saudacao: `Olá, ${linha.gerador_nome}.`,
        paragrafos: [
          `${linha.parceiro_nome} vai retirar o material que você sinalizou. ` +
            "O documento assinado segue em anexo.",
          `Se não quiser seguir com essa retirada, cancele até ${cancelamento} ` +
            "pelo aplicativo (Reciclagem > Minhas sinalizações). Depois desse " +
            "prazo, só combinando com o parceiro pelo chat.",
        ],
        detalhes: [
          ["Documento", linha.codigo],
          ["Parceiro", linha.parceiro_nome],
          ["Retirada", quando],
          ["Endereço", enderecoEmTexto(linha)],
          ["Materiais", materiais],
        ],
        botao: botaoDoApp(),
      }),
    }),
  ]);
}

async function avisarCancelamento(linha, quemCancelou) {
  const motivo = linha.cancelamento_motivo || "Não informado";

  const destinatarios = [
    ...(quemCancelou !== "GERADOR"
      ? [{ email: linha.gerador_email, nome: linha.gerador_nome }]
      : []),
    ...(quemCancelou !== "PARCEIRO"
      ? [{ email: linha.parceiro_email, nome: linha.parceiro_nome }]
      : []),
  ];

  const por =
    quemCancelou === "GERADOR"
      ? linha.gerador_nome
      : quemCancelou === "PARCEIRO"
        ? linha.parceiro_nome
        : "a equipe da plataforma";

  await Promise.all(
    destinatarios.map((destino) =>
      enviarSemFalhar({
        para: destino.email,
        nome: destino.nome,
        assunto: `Coleta cancelada: ${linha.codigo}`,
        ...montarEmail({
          titulo: "Coleta cancelada",
          saudacao: `Olá, ${destino.nome}.`,
          paragrafos: [
            `A coleta ${linha.codigo} foi cancelada por ${por}. O documento ` +
              "passa a constar como cancelado.",
          ],
          detalhes: [
            ["Retirada que estava marcada", formatarDataHora(linha.data_agendada)],
            ["Motivo", motivo],
          ],
          botao: botaoDoApp(),
        }),
      }),
    ),
  );
}

async function avisarLembrete(linha) {
  const quando = formatarDataHora(linha.data_agendada);

  await Promise.all([
    enviarSemFalhar({
      para: linha.parceiro_email,
      nome: linha.parceiro_nome,
      assunto: `Lembrete: coleta ${linha.codigo}`,
      ...montarEmail({
        titulo: "Coleta nas próximas 24 horas",
        saudacao: `Olá, ${linha.parceiro_nome}.`,
        paragrafos: ["Você tem uma retirada de material reciclável marcada."],
        detalhes: [
          ["Retirada", quando],
          ["Endereço", enderecoEmTexto(linha)],
          ["Materiais", linha.materiais_nomes.join(", ")],
        ],
        botao: botaoDoApp(),
      }),
    }),
    enviarSemFalhar({
      para: linha.gerador_email,
      nome: linha.gerador_nome,
      assunto: `Lembrete: retirada do seu material (${linha.codigo})`,
      ...montarEmail({
        titulo: "Retirada nas próximas 24 horas",
        saudacao: `Olá, ${linha.gerador_nome}.`,
        paragrafos: [
          `${linha.parceiro_nome} vai retirar o seu material reciclável. ` +
            "Deixe o acesso livre no horário combinado.",
        ],
        detalhes: [
          ["Retirada", quando],
          ["Materiais", linha.materiais_nomes.join(", ")],
        ],
        botao: botaoDoApp(),
      }),
    }),
  ]);
}

/** Aviso ao parceiro de que o cadastro foi aprovado. */
async function avisarAprovacaoDoParceiro(usuario) {
  await enviarSemFalhar({
    para: usuario.email,
    nome: usuario.nome_completo,
    assunto: "Seu cadastro de parceiro foi aprovado",
    ...montarEmail({
      titulo: "Cadastro aprovado",
      saudacao: `Olá, ${usuario.nome_completo}.`,
      paragrafos: [
        "Seu cadastro como parceiro de reciclagem foi aprovado. Entre no " +
          "aplicativo para completar o perfil (assinatura da empresa, área " +
          "de atuação e materiais) e escolher as primeiras coletas.",
      ],
      botao: botaoDoApp(),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Agendamento, cancelamento e conclusão                               */
/* ------------------------------------------------------------------ */

async function liberarOferta(ofertaId) {
  await sql`
    UPDATE ofertas_coleta SET status = 'ABERTA'
    WHERE id = ${ofertaId} AND status = 'AGENDADA'
  `;
}

/**
 * O parceiro agenda a retirada de uma sinalização.
 *
 * A reserva é um UPDATE condicionado ao status, então dois parceiros
 * nunca pegam a mesma sinalização.
 */
async function agendarColeta(usuario, corpo, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();

  if (typeof corpo.oferta_id !== "string" || !UUID_REGEX.test(corpo.oferta_id)) {
    throw erroDeValidacao("oferta_id", "Escolha uma sinalização.");
  }

  const dataAgendada = lerData(corpo.data_agendada, "data_agendada");
  const observacoes =
    typeof corpo.observacoes === "string" && corpo.observacoes.trim()
      ? corpo.observacoes.trim().slice(0, 500)
      : null;

  const minimo = somarHoras(agora, HORAS_ANTECEDENCIA);

  if (dataAgendada.getTime() < minimo.getTime()) {
    throw new ApiError(
      400,
      `A retirada precisa ser marcada com pelo menos ${HORAS_ANTECEDENCIA} ` +
        "horas de antecedência, para quem entrega ter tempo de recusar.",
      "PICKUP_TOO_SOON",
      { data_agendada: "Escolha um horário depois de 24 horas." },
    );
  }

  const parceiros = await sql`
    SELECT assinatura_path FROM detalhes_parceiro WHERE usuario_id = ${usuario.id}
  `;

  const assinaturaOrigem = parceiros[0]?.assinatura_path;

  if (!assinaturaOrigem) {
    throw new ApiError(
      400,
      "Envie a assinatura da empresa no perfil antes de agendar coletas.",
      "SIGNATURE_REQUIRED",
    );
  }

  const reservadas = await sql`
    UPDATE ofertas_coleta
    SET status = 'AGENDADA'
    WHERE id = ${corpo.oferta_id}
      AND status = 'ABERTA'
      AND janela_inicio <= ${dataAgendada.toISOString()}
      AND janela_fim >= ${dataAgendada.toISOString()}
    RETURNING id, anunciante_id, endereco_id, assinatura_path
  `;

  if (reservadas.length === 0) {
    const existentes = await sql`
      SELECT status FROM ofertas_coleta WHERE id = ${corpo.oferta_id}
    `;

    if (existentes.length === 0) {
      throw new ApiError(404, "Sinalização não encontrada.", "OFFER_NOT_FOUND");
    }

    if (existentes[0].status !== "ABERTA") {
      throw new ApiError(
        409,
        "Esta sinalização não está mais disponível.",
        "OFFER_UNAVAILABLE",
      );
    }

    throw new ApiError(
      400,
      "Escolha um horário dentro da janela informada por quem entrega.",
      "OUTSIDE_WINDOW",
      { data_agendada: "Fora da janela da sinalização." },
    );
  }

  const oferta = reservadas[0];
  const coletaId = crypto.randomUUID();
  const codigo = codigoDaColeta(coletaId);
  let assinaturaParceiroPath = null;

  try {
    let conteudo;

    try {
      conteudo = await lerArquivo(assinaturaOrigem);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }

      throw new ApiError(
        400,
        "A assinatura da empresa não foi encontrada. Envie-a de novo no perfil.",
        "SIGNATURE_REQUIRED",
      );
    }

    assinaturaParceiroPath = await salvarArquivo(
      "private/assinaturas",
      "png",
      conteudo,
    );

    const materiais = await sql`
      SELECT m.nome
      FROM oferta_materiais om
      INNER JOIN materiais_reciclaveis m ON m.id = om.material_id
      WHERE om.oferta_id = ${oferta.id}
      ORDER BY m.nome
    `;

    await sql`
      INSERT INTO coletas (
        id, consumidor_id, parceiro_id, endereco_id, materiais,
        data_agendada, status, oferta_id, agendada_em, cancelavel_ate,
        observacoes, codigo, documento_versao,
        assinatura_gerador_path, assinatura_parceiro_path
      )
      VALUES (
        ${coletaId}, ${oferta.anunciante_id}, ${usuario.id}, ${oferta.endereco_id},
        ${materiais.map((m) => m.nome).join(", ")},
        ${dataAgendada.toISOString()}, 'AGENDADA', ${oferta.id},
        ${agora.toISOString()}, ${somarHoras(agora, HORAS_ANTECEDENCIA).toISOString()},
        ${observacoes}, ${codigo}, ${VERSAO_TERMOS_COLETA},
        ${oferta.assinatura_path}, ${assinaturaParceiroPath}
      )
    `;
  } catch (error) {
    await liberarOferta(oferta.id);
    await removerArquivo(assinaturaParceiroPath);

    if (error.code === "ENOENT") {
      throw new ApiError(
        400,
        "Envie a assinatura da empresa no perfil antes de agendar coletas.",
        "SIGNATURE_REQUIRED",
      );
    }

    throw error;
  }

  // Documento e e-mails: se falharem, a coleta continua valendo e o
  // documento é gerado de novo quando alguém baixar.
  let pdf = null;

  try {
    pdf = (await emitirDocumento(coletaId)).buffer;
  } catch (error) {
    console.error("Coleta agendada, mas o documento não foi gerado:", error);
  }

  // A conversa já nasce com a coleta: aparece na aba Conversas dos dois lados.
  try {
    await chatService.garantirConversaDaColeta(coletaId);
  } catch (error) {
    console.error("Coleta agendada, mas a conversa não foi criada:", error.message);
  }

  const linhas = await consultaDaColeta(sql`c.id = ${coletaId}`);

  if (opcoes.semNotificacoes !== true) {
    avisarAgendamento(linhas[0], pdf).catch((error) =>
      console.error("Erro ao avisar o agendamento:", error.message),
    );
  }

  return serializarColeta(linhas[0], usuario, agora);
}

/**
 * Cancela uma coleta agendada.
 * - Quem entrega: até 24 horas depois do agendamento.
 * - Parceiro: a qualquer momento antes da retirada.
 * - Admin: sempre que estiver agendada.
 * A sinalização volta a ficar aberta (a não ser que já não dê tempo de
 * agendar outra, ou que quem entrega peça para encerrá-la).
 */
async function cancelarColeta(usuario, coletaId, corpo = {}, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();
  const linha = await carregarColeta(usuario, coletaId);

  if (linha.status !== "AGENDADA") {
    throw new ApiError(
      409,
      "Esta coleta não está mais agendada.",
      "COLLECTION_NOT_CANCELABLE",
    );
  }

  const { podeCancelar } = permissoes(linha, usuario, agora);

  if (!podeCancelar) {
    const ehQuemEntrega = PERFIS_QUE_ENTREGAM.includes(usuario.perfil);

    throw new ApiError(
      409,
      ehQuemEntrega
        ? "O prazo de 24 horas para cancelar terminou. Combine com o " +
            "parceiro pelo chat ou fale com o suporte."
        : "A retirada já passou do horário agendado.",
      ehQuemEntrega ? "CANCEL_WINDOW_EXPIRED" : "COLLECTION_NOT_CANCELABLE",
    );
  }

  const motivo =
    typeof corpo.motivo === "string" && corpo.motivo.trim()
      ? corpo.motivo.trim().slice(0, 300)
      : null;

  const atualizadas = await sql`
    UPDATE coletas
    SET status = 'CANCELADA',
        cancelada_em = ${agora.toISOString()},
        cancelada_por = ${usuario.id},
        cancelamento_motivo = ${motivo}
    WHERE id = ${coletaId} AND status = 'AGENDADA'
    RETURNING id
  `;

  if (atualizadas.length === 0) {
    throw new ApiError(
      409,
      "Esta coleta não está mais agendada.",
      "COLLECTION_NOT_CANCELABLE",
    );
  }

  const encerrar =
    PERFIS_QUE_ENTREGAM.includes(usuario.perfil) &&
    corpo.encerrar_sinalizacao === true;
  const aindaDaTempo =
    new Date(linha.janela_fim).getTime() >
    somarHoras(agora, HORAS_ANTECEDENCIA).getTime();

  await sql`
    UPDATE ofertas_coleta
    SET status = ${encerrar ? "CANCELADA" : aindaDaTempo ? "ABERTA" : "EXPIRADA"},
        cancelada_em = ${encerrar ? agora.toISOString() : null}
    WHERE id = ${linha.oferta_id}
  `;

  await sql`
    UPDATE conversas SET encerrada_em = ${agora.toISOString()}
    WHERE tipo = 'COLETA' AND coleta_id = ${coletaId}
  `;

  const atual = await carregarColeta({ ...usuario, perfil: "ADMIN" }, coletaId);

  const quem =
    usuario.perfil === "PARCEIRO"
      ? "PARCEIRO"
      : usuario.perfil === "ADMIN"
        ? "ADMIN"
        : "GERADOR";

  if (opcoes.semNotificacoes !== true) {
    avisarCancelamento(atual, quem).catch((error) =>
      console.error("Erro ao avisar o cancelamento:", error.message),
    );
  }

  return serializarColeta(atual, usuario, agora);
}

async function concluirColeta(usuario, coletaId, corpo = {}, opcoes = {}) {
  const agora = opcoes.agora ?? new Date();
  const linha = await carregarColeta(usuario, coletaId);
  const { podeConcluir } = permissoes(linha, usuario, agora);

  if (!podeConcluir) {
    throw new ApiError(
      409,
      linha.status === "AGENDADA"
        ? "A coleta só pode ser concluída a partir do horário agendado."
        : "Esta coleta não está mais agendada.",
      "COLLECTION_NOT_COMPLETABLE",
    );
  }

  let peso = null;

  if (corpo.peso_real_kg !== undefined && corpo.peso_real_kg !== null) {
    peso = Number(corpo.peso_real_kg);

    if (!Number.isFinite(peso) || peso <= 0 || peso > 100000) {
      throw erroDeValidacao("peso_real_kg", "Informe um peso entre 0,01 e 100.000 kg.");
    }
  }

  const concluidas = await sql`
    UPDATE coletas
    SET status = 'CONCLUIDA',
        concluida_em = ${agora.toISOString()},
        peso_real_kg = ${peso}
    WHERE id = ${coletaId} AND status = 'AGENDADA'
    RETURNING id
  `;

  if (concluidas.length === 0) {
    throw new ApiError(
      409,
      "Esta coleta não está mais agendada.",
      "COLLECTION_NOT_COMPLETABLE",
    );
  }

  await sql`
    UPDATE ofertas_coleta SET status = 'CONCLUIDA' WHERE id = ${linha.oferta_id}
  `;

  await sql`
    UPDATE conversas SET encerrada_em = ${agora.toISOString()}
    WHERE tipo = 'COLETA' AND coleta_id = ${coletaId}
  `;

  return detalheDaColeta(usuario, coletaId, { agora });
}

/* ------------------------------------------------------------------ */
/* Rotinas periódicas                                                  */
/* ------------------------------------------------------------------ */

/** Sinalizações abertas em que já não dá tempo de agendar viram EXPIRADA. */
async function expirarOfertas(agora = new Date()) {
  const expiradas = await sql`
    UPDATE ofertas_coleta
    SET status = 'EXPIRADA'
    WHERE status = 'ABERTA'
      AND janela_fim <= ${somarHoras(agora, HORAS_ANTECEDENCIA).toISOString()}
    RETURNING id
  `;

  return expiradas.length;
}

/** Lembra as duas partes de coletas que acontecem nas próximas 24 horas. */
async function enviarLembretes(agora = new Date()) {
  const linhas = await consultaDaColeta(
    sql`
      c.status = 'AGENDADA'
      AND c.lembrete_enviado_em IS NULL
      AND c.data_agendada > ${agora.toISOString()}
      AND c.data_agendada <= ${somarHoras(agora, HORAS_ANTECEDENCIA).toISOString()}
    `,
  );

  for (const linha of linhas) {
    // Marca antes de enviar: um e-mail a menos é melhor que repetido.
    await sql`
      UPDATE coletas SET lembrete_enviado_em = ${agora.toISOString()}
      WHERE id = ${linha.id}
    `;

    await avisarLembrete(linha);
  }

  return linhas.length;
}

async function varredura(agora = new Date()) {
  return {
    expiradas: await expirarOfertas(agora),
    lembretes: await enviarLembretes(agora),
  };
}

function iniciarVarreduraDeReciclagem(intervaloMs = 15 * 60 * 1000) {
  const executar = () =>
    varredura().catch((error) => {
      console.error("Erro na varredura de reciclagem:", error.message);
    });

  executar();

  const intervalo = setInterval(executar, intervaloMs);

  // Não impede o Node de finalizar.
  intervalo.unref();

  return intervalo;
}

function usuarioDaRequisicao(req) {
  return { id: req.usuario_id, perfil: req.tipo_perfil };
}

module.exports = {
  HORAS_ANTECEDENCIA,
  MIN_HORAS_JANELA,
  validarJanela,
  primeiroHorarioPossivel,
  usuarioDaRequisicao,
  criarOferta,
  minhasOfertas,
  cancelarOferta,
  ofertasDisponiveis,
  detalheDaOfertaParaParceiro,
  agendarColeta,
  listarColetas,
  detalheDaColeta,
  cancelarColeta,
  concluirColeta,
  documentoDaColeta,
  verificarDocumento,
  resumo,
  avisarAprovacaoDoParceiro,
  expirarOfertas,
  enviarLembretes,
  varredura,
  iniciarVarreduraDeReciclagem,
};
