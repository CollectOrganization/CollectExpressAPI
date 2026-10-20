require("dotenv").config();

const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const sql = require("../config/db");

const API_URL =
  process.env.API_TEST_URL || "http://localhost:3001/api";

const marker = Date.now().toString();

const fixtures = {
  consumerId: crypto.randomUUID(),
  otherConsumerId: crypto.randomUUID(),
  supplierId: crypto.randomUUID(),
  otherSupplierId: crypto.randomUUID(),
  adminId: crypto.randomUUID(),

  addressId: crypto.randomUUID(),
  otherAddressId: crypto.randomUUID(),

  dumpsterId: crypto.randomUUID(),
  otherDumpsterId: crypto.randomUUID(),

  waitingOrderId: crypto.randomUUID(),
  finishedOrderId: crypto.randomUUID(),
  otherConsumerOrderId: crypto.randomUUID(),
  foreignSupplierOrderId: crypto.randomUUID(),
};

const credentials = {
  consumer: {
    email: `consumer.alugueis.${marker}@test.local`,
    password: "123456",
  },
  otherConsumer: {
    email: `consumer.other.${marker}@test.local`,
    password: "123456",
  },
  supplier: {
    email: `supplier.alugueis.${marker}@test.local`,
    password: "123456",
  },
  otherSupplier: {
    email: `supplier.other.${marker}@test.local`,
    password: "123456",
  },
  admin: {
    email: `admin.alugueis.${marker}@test.local`,
    password: "123456",
  },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let body = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = text;
  }

  return {
    status: response.status,
    body,
  };
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

function futureDate(days = 3) {
  const date = new Date();
  date.setDate(date.getDate() + days);

  return date.toISOString().split("T")[0];
}

async function prepareFixtures() {
  const passwordHash = await bcrypt.hash("123456", 10);

  await sql`
    INSERT INTO usuarios (
      id,
      nome_completo,
      email,
      senha_hash,
      tipo_perfil,
      documento,
      telefone,
      status,
      token_version
    )
    VALUES
      (
        ${fixtures.consumerId},
        'Consumidor Teste Aluguéis',
        ${credentials.consumer.email},
        ${passwordHash},
        'CONSUMIDOR',
        ${`1${marker}`.padEnd(11, "1").slice(0, 11)},
        '11911111111',
        'ATIVO',
        0
      ),
      (
        ${fixtures.otherConsumerId},
        'Outro Consumidor Teste',
        ${credentials.otherConsumer.email},
        ${passwordHash},
        'CONSUMIDOR',
        ${`2${marker}`.padEnd(11, "2").slice(0, 11)},
        '11922222222',
        'ATIVO',
        0
      ),
      (
        ${fixtures.supplierId},
        'Fornecedor Teste Aluguéis',
        ${credentials.supplier.email},
        ${passwordHash},
        'CACAMBEIRO',
        ${`3${marker}`.padEnd(14, "3").slice(0, 14)},
        '11933333333',
        'ATIVO',
        0
      ),
      (
        ${fixtures.otherSupplierId},
        'Outro Fornecedor Teste',
        ${credentials.otherSupplier.email},
        ${passwordHash},
        'CACAMBEIRO',
        ${`4${marker}`.padEnd(14, "4").slice(0, 14)},
        '11944444444',
        'ATIVO',
        0
      ),
      (
        ${fixtures.adminId},
        'Administrador Teste Aluguéis',
        ${credentials.admin.email},
        ${passwordHash},
        'ADMIN',
        ${`5${marker}`.padEnd(11, "5").slice(0, 11)},
        '11955555555',
        'ATIVO',
        0
      )
  `;

  await sql`
    INSERT INTO detalhes_cacambeiro (
      usuario_id,
      horario_inicio,
      horario_fim,
      raio_entrega_km,
      taxa_entrega
    )
    VALUES
      (
        ${fixtures.supplierId},
        '08:00',
        '18:00',
        30,
        50
      ),
      (
        ${fixtures.otherSupplierId},
        '08:00',
        '18:00',
        30,
        60
      )
  `;

  await sql`
    INSERT INTO enderecos (
      id,
      usuario_id,
      cep,
      logradouro,
      numero,
      bairro,
      cidade_estado
    )
    VALUES
      (
        ${fixtures.addressId},
        ${fixtures.consumerId},
        '01311000',
        'Avenida Paulista',
        '1000',
        'Bela Vista',
        'São Paulo - SP'
      ),
      (
        ${fixtures.otherAddressId},
        ${fixtures.otherConsumerId},
        '01001000',
        'Praça da Sé',
        '1',
        'Sé',
        'São Paulo - SP'
      )
  `;

  await sql`
    INSERT INTO cacambas (
      id,
      cacambeiro_id,
      nome,
      tipo_residuo,
      tamanho_m3,
      preco_diaria,
      disponivel
    )
    VALUES
      (
        ${fixtures.dumpsterId},
        ${fixtures.supplierId},
        'Caçamba Teste Aluguéis',
        'Entulho de Obra',
        5,
        100,
        TRUE
      ),
      (
        ${fixtures.otherDumpsterId},
        ${fixtures.otherSupplierId},
        'Caçamba Outro Fornecedor',
        'Recicláveis',
        7,
        150,
        TRUE
      )
  `;

  await sql`
    INSERT INTO alugueis (
      id,
      consumidor_id,
      cacambeiro_id,
      endereco_id,
      data_pedido,
      data_inicio,
      dias_aluguel,
      preco_final,
      status_pagamento,
      status_aluguel
    )
    VALUES
      (
        ${fixtures.waitingOrderId},
        ${fixtures.consumerId},
        ${fixtures.supplierId},
        ${fixtures.addressId},
        NOW(),
        ${futureDate(3)},
        3,
        350,
        'PENDENTE',
        'AGUARDANDO_ENTREGA'
      ),
      (
        ${fixtures.finishedOrderId},
        ${fixtures.consumerId},
        ${fixtures.supplierId},
        ${fixtures.addressId},
        NOW() - INTERVAL '10 days',
        CURRENT_DATE - INTERVAL '9 days',
        3,
        350,
        'PAGO',
        'FINALIZADO'
      ),
      (
        ${fixtures.otherConsumerOrderId},
        ${fixtures.otherConsumerId},
        ${fixtures.supplierId},
        ${fixtures.otherAddressId},
        NOW(),
        ${futureDate(4)},
        2,
        250,
        'PENDENTE',
        'AGUARDANDO_ENTREGA'
      ),
      (
        ${fixtures.foreignSupplierOrderId},
        ${fixtures.consumerId},
        ${fixtures.otherSupplierId},
        ${fixtures.addressId},
        NOW(),
        ${futureDate(5)},
        2,
        360,
        'PENDENTE',
        'AGUARDANDO_ENTREGA'
      )
  `;

  await sql`
    INSERT INTO itens_aluguel (
      aluguel_id,
      cacamba_id,
      quantidade,
      dias_aluguel,
      preco_diaria
    )
    VALUES
      (
        ${fixtures.waitingOrderId},
        ${fixtures.dumpsterId},
        1,
        3,
        100
      ),
      (
        ${fixtures.finishedOrderId},
        ${fixtures.dumpsterId},
        1,
        3,
        100
      ),
      (
        ${fixtures.otherConsumerOrderId},
        ${fixtures.dumpsterId},
        1,
        2,
        100
      ),
      (
        ${fixtures.foreignSupplierOrderId},
        ${fixtures.otherDumpsterId},
        1,
        2,
        150
      )
  `;
}

async function login(credentialsData) {
  const response = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: credentialsData.email,
      senha: credentialsData.password,
    }),
  });

  assert(
    response.status === 200,
    `Login falhou: ${JSON.stringify(response.body)}`,
  );

  assert(
    response.body?.success === true,
    "O login não retornou success=true.",
  );

  const token = response.body?.data?.access_token;

  assert(token, "O login não retornou o access token.");

  return token;
}

async function testConsumerOrders(consumerToken) {
  console.log("1. Testando pedidos do consumidor...");

  const response = await request(
    "/alugueis/meus?page=1",
    {
      headers: authHeaders(consumerToken),
    },
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}.`,
  );

  assert(
    response.body?.success === true,
    "A resposta não segue o padrão de sucesso.",
  );

  assert(
    Array.isArray(response.body?.data?.items),
    "data.items deveria ser um array.",
  );

  assert(
    response.body.data.pagination,
    "A paginação não foi retornada.",
  );

  const ids = response.body.data.items.map(
    (order) => order.id,
  );

  assert(
    ids.includes(fixtures.waitingOrderId),
    "O pedido do consumidor não foi retornado.",
  );

  assert(
    ids.includes(fixtures.finishedOrderId),
    "O pedido finalizado não foi retornado.",
  );

  assert(
    !ids.includes(fixtures.otherConsumerOrderId),
    "O consumidor recebeu pedido de outro usuário.",
  );

  console.log("✅ Histórico e isolamento do consumidor validados.");
}

async function testSupplierManagement(supplierToken) {
  console.log("2. Testando gestão do fornecedor...");

  const response = await request(
    "/alugueis/gestao",
    {
      headers: authHeaders(supplierToken),
    },
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}.`,
  );

  assert(
    response.body?.success === true,
    "A resposta não segue o padrão de sucesso.",
  );

  assert(
    Array.isArray(response.body?.data),
    "data deveria ser um array.",
  );

  const ids = response.body.data.map(
    (order) => order.id,
  );

  assert(
    ids.includes(fixtures.waitingOrderId),
    "Pedido do fornecedor não retornado.",
  );

  assert(
    ids.includes(fixtures.otherConsumerOrderId),
    "Pedido de outro consumidor do mesmo fornecedor não retornado.",
  );

  assert(
    !ids.includes(fixtures.foreignSupplierOrderId),
    "Fornecedor recebeu pedido de outro fornecedor.",
  );

  console.log("✅ Gestão e isolamento do fornecedor validados.");
}

async function testRoleAuthorization(
  consumerToken,
  supplierToken,
) {
  console.log("3. Testando autorização por perfil...");

  const consumerOnManagement = await request(
    "/alugueis/gestao",
    {
      headers: authHeaders(consumerToken),
    },
  );

  assert(
    consumerOnManagement.status === 403,
    "Consumidor deveria receber 403 na gestão.",
  );

  const supplierOnConsumerOrders = await request(
    "/alugueis/meus",
    {
      headers: authHeaders(supplierToken),
    },
  );

  assert(
    supplierOnConsumerOrders.status === 403,
    "Fornecedor deveria receber 403 em /meus.",
  );

  const withoutToken = await request("/alugueis/meus");

  assert(
    withoutToken.status === 401,
    "Rota sem token deveria retornar 401.",
  );

  console.log("✅ Perfis e autenticação validados.");
}

async function testAdminList(adminToken) {
  console.log("4. Testando listagem administrativa...");

  const response = await request(
    "/alugueis?page=1",
    {
      headers: authHeaders(adminToken),
    },
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}.`,
  );

  assert(
    response.body?.success === true,
    "A resposta administrativa não está padronizada.",
  );

  assert(
    Array.isArray(response.body?.data?.items),
    "data.items deveria ser um array.",
  );

  assert(
    response.body.data.pagination,
    "A paginação administrativa não foi retornada.",
  );

  console.log("✅ Listagem administrativa validada.");
}

async function testAdminFilters(adminToken) {
  console.log("5. Testando filtros administrativos...");

  const statusResponse = await request(
    "/alugueis?status_aluguel=FINALIZADO",
    {
      headers: authHeaders(adminToken),
    },
  );

  assert(
    statusResponse.status === 200,
    "Filtro por status deveria retornar 200.",
  );

  const statusItems = statusResponse.body.data.items;

  assert(
    statusItems.every(
      (item) => item.status_aluguel === "FINALIZADO",
    ),
    "O filtro de status retornou dados incorretos.",
  );

  const searchResponse = await request(
    `/alugueis?search=${encodeURIComponent(
      "Consumidor Teste Aluguéis",
    )}`,
    {
      headers: authHeaders(adminToken),
    },
  );

  assert(
    searchResponse.status === 200,
    "A busca textual deveria retornar 200.",
  );

  assert(
    searchResponse.body.data.items.some(
      (item) => item.id === fixtures.waitingOrderId,
    ),
    "A busca textual não encontrou o pedido esperado.",
  );

  const uuidResponse = await request(
    `/alugueis?search=${fixtures.finishedOrderId}`,
    {
      headers: authHeaders(adminToken),
    },
  );

  assert(
    uuidResponse.status === 200,
    "A busca por UUID deveria retornar 200.",
  );

  assert(
    uuidResponse.body.data.items.length === 1,
    "A busca por UUID deveria retornar um pedido.",
  );

  const invalidStatus = await request(
    "/alugueis?status_aluguel=INVALIDO",
    {
      headers: authHeaders(adminToken),
    },
  );

  assert(
    invalidStatus.status === 400,
    "Status inválido deveria retornar 400.",
  );

  assert(
    invalidStatus.body?.code ===
      "INVALID_RENTAL_STATUS",
    "Código de erro inesperado.",
  );

  console.log("✅ Filtros e busca administrativa validados.");
}

async function testInvalidUuid(supplierToken) {
  console.log("6. Testando UUID inválido...");

  const response = await request(
    "/alugueis/id-invalido/status",
    {
      method: "PATCH",
      headers: authHeaders(supplierToken),
      body: JSON.stringify({
        status_aluguel: "EM_USO",
      }),
    },
  );

  assert(
    response.status === 400,
    `UUID inválido deveria retornar 400, recebido ${response.status}.`,
  );

  assert(
    response.body?.code === "VALIDATION_ERROR",
    "UUID inválido não retornou VALIDATION_ERROR.",
  );

  console.log("✅ Validação de UUID confirmada.");
}

async function testInvalidTransition(supplierToken) {
  console.log("7. Testando transição inválida...");

  const response = await request(
    `/alugueis/${fixtures.waitingOrderId}/status`,
    {
      method: "PATCH",
      headers: authHeaders(supplierToken),
      body: JSON.stringify({
        status_aluguel: "FINALIZADO",
      }),
    },
  );

  assert(
    response.status === 409,
    `Transição inválida deveria retornar 409, recebido ${response.status}.`,
  );

  assert(
    response.body?.code ===
      "INVALID_STATUS_TRANSITION",
    "Código de transição inválida inesperado.",
  );

  const rows = await sql`
    SELECT status_aluguel
    FROM alugueis
    WHERE id = ${fixtures.waitingOrderId}
  `;

  assert(
    rows[0].status_aluguel === "AGUARDANDO_ENTREGA",
    "O status foi alterado indevidamente.",
  );

  console.log("✅ Transição inválida bloqueada.");
}

async function testValidTransitions(supplierToken) {
  console.log("8. Testando transições válidas...");

  const transitions = [
    "EM_USO",
    "AGUARDANDO_RETIRADA",
    "FINALIZADO",
  ];

  for (const status of transitions) {
    const response = await request(
      `/alugueis/${fixtures.waitingOrderId}/status`,
      {
        method: "PATCH",
        headers: authHeaders(supplierToken),
        body: JSON.stringify({
          status_aluguel: status,
        }),
      },
    );

    assert(
      response.status === 200,
      `Transição para ${status} falhou: ${JSON.stringify(
        response.body,
      )}`,
    );

    assert(
      response.body?.success === true,
      `Transição para ${status} não retornou success=true.`,
    );

    assert(
      response.body?.data?.status_aluguel === status,
      `Status retornado diferente de ${status}.`,
    );
  }

  console.log("✅ Máquina de estados validada.");
}

async function testAlreadyFinished(supplierToken) {
  console.log("9. Testando pedido já finalizado...");

  const response = await request(
    `/alugueis/${fixtures.waitingOrderId}/status`,
    {
      method: "PATCH",
      headers: authHeaders(supplierToken),
      body: JSON.stringify({
        status_aluguel: "FINALIZADO",
      }),
    },
  );

  assert(
    response.status === 409,
    "Pedido finalizado deveria retornar 409.",
  );

  assert(
    response.body?.code ===
      "ORDER_ALREADY_FINISHED",
    "Código de pedido finalizado inesperado.",
  );

  console.log("✅ Pedido finalizado protegido.");
}

async function testOwnership(
  otherSupplierToken,
) {
  console.log("10. Testando ownership do pedido...");

  const response = await request(
    `/alugueis/${fixtures.finishedOrderId}/status`,
    {
      method: "PATCH",
      headers: authHeaders(otherSupplierToken),
      body: JSON.stringify({
        status_aluguel: "EM_USO",
      }),
    },
  );

  assert(
    response.status === 404,
    "Outro fornecedor deveria receber 404.",
  );

  assert(
    response.body?.code === "ORDER_NOT_FOUND",
    "Código de ownership inesperado.",
  );

  console.log("✅ Ownership do pedido validado.");
}

async function cleanup() {
  /*
   * Apaga explicitamente os pedidos para respeitar a FK
   * RESTRICT entre alugueis e endereços.
   */
  await sql`
    DELETE FROM alugueis
    WHERE id IN (
      ${fixtures.waitingOrderId},
      ${fixtures.finishedOrderId},
      ${fixtures.otherConsumerOrderId},
      ${fixtures.foreignSupplierOrderId}
    )
  `;

  await sql`
    DELETE FROM cacambas
    WHERE id IN (
      ${fixtures.dumpsterId},
      ${fixtures.otherDumpsterId}
    )
  `;

  await sql`
    DELETE FROM enderecos
    WHERE id IN (
      ${fixtures.addressId},
      ${fixtures.otherAddressId}
    )
  `;

  await sql`
    DELETE FROM usuarios
    WHERE id IN (
      ${fixtures.consumerId},
      ${fixtures.otherConsumerId},
      ${fixtures.supplierId},
      ${fixtures.otherSupplierId},
      ${fixtures.adminId}
    )
  `;
}

async function run() {
  console.log(
    "Preparando testes funcionais de alugueisController...",
  );

  try {
    await cleanup();
    await prepareFixtures();

    const consumerToken = await login(
      credentials.consumer,
    );

    const supplierToken = await login(
      credentials.supplier,
    );

    const otherSupplierToken = await login(
      credentials.otherSupplier,
    );

    const adminToken = await login(
      credentials.admin,
    );

    await testConsumerOrders(consumerToken);
    await testSupplierManagement(supplierToken);

    await testRoleAuthorization(
      consumerToken,
      supplierToken,
    );

    await testAdminList(adminToken);
    await testAdminFilters(adminToken);
    await testInvalidUuid(supplierToken);
    await testInvalidTransition(supplierToken);
    await testValidTransitions(supplierToken);
    await testAlreadyFinished(supplierToken);
    await testOwnership(otherSupplierToken);

    console.log(
      "\n✅ TODOS OS TESTES DE ALUGUÉIS PASSARAM.",
    );
  } finally {
    await cleanup();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "\n❌ TESTE DE ALUGUÉIS FALHOU:",
      error,
    );

    process.exit(1);
  });