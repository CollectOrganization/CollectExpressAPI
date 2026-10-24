require("dotenv").config();

const sql = require("../config/db");

const API_URL =
  process.env.API_TEST_URL || "http://localhost:3001/api";

const BYPASS = process.env.TEST_RATE_LIMIT_BYPASS || "";

if (!BYPASS) {
  console.error(
    "❌ TEST_RATE_LIMIT_BYPASS não configurado no .env. " +
      "Defina um valor para liberar o rate limit durante os testes.",
  );
  process.exit(1);
}

const EXPECTED_PROFILES = [
  { email: "admin@collectexpress.com", tipo: "ADMIN", status: "ATIVO" },
  { email: "admin.pendente@collectexpress.com", tipo: "ADMIN", status: "PENDENTE" },
  { email: "admin.suspenso@collectexpress.com", tipo: "ADMIN", status: "SUSPENSO" },
  { email: "joao@construtor.com", tipo: "CONSUMIDOR", status: "ATIVO" },
  { email: "maria@reformas.com", tipo: "CONSUMIDOR", status: "ATIVO" },
  { email: "consumidor.pendente@collectexpress.com", tipo: "CONSUMIDOR", status: "PENDENTE" },
  { email: "consumidor.suspenso@collectexpress.com", tipo: "CONSUMIDOR", status: "SUSPENSO" },
  { email: "silva@cacambas.com", tipo: "CACAMBEIRO", status: "ATIVO" },
  { email: "contato@entulhorapido.com", tipo: "CACAMBEIRO", status: "PENDENTE" },
  { email: "cacambeiro.suspenso@collectexpress.com", tipo: "CACAMBEIRO", status: "SUSPENSO" },
];

const EXPECTED_CATEGORIAS = ["Entulho de Obra", "Podas", "Recicláveis"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",

      /*
       * Header que libera o rate limit em ambiente de testes.
       * Nunca é aceito quando NODE_ENV === "production".
       */
      "x-test-bypass": BYPASS,

      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  return { status: response.status, body };
}

async function testProfilesExist() {
  console.log("1. Verificando matriz de perfis...");

  const rows = await sql`
    SELECT email, tipo_perfil, status
    FROM usuarios
    ORDER BY email
  `;

  const map = new Map(rows.map((r) => [r.email, r]));

  for (const expected of EXPECTED_PROFILES) {
    const actual = map.get(expected.email);

    assert(
      actual,
      `Perfil ${expected.email} não existe na seed.`,
    );
    assert(
      actual.tipo_perfil === expected.tipo,
      `Tipo de ${expected.email}: esperado ${expected.tipo}, recebido ${actual.tipo_perfil}.`,
    );

    assert(
      actual.status === expected.status,
      `Status de ${expected.email}: esperado ${expected.status}, recebido ${actual.status}. ` +
        `Rode "npm run seed" para restaurar o estado inicial.`,
    );
    // Bloco foi descontinuado
    /*assert(
      actual.status === expected.status,
      `Status de ${expected.email}: esperado ${expected.status}, recebido ${actual.status}.`,
    );*/
  }

  console.log(
    `✅ ${EXPECTED_PROFILES.length} perfis conferidos ` +
      `(3 ADMIN, 4 CONSUMIDOR, 3 CACAMBEIRO).`,
  );
}

async function testCategoriasCobertas() {
  console.log("2. Verificando cobertura de categorias...");

  const rows = await sql`
    SELECT tipo_residuo, COUNT(*)::int AS total
    FROM cacambas
    GROUP BY tipo_residuo
  `;

  const map = new Map(rows.map((r) => [r.tipo_residuo, r.total]));

  for (const categoria of EXPECTED_CATEGORIAS) {
    assert(
      map.has(categoria) && map.get(categoria) > 0,
      `Categoria "${categoria}" não possui caçamba na seed.`,
    );
  }

  console.log(
    `✅ Cada categoria (${EXPECTED_CATEGORIAS.join(", ")}) tem pelo menos 1 caçamba.`,
  );
}

async function testLoginMatrix() {
  console.log("3. Verificando matriz de login...");

  await sql`DELETE FROM login_attempts`;

  let ok = 0;
  let pendingBlocked = 0;
  let suspendedBlocked = 0;

  for (const p of EXPECTED_PROFILES) {
    const { status, body } = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: p.email, senha: "123456" }),
    });

    if (p.status === "ATIVO") {
      assert(
        status === 200,
        `Login ATIVO deveria retornar 200 para ${p.email}, recebeu ${status} (${JSON.stringify(body)}).`,
      );
      assert(
        body?.data?.usuario?.tipo_perfil === p.tipo,
        `Perfil incorreto no login de ${p.email}.`,
      );
      ok++;
      continue;
    }

    if (p.status === "PENDENTE") {
      assert(
        status === 403 && body?.code === "USER_PENDING",
        `Login PENDENTE deveria bloquear ${p.email} com USER_PENDING, recebeu ${status} (${JSON.stringify(body)}).`,
      );
      pendingBlocked++;
      continue;
    }

    if (p.status === "SUSPENSO") {
      assert(
        status === 403 && body?.code === "USER_SUSPENDED",
        `Login SUSPENSO deveria bloquear ${p.email} com USER_SUSPENDED, recebeu ${status} (${JSON.stringify(body)}).`,
      );
      suspendedBlocked++;
      continue;
    }
  }

  console.log(
    `✅ ${ok} contas ATIVAS logaram, ${pendingBlocked} PENDENTES e ` +
      `${suspendedBlocked} SUSPENSAS foram bloqueadas corretamente.`,
  );
}

async function testAprovacaoPendente() {
  console.log("4. Verificando aprovação de fornecedor PENDENTE...");

  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@collectexpress.com",
      senha: "123456",
    }),
  });

  assert(
    adminLogin.status === 200,
    `Login do admin falhou: ${adminLogin.status} ${JSON.stringify(adminLogin.body)}.`,
  );

  const adminToken = adminLogin.body.data.access_token;

  const [pendente] = await sql`
    SELECT id FROM usuarios
    WHERE email = 'contato@entulhorapido.com'
    LIMIT 1
  `;

  const aprovacao = await request(
    `/usuarios/${pendente.id}/status`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: "ATIVO" }),
    },
  );

  assert(
    aprovacao.status === 200,
    `Aprovação deveria retornar 200, recebeu ${aprovacao.status} (${JSON.stringify(aprovacao.body)}).`,
  );

  await sql`
    UPDATE usuarios
    SET status = 'PENDENTE'
    WHERE id = ${pendente.id}
  `;

  console.log("✅ Fornecedor pendente aprovado e status restaurado.");
}


async function testSuspensaoEncerraSessao() {
  console.log("5. Verificando suspensão e encerramento de sessão...");

  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@collectexpress.com",
      senha: "123456",
    }),
  });

  const adminToken = adminLogin.body.data.access_token;

  const joaoLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "joao@construtor.com",
      senha: "123456",
    }),
  });

  assert(
    joaoLogin.status === 200,
    "João deveria conseguir logar antes da suspensão.",
  );

  const joaoToken = joaoLogin.body.data.access_token;
  const joaoRefresh = joaoLogin.body.data.refresh_token;

  const [joaoRow] = await sql`
    SELECT id FROM usuarios
    WHERE email = 'joao@construtor.com'
  `;

  try {
    const suspensao = await request(
      `/usuarios/${joaoRow.id}/status`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: "SUSPENSO" }),
      },
    );

    assert(
      suspensao.status === 200,
      `Suspensão deveria retornar 200, recebeu ${suspensao.status} (${JSON.stringify(suspensao.body)}).`,
    );

    const perfil = await request("/usuarios/perfil", {
      headers: { Authorization: `Bearer ${joaoToken}` },
    });

    /*
     * Esperado: 401 SESSION_INVALIDATED.
     * O 403 USER_NOT_ACTIVE já está coberto pelo login test
     * (test 3). Aqui queremos garantir que o token existente
     * foi estruturalmente invalidado.
     */
    assert(
      perfil.status === 401,
      `Access token deveria falhar com 401 após suspensão (recebeu ${perfil.status}: ${JSON.stringify(perfil.body)}).`,
    );

    assert(
      perfil.body?.code === "SESSION_INVALIDATED",
      `Código esperado SESSION_INVALIDATED, recebido ${perfil.body?.code}.`,
    );

    const refresh = await request("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: joaoRefresh }),
    });

    assert(
      refresh.status === 401,
      `Refresh token deveria falhar após suspensão (recebeu ${refresh.status}).`,
    );
  } finally {
    /*
     * Restaura o STATUS obrigatoriamente, mesmo se as asserções
     * acima falharem. Sem isso, um teste quebrado deixa João
     * SUSPENSO no banco e o próximo `npm run test:seed` falha
     * já no teste 1.
     *
     * NÃO restauramos `token_version`: os tokens antigos do João
     * ficam permanentemente inválidos, que é o comportamento
     * correto do ponto de vista de segurança. O próximo login
     * emite tokens novos com a versão atual.
     */
    await sql`
      UPDATE usuarios
      SET status = 'ATIVO'
      WHERE id = ${joaoRow.id}
    `;
  }

  console.log(
    "✅ Suspensão invalidou access token e refresh token do consumidor.",
  );
}
// Metodo foi descontinuado
/*async function testSuspensaoEncerraSessao() {
  console.log("5. Verificando suspensão e encerramento de sessão...");

  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "admin@collectexpress.com",
      senha: "123456",
    }),
  });

  const adminToken = adminLogin.body.data.access_token;

  const joaoLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: "joao@construtor.com",
      senha: "123456",
    }),
  });

  assert(
    joaoLogin.status === 200,
    "João deveria conseguir logar antes da suspensão.",
  );

  const joaoToken = joaoLogin.body.data.access_token;
  const joaoRefresh = joaoLogin.body.data.refresh_token;

  const [joaoRow] = await sql`
    SELECT id, token_version FROM usuarios
    WHERE email = 'joao@construtor.com'
  `;

  const suspensao = await request(
    `/usuarios/${joaoRow.id}/status`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status: "SUSPENSO" }),
    },
  );

  assert(
    suspensao.status === 200,
    `Suspensão deveria retornar 200, recebeu ${suspensao.status}.`,
  );

  const perfil = await request("/usuarios/perfil", {
    headers: { Authorization: `Bearer ${joaoToken}` },
  });

  assert(
    perfil.status === 401,
    `Access token deveria falhar após suspensão (recebeu ${perfil.status}).`,
  );

  const refresh = await request("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: joaoRefresh }),
  });

  assert(
    refresh.status === 401,
    `Refresh token deveria falhar após suspensão (recebeu ${refresh.status}).`,
  );

  /*
   * Restaura status E token_version para que a conta
   * do João fique idêntica ao estado da seed.
   *
  await sql`
    UPDATE usuarios
    SET status = 'ATIVO', token_version = ${joaoRow.token_version}
    WHERE id = ${joaoRow.id}
  `;

  console.log(
    "✅ Suspensão invalidou access token e refresh token do consumidor.",
  );
}*/

async function run() {
  console.log("Executando testes da seed...\n");

  try {
    await testProfilesExist();
    await testCategoriasCobertas();
    await testLoginMatrix();
    await testAprovacaoPendente();
    await testSuspensaoEncerraSessao();

    console.log("\n✅ TODOS OS TESTES PASSARAM.");
    console.log(
      "⚠️  Rode `npm run seed` novamente para restaurar o estado " +
        "inicial dos perfis alterados pelos testes 4 e 5.\n",
    );
  } catch (error) {
    console.error("\n❌ TESTE FALHOU:", error.message);
    process.exit(1);
  }
}

run().then(() => process.exit(0));