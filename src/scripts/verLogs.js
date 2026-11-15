const sql = require("../config/db");

/*
 * Resumo dos logs gravados em logs_erros.
 *
 *   npm run logs:ver
 *   npm run logs:ver -- --horas 72 --nivel ERRO --origem APP --limite 50
 *   npm run logs:ver -- --codigo INVALID_START_DATE
 */

function argumento(nome, padrao) {
  const indice = process.argv.indexOf(`--${nome}`);

  return indice >= 0 && process.argv[indice + 1]
    ? process.argv[indice + 1]
    : padrao;
}

function curto(valor, limite) {
  const texto = String(valor ?? "");
  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}

async function main() {
  const horas = Math.max(1, Number(argumento("horas", 24)) || 24);
  const nivel = argumento("nivel", null);
  const origem = argumento("origem", null);
  const codigo = argumento("codigo", null);
  const limite = Math.min(500, Math.max(1, Number(argumento("limite", 30)) || 30));

  const filtro = sql`
    criado_em >= NOW() - make_interval(hours => ${horas})
    AND (${nivel}::text IS NULL OR nivel = ${nivel})
    AND (${origem}::text IS NULL OR origem = ${origem})
    AND (${codigo}::text IS NULL OR codigo = ${codigo})
  `;

  const grupos = await sql`
    SELECT
      origem, nivel, codigo, COALESCE(metodo || ' ' || rota, tela, '-') AS onde,
      COUNT(*)::int AS total,
      MAX(criado_em) AS ultimo
    FROM logs_erros
    WHERE ${filtro}
    GROUP BY origem, nivel, codigo, COALESCE(metodo || ' ' || rota, tela, '-')
    ORDER BY total DESC
    LIMIT 40
  `;

  console.log(`\n=== Resumo das últimas ${horas} h ===`);

  if (grupos.length === 0) {
    console.log("Nenhum log encontrado.");
  }

  for (const g of grupos) {
    console.log(
      `${String(g.total).padStart(5)}x  ${g.origem} ${g.nivel.padEnd(5)} ` +
        `${curto(g.codigo, 30).padEnd(30)} ${curto(g.onde, 60)}  ` +
        `(último: ${new Date(g.ultimo).toLocaleString("pt-BR")})`,
    );
  }

  const recentes = await sql`
    SELECT criado_em, origem, nivel, codigo, mensagem, metodo, rota,
           status_http, tela, perfil, detalhes
    FROM logs_erros
    WHERE ${filtro}
    ORDER BY criado_em DESC
    LIMIT ${limite}
  `;

  console.log(`\n=== ${recentes.length} registros mais recentes ===`);

  for (const r of recentes) {
    console.log(
      `\n[${new Date(r.criado_em).toLocaleString("pt-BR")}] ` +
        `${r.origem} ${r.nivel} ${r.codigo ?? ""} ` +
        `${r.status_http ?? ""} ${r.metodo ?? ""} ${r.rota ?? r.tela ?? ""} ` +
        `${r.perfil ?? ""}`,
    );
    console.log(`  ${curto(r.mensagem, 300)}`);

    if (r.detalhes) {
      console.log(`  ${curto(JSON.stringify(r.detalhes), 500)}`);
    }
  }

}

main().catch((erro) => {
  console.error("Erro ao ler os logs:", erro.message);
  process.exitCode = 1;
});
