/*
 * Geração do contrato de locação em PDF (pdfkit).
 *
 * O serviço só monta o documento a partir de dados já carregados; não
 * acessa banco nem disco (exceto o logo em src/assets). Isso facilita
 * testar e permite regerar o PDF a qualquer momento.
 */

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// Versão do texto de Termos e Condições aceito junto com o contrato.
const VERSAO_TERMOS = "1.0";

const CAMINHO_LOGO = path.join(__dirname, "..", "assets", "logo.png");

const VERDE = "#4C7A1E";
const CINZA = "#555555";
const LINHA = "#BBBBBB";

const MARGEM = 50;
const LARGURA_PAGINA = 595.28;
const LARGURA_UTIL = LARGURA_PAGINA - MARGEM * 2;

const REGRAS = [
  "A caçamba é entregue no endereço informado, a partir da data de início, " +
    "e deve permanecer nele durante todo o período contratado. O Locatário " +
    "garante local adequado e acesso para o veículo da Locadora.",
  "O Locatário responde pela guarda da caçamba e por danos causados por " +
    "mau uso durante o período da locação.",
  "É proibido depositar resíduos perigosos, inflamáveis, hospitalares, " +
    "orgânicos ou qualquer material não permitido pela legislação, e " +
    "ultrapassar a altura da borda da caçamba.",
  "Quando a prefeitura exigir autorização para colocar a caçamba em via " +
    "pública, a obtenção dela é responsabilidade do Locatário.",
  "A retirada ocorre ao fim do prazo ou quando solicitada pelo Locatário " +
    "no aplicativo. A extensão do prazo depende de aceite da Locadora e de " +
    "pagamento pela plataforma, quando a caçamba permitir.",
  "O pagamento é realizado pela plataforma Collect Express, por PIX.",
  "Cancelamentos, reembolsos e demais situações seguem os Termos e " +
    "Condições do aplicativo. Os dados pessoais são tratados conforme a " +
    "política de privacidade da plataforma.",
];

function apenasDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/** Formata CPF (11 dígitos) ou CNPJ (14). Outros tamanhos passam sem mudança. */
function formatarDocumento(valor) {
  const digitos = apenasDigitos(valor);

  if (digitos.length === 11) {
    return digitos.replace(
      /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
      "$1.$2.$3-$4",
    );
  }

  if (digitos.length === 14) {
    return digitos.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      "$1.$2.$3/$4-$5",
    );
  }

  return valor ? String(valor) : "-";
}

function formatarMoeda(valor) {
  return Number(valor ?? 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * Extrai ano, mês e dia de uma coluna DATE, que pode chegar como
 * string "YYYY-MM-DD" ou como Date (meia-noite local, do driver).
 */
function partesDaData(valor) {
  if (valor instanceof Date) {
    return {
      ano: valor.getFullYear(),
      mes: valor.getMonth() + 1,
      dia: valor.getDate(),
    };
  }

  const texto = String(valor ?? "").slice(0, 10);
  const [ano, mes, dia] = texto.split("-").map(Number);

  return { ano, mes, dia };
}

function formatarData(valor) {
  const { ano, mes, dia } = partesDaData(valor);

  if (!ano || !mes || !dia) {
    return "-";
  }

  return [
    String(dia).padStart(2, "0"),
    String(mes).padStart(2, "0"),
    ano,
  ].join("/");
}

/** Data de término = início + dias (a caçamba é retirada nesse dia). */
function dataDeTermino(inicio, dias) {
  const { ano, mes, dia } = partesDaData(inicio);

  if (!ano || !mes || !dia) {
    return null;
  }

  return new Date(Date.UTC(ano, mes - 1, dia + Number(dias || 0)));
}

function formatarDataUtc(data) {
  if (!data) {
    return "-";
  }

  return [
    String(data.getUTCDate()).padStart(2, "0"),
    String(data.getUTCMonth() + 1).padStart(2, "0"),
    data.getUTCFullYear(),
  ].join("/");
}

/** Data e hora no fuso de Brasília. */
function formatarDataHora(valor) {
  const data = valor instanceof Date ? valor : new Date(valor);

  if (Number.isNaN(data.getTime())) {
    return "-";
  }

  return data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function carregarLogo() {
  try {
    return fs.readFileSync(CAMINHO_LOGO);
  } catch (_) {
    return null;
  }
}

function titulo(doc, texto) {
  // Textos com posição explícita deslocam doc.x; volta para a margem.
  doc.x = MARGEM;

  doc
    .moveDown(0.8)
    .font("Helvetica-Bold")
    .fontSize(10.5)
    .fillColor(VERDE)
    .text(texto.toUpperCase());

  doc
    .moveTo(MARGEM, doc.y + 1)
    .lineTo(MARGEM + LARGURA_UTIL, doc.y + 1)
    .strokeColor(LINHA)
    .lineWidth(0.5)
    .stroke();

  doc.moveDown(0.4).fillColor("#000000");
}

function linhaCampo(doc, rotulo, valor) {
  doc.x = MARGEM;

  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(`${rotulo}: `, { continued: true })
    .font("Helvetica")
    .text(String(valor ?? "-"));
}

function tabelaDeItens(doc, itens) {
  const colunas = [
    { titulo: "Caçamba", largura: 190, alinhar: "left" },
    { titulo: "Tamanho", largura: 55, alinhar: "right" },
    { titulo: "Qtd.", largura: 35, alinhar: "right" },
    { titulo: "Dias", largura: 35, alinhar: "right" },
    { titulo: "Diária", largura: 85, alinhar: "right" },
    { titulo: "Subtotal", largura: 95, alinhar: "right" },
  ];

  const desenharLinha = (valores, negrito) => {
    const topo = doc.y;
    let x = MARGEM;

    doc
      .font(negrito ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9);

    valores.forEach((valor, indice) => {
      const coluna = colunas[indice];

      doc.text(String(valor), x + 2, topo, {
        width: coluna.largura - 4,
        align: coluna.alinhar,
        lineBreak: indice === 0,
      });

      x += coluna.largura;
    });

    doc.x = MARGEM;
    doc.y = Math.max(doc.y, topo + 13);
  };

  desenharLinha(colunas.map((coluna) => coluna.titulo), true);

  doc
    .moveTo(MARGEM, doc.y)
    .lineTo(MARGEM + LARGURA_UTIL, doc.y)
    .strokeColor(LINHA)
    .lineWidth(0.5)
    .stroke();

  doc.moveDown(0.2);

  for (const item of itens) {
    const subtotal =
      Number(item.quantidade) *
      Number(item.dias) *
      Number(item.preco_diaria);

    desenharLinha(
      [
        item.nome,
        `${Number(item.tamanho_m3)} m³`,
        item.quantidade,
        item.dias,
        formatarMoeda(item.preco_diaria),
        formatarMoeda(subtotal),
      ],
      false,
    );
  }
}

/**
 * Rodapé com 3 colunas de assinatura:
 * Collect Express | Locatário (consumidor) | Locadora (caçambeiro).
 */
function blocoDeAssinaturas(doc, dados, logo) {
  const altura = 130;
  const espaco = 18;
  const largura = (LARGURA_UTIL - espaco * 2) / 3;

  // Mantém o bloco inteiro na mesma página.
  if (doc.y + altura + 40 > doc.page.height - MARGEM) {
    doc.addPage();
  }

  titulo(doc, "Assinaturas");

  const topo = doc.y + 6;
  const areaImagem = 62;

  const colunas = [
    {
      imagem: logo,
      fallback: null,
      nome: "Collect Express",
      papel: "Plataforma",
      nota: "Assinado eletronicamente",
    },
    {
      imagem: dados.locatario.assinatura,
      fallback: null,
      nome: dados.locatario.nome,
      papel: "Locatário",
      nota: `Aceite em ${formatarDataHora(dados.aceite.em)}`,
    },
    {
      imagem: dados.locadora.assinatura,
      fallback: "Assinado eletronicamente via plataforma",
      nome: dados.locadora.nome,
      papel: "Locadora",
      nota: `Autorizado em ${formatarDataHora(dados.emitidoEm)}`,
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
        console.error("Assinatura inválida no contrato:", erro.message);
      }
    } else if (coluna.fallback) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(8.5)
        .fillColor(CINZA)
        .text(coluna.fallback, x + 4, topo + areaImagem / 2 - 6, {
          width: largura - 8,
          align: "center",
        });
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
      })
      .text(coluna.nota, x, linhaY + 28, {
        width: largura,
        align: "center",
      });
  });

  doc.y = topo + areaImagem + 50;
  doc.fillColor("#000000");
}

/**
 * Gera o PDF do contrato.
 *
 * @param {object} dados
 * @param {string} dados.numero             ex.: COL-1A2B3C4D5E
 * @param {Date|string} dados.emitidoEm
 * @param {{nome, documento, assinatura?: Buffer}} dados.locadora
 * @param {{nome, documento, email, assinatura: Buffer}} dados.locatario
 * @param {{logradouro, numero, bairro, cidade_estado, cep}} dados.endereco
 * @param {Array<{nome, tamanho_m3, quantidade, dias, preco_diaria}>} dados.itens
 * @param {Date|string} dados.dataInicio
 * @param {number} dados.dias
 * @param {number} dados.taxaEntrega
 * @param {number} dados.total
 * @param {{em: Date|string, ip?: string}} dados.aceite
 * @param {string} [dados.versaoTermos]
 *
 * @returns {Promise<Buffer>}
 */
function gerarContratoPdf(dados) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: MARGEM,
        info: {
          Title: `Contrato de locação ${dados.numero}`,
          Author: "Collect Express",
          Subject: "Contrato de locação de caçamba",
        },
      });

      const partes = [];
      doc.on("data", (parte) => partes.push(parte));
      doc.on("end", () => resolve(Buffer.concat(partes)));
      doc.on("error", reject);

      const logo = carregarLogo();
      const versao = dados.versaoTermos || VERSAO_TERMOS;

      // Cabeçalho
      if (logo) {
        doc.image(logo, MARGEM, MARGEM, { width: 105 });
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(15)
        .fillColor("#000000")
        .text(
          "CONTRATO DE LOCAÇÃO DE CAÇAMBA",
          MARGEM + 120,
          MARGEM + 4,
          { width: LARGURA_UTIL - 120, align: "right" },
        );

      doc.font("Helvetica").fontSize(9.5).fillColor(CINZA);

      doc.text(`Contrato nº ${dados.numero}`, MARGEM, doc.y, {
        width: LARGURA_UTIL,
        align: "right",
      });

      doc.text(
        `Emitido em ${formatarDataHora(dados.emitidoEm)}`,
        MARGEM,
        doc.y,
        { width: LARGURA_UTIL, align: "right" },
      );

      doc.y = MARGEM + 58;
      doc.fillColor("#000000");

      titulo(doc, "1. Partes");
      linhaCampo(
        doc,
        "Locadora",
        `${dados.locadora.nome} (${formatarDocumento(dados.locadora.documento)})`,
      );
      linhaCampo(
        doc,
        "Locatário",
        `${dados.locatario.nome} (${formatarDocumento(dados.locatario.documento)})`,
      );
      linhaCampo(doc, "E-mail do Locatário", dados.locatario.email);
      linhaCampo(
        doc,
        "Intermediação",
        "Plataforma Collect Express",
      );

      titulo(doc, "2. Objeto");
      tabelaDeItens(doc, dados.itens);

      const termino = dataDeTermino(dados.dataInicio, dados.dias);

      titulo(doc, "3. Prazo e local de entrega");
      linhaCampo(doc, "Início da locação", formatarData(dados.dataInicio));
      linhaCampo(doc, "Duração", `${dados.dias} dia(s)`);
      linhaCampo(doc, "Retirada prevista", formatarDataUtc(termino));

      const endereco = dados.endereco;
      linhaCampo(
        doc,
        "Endereço de entrega",
        `${endereco.logradouro}, ${endereco.numero} - ${endereco.bairro}, ` +
          `${endereco.cidade_estado} - CEP ${endereco.cep}`,
      );

      titulo(doc, "4. Valores");
      const taxa = Number(dados.taxaEntrega ?? 0);
      linhaCampo(
        doc,
        "Locação das caçambas",
        formatarMoeda(Number(dados.total) - taxa),
      );
      linhaCampo(doc, "Taxa de entrega", formatarMoeda(taxa));
      linhaCampo(doc, "Valor total da locação", formatarMoeda(dados.total));
      linhaCampo(
        doc,
        "Forma de pagamento",
        "PIX, pela plataforma, após a confirmação do pedido",
      );

      titulo(doc, "5. Regras básicas da locação");
      doc.font("Helvetica").fontSize(9);
      REGRAS.forEach((regra, indice) => {
        doc.text(`${indice + 1}. ${regra}`, MARGEM, doc.y, {
          width: LARGURA_UTIL,
          align: "justify",
        });
        doc.moveDown(0.25);
      });

      doc.x = MARGEM;

      doc
        .moveDown(0.4)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(
          "Em caso de dúvida sobre qualquer ponto deste contrato, deve ser " +
            "considerado estritamente o que consta na página de Termos e " +
            `Condições do aplicativo (versão ${versao}), cujo aceite foi ` +
            "registrado no momento do pedido.",
          { width: LARGURA_UTIL, align: "justify" },
        );

      blocoDeAssinaturas(doc, dados, logo);

      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(CINZA)
        .text(
          `Documento assinado eletronicamente. Aceite registrado em ` +
            `${formatarDataHora(dados.aceite.em)}` +
            `${dados.aceite.ip ? ` (IP ${dados.aceite.ip})` : ""}.`,
          MARGEM,
          doc.y,
          { width: LARGURA_UTIL, align: "center" },
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  VERSAO_TERMOS,
  gerarContratoPdf,
  formatarDocumento,
  formatarMoeda,
  formatarData,
  dataDeTermino,
};
