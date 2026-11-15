/*
 * "Hoje" para as regras de negócio é o dia de Brasília, não o do servidor.
 *
 * O Render roda em UTC. Depois das 21h de Brasília o relógio do servidor
 * já está no dia seguinte, então "amanhã" para o cliente virava "hoje" no
 * servidor e o checkout recusava a data com "entre 1 e 60 dias".
 */

const FUSO_DO_NEGOCIO = "America/Sao_Paulo";

const formatador = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_DO_NEGOCIO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` do dia de Brasília em [agora]. */
function dataDeHojeNoBrasil(agora = new Date()) {
  return formatador.format(agora);
}

/**
 * Quantos dias [dataString] (`YYYY-MM-DD`) está depois de hoje em
 * Brasília. Hoje = 0, amanhã = 1.
 */
function diasAteADataNoBrasil(dataString, agora = new Date()) {
  const [ano, mes, dia] = dataString.split("-").map(Number);
  const [anoHoje, mesHoje, diaHoje] = dataDeHojeNoBrasil(agora)
    .split("-")
    .map(Number);

  // Em UTC não há horário de verão, então a diferença é sempre exata.
  const alvo = Date.UTC(ano, mes - 1, dia);
  const hoje = Date.UTC(anoHoje, mesHoje - 1, diaHoje);

  return Math.round((alvo - hoje) / (24 * 60 * 60 * 1000));
}

module.exports = {
  FUSO_DO_NEGOCIO,
  dataDeHojeNoBrasil,
  diasAteADataNoBrasil,
};
