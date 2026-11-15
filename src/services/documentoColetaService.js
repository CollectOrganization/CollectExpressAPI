/*
 * Documento de coleta de materiais recicláveis (PDF, pdfkit).
 *
 * Tem 3 assinaturas: a da plataforma Collect Express (o logo, junto do
 * código de autenticação), a de quem entrega o material e a do parceiro
 * que faz a retirada.
 *
 * O código de autenticação é um HMAC-SHA256, com segredo do servidor, dos
 * dados que importam do documento. Só a plataforma consegue gerá-lo, e a
 * rota pública de verificação confere se um documento é verdadeiro.
 */

const crypto = require("crypto");
const PDFDocument = require("pdfkit");

const {
  carregarLogo,
  titulo,
  linhaCampo,
  formatarDocumento,
  formatarDataHora,
  MARGEM,
  LARGURA_UTIL,
  VERDE,
  CINZA,
} = require("./contratoPdfService");

// Versão do texto do termo aceito junto com a sinalização.
const VERSAO_TERMOS_COLETA = "1.0";

const PREFIXO_CODIGO = "COL-REC-";

const CLAUSULAS = [
  "Quem entrega declara ser responsável pelos materiais descritos neste " +
    "documento e que eles estão separados por tipo, sem resíduos perigosos, " +
    "hospitalares, contaminados ou de origem ilícita.",
  "O Parceiro retira os materiais na data e no horário agendados, no " +
    "endereço informado, e se compromete a dar a eles destinação " +
    "ambientalmente adequada, conforme a legislação aplicável.",
  "Quem entrega garante o acesso ao local no horário combinado. As " +
    "quantidades informadas são estimativas e podem variar na retirada.",
  "O Parceiro só pode agendar a retirada com pelo menos 24 horas de " +
    "antecedência. Nesse período, quem entrega pode cancelar a retirada " +
    "pelo aplicativo, sem custo. Fora desse prazo, o cancelamento depende " +
    "de acordo entre as partes pelo chat do aplicativo ou do suporte.",
  "O Parceiro também pode cancelar a retirada antes da data agendada, " +
    "pelo aplicativo. Cancelamentos tornam este documento sem efeito, e ele " +
    "passa a constar como CANCELADO.",
  "A Collect Express atua como plataforma de intermediação e autenticação " +
    "do documento. Esta operação não envolve pagamento pela plataforma, e " +
    "eventual acordo financeiro é de responsabilidade das partes.",
  "As assinaturas foram aplicadas eletronicamente com o aceite registrado " +
    "no aplicativo. Os dados pessoais são tratados conforme a política de " +
    "privacidade da plataforma.",
];

function segredo() {
  const valor =
    process.env.DOCUMENT_SIGNING_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim();

  if (!valor) {
    throw new Error(
      "Defina DOCUMENT_SIGNING_SECRET (ou JWT_SECRET) para autenticar documentos.",
    );
  }

  return valor;
}

/** `COL-REC-` + 8 caracteres do id da coleta. */
function codigoDaColeta(coletaId) {
  return `${PREFIXO_CODIGO}${String(coletaId)
    .replaceAll("-", "")
    .substring(0, 8)
    .toUpperCase()}`;
}

function sha256(conteudo) {
  return crypto
    .createHash("sha256")
    .update(conteudo ?? "")
    .digest("hex");
}

/**
 * Código de autenticação (64 caracteres hexadecimais) do documento.
 *
 * Entram: identificação, as partes, a data da retirada, os materiais e
 * as impressões digitais (SHA-256) das duas assinaturas. Mudar qualquer
 * um deles muda o código.
 */
function calcularAutenticacao(dados) {
  const canonico = [
    dados.codigo,
    dados.versao,
    dados.geradorId,
    dados.parceiroId,
    new Date(dados.agendadaEm).toISOString(),
    new Date(dados.dataAgendada).toISOString(),
    [...dados.materiais].sort().join(","),
    sha256(dados.assinaturaGerador),
    sha256(dados.assinaturaParceiro),
  ].join("|");

  return crypto
    .createHmac("sha256", segredo())
    .update(canonico)
    .digest("hex");
}

/** `A1B2-C3D4-E5F6-0718`: os 16 primeiros caracteres, em grupos de 4. */
function autenticacaoCurta(hash) {
  return String(hash)
    .substring(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, "$1-");
}

/** Compara em tempo constante; aceita o código completo ou o curto. */
function autenticacaoConfere(hashGuardado, informado) {
  const limpo = String(informado ?? "")
    .replace(/[^0-9a-fA-F]/g, "")
    .toLowerCase();

  if (limpo.length < 16 || limpo.length > 64) {
    return false;
  }

  const esperado = String(hashGuardado).toLowerCase().substring(0, limpo.length);

  return (
    esperado.length === limpo.length &&
    crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(limpo))
  );
}

function blocoDeAssinaturas(doc, dados, logo) {
  const altura = 140;
  const espaco = 18;
  const largura = (LARGURA_UTIL - espaco * 2) / 3;

  if (doc.y + altura + 40 > doc.page.height - MARGEM) {
    doc.addPage();
  }

  titulo(doc, "Assinaturas");

  const topo = doc.y + 6;
  const areaImagem = 62;

  const colunas = [
    {
      imagem: logo,
      nome: "Collect Express",
      papel: "Plataforma",
      nota: `Autenticação ${autenticacaoCurta(dados.autenticacao)}`,
    },
    {
      imagem: dados.gerador.assinatura,
      nome: dados.gerador.nome,
      papel: `Quem entrega (${dados.gerador.tipo})`,
      nota: `Aceite em ${formatarDataHora(dados.aceite.em)}`,
    },
    {
      imagem: dados.parceiro.assinatura,
      nome: dados.parceiro.nome,
      papel: "Parceiro de reciclagem",
      nota: `Agendou em ${formatarDataHora(dados.agendadaEm)}`,
    },
  ];

  colunas.forEach((coluna, indice) => {
    const x = MARGEM + indice * (largura + espaco);

    if (coluna.imagem) {
      try {
        doc.image(coluna.imagem, x + 4, topo, {
          fit: [largura - 8, areaImagem],
          align: "center",
          valign: "bottom",
        });
      } catch (erro) {
        console.error("Assinatura inválida no documento:", erro.message);
      }
    }

    const linhaY = topo + areaImagem + 4;

    doc
      .moveTo(x, linhaY)
      .lineTo(x + largura, linhaY)
      .strokeColor("#000000")
      .lineWidth(0.7)
      .stroke();

    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor("#000000")
      .text(coluna.nome, x, linhaY + 4, {
        width: largura,
        align: "center",
        height: 22,
        ellipsis: true,
      });

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(CINZA)
      .text(coluna.papel, x, linhaY + 17, {
        width: largura,
        align: "center",
        height: 12,
        ellipsis: true,
      });

    doc.fontSize(7.5).text(coluna.nota, x, linhaY + 29, {
      width: largura,
      align: "center",
    });
  });

  doc.y = topo + areaImagem + 60;
  doc.x = MARGEM;
}

/**
 * Monta o PDF a partir de dados já carregados.
 *
 * @param {object} dados
 * @param {string} dados.codigo
 * @param {string} dados.versao
 * @param {string} dados.autenticacao hash completo (hex).
 * @param {"AGENDADA"|"CONCLUIDA"|"CANCELADA"} dados.status
 * @returns {Promise<Buffer>}
 */
function gerarDocumentoPdf(dados) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: MARGEM,
        info: {
          Title: `Documento de coleta ${dados.codigo}`,
          Author: "Collect Express",
          Subject: "Coleta de materiais recicláveis",
        },
      });

      const partes = [];
      doc.on("data", (parte) => partes.push(parte));
      doc.on("end", () => resolve(Buffer.concat(partes)));
      doc.on("error", reject);

      const logo = carregarLogo();
      const cancelado = dados.status === "CANCELADA";

      if (logo) {
        doc.image(logo, MARGEM, MARGEM, { width: 105 });
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#000000")
        .text(
          "TERMO DE COLETA DE MATERIAL RECICLÁVEL",
          MARGEM + 120,
          MARGEM + 4,
          { width: LARGURA_UTIL - 120, align: "right" },
        );

      doc.font("Helvetica").fontSize(9.5).fillColor(CINZA);

      doc.text(`Documento nº ${dados.codigo}`, MARGEM, doc.y, {
        width: LARGURA_UTIL,
        align: "right",
      });

      doc.text(
        `Emitido em ${formatarDataHora(dados.agendadaEm)}`,
        MARGEM,
        doc.y,
        { width: LARGURA_UTIL, align: "right" },
      );

      doc.y = MARGEM + 58;
      doc.fillColor("#000000");

      if (cancelado) {
        doc
          .font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#B00020")
          .text(
            `DOCUMENTO CANCELADO em ${formatarDataHora(dados.canceladaEm)} ` +
              "- sem efeito.",
            MARGEM,
            doc.y,
            { width: LARGURA_UTIL, align: "center" },
          );
        doc.moveDown(0.3).fillColor("#000000");
      }

      titulo(doc, "1. Partes");
      linhaCampo(
        doc,
        `Quem entrega (${dados.gerador.tipo})`,
        `${dados.gerador.nome} (${formatarDocumento(dados.gerador.documento)})`,
      );
      linhaCampo(doc, "Endereço da retirada", dados.gerador.endereco);
      linhaCampo(
        doc,
        "Parceiro de reciclagem",
        `${dados.parceiro.nome} (${formatarDocumento(dados.parceiro.documento)})`,
      );

      if (dados.parceiro.responsavel) {
        linhaCampo(doc, "Responsável", dados.parceiro.responsavel);
      }

      titulo(doc, "2. Material");
      linhaCampo(doc, "Tipos", dados.materiais.join(", "));
      linhaCampo(doc, "Descrição", dados.descricao);
      linhaCampo(doc, "Quantidade estimada", dados.quantidade);

      if (dados.observacoes) {
        linhaCampo(doc, "Observações", dados.observacoes);
      }

      titulo(doc, "3. Retirada");
      linhaCampo(
        doc,
        "Data e hora agendadas",
        formatarDataHora(dados.dataAgendada),
      );
      linhaCampo(
        doc,
        "Janela informada",
        `${formatarDataHora(dados.janela.inicio)} a ${formatarDataHora(dados.janela.fim)}`,
      );
      linhaCampo(
        doc,
        "Cancelamento sem custo até",
        formatarDataHora(dados.cancelavelAte),
      );

      titulo(doc, "4. Condições");
      doc.font("Helvetica").fontSize(9).fillColor("#000000");

      CLAUSULAS.forEach((clausula, indice) => {
        doc.x = MARGEM;
        doc.text(`${indice + 1}. ${clausula}`, {
          width: LARGURA_UTIL,
          align: "justify",
        });
        doc.moveDown(0.35);
      });

      blocoDeAssinaturas(doc, dados, logo);

      titulo(doc, "Autenticação");
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor("#000000")
        .text(
          "Código de autenticação do documento (HMAC-SHA256, gerado pela " +
            "plataforma Collect Express):",
          MARGEM,
          doc.y,
          { width: LARGURA_UTIL },
        );

      doc
        .font("Courier-Bold")
        .fontSize(8)
        .fillColor(VERDE)
        .text(dados.autenticacao, MARGEM, doc.y + 2, {
          width: LARGURA_UTIL,
        });

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(CINZA)
        .text(
          `Para conferir, informe o número ${dados.codigo} e o código ` +
            `${autenticacaoCurta(dados.autenticacao)} na verificação de ` +
            "documentos da plataforma" +
            `${dados.verificacaoUrl ? ` (${dados.verificacaoUrl})` : ""}. ` +
            "Aceite registrado em " +
            `${formatarDataHora(dados.aceite.em)}` +
            `${dados.aceite.ip ? ` (IP ${dados.aceite.ip})` : ""}.`,
          MARGEM,
          doc.y + 4,
          { width: LARGURA_UTIL },
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  VERSAO_TERMOS_COLETA,
  codigoDaColeta,
  calcularAutenticacao,
  autenticacaoCurta,
  autenticacaoConfere,
  gerarDocumentoPdf,
};
