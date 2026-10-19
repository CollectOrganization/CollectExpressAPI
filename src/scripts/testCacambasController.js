require("dotenv").config();

const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const sql = require("../config/db");

const apiUrl =
  process.env.API_TEST_URL || "http://localhost:3001/api";

const marker = `CACAMBA_TEST_${Date.now()}`;
const categoryName = `Categoria ${Date.now()}`;

const ids = {
  supplier: crypto.randomUUID(),
  otherSupplier: crypto.randomUUID(),
  consumer: crypto.randomUUID(),
  address: crypto.randomUUID(),

  availableDumpster: crypto.randomUUID(),
  unavailableDumpster: crypto.randomUUID(),
  otherDumpster: crypto.randomUUID(),
  activeDumpster: crypto.randomUUID(),
  historyDumpster: crypto.randomUUID(),
  removableDumpster: crypto.randomUUID(),

  activeOrder: crypto.randomUUID(),
  historyOrder: crypto.randomUUID(),
};

let createdDumpsterId;

function randomDigits(length) {
  return Array.from(
    { length },
    () => crypto.randomInt(0, 10),
  ).join("");
}

const documents = {
  supplier: randomDigits(14),
  otherSupplier: randomDigits(14),
  consumer: randomDigits(11),
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

async function login(email) {
  const response = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email,
      senha: "123456",
    }),
  });

  assert(
    response.status === 200,
    `Login falhou para ${email}: ${JSON.stringify(response.body)}`,
  );

  return response.body.data.access_token;
}

async function cleanup() {
  /*
   * Remove primeiro registros que possuem relacionamentos
   * protegidos por chaves estrangeiras.
   */
  await sql`
    DELETE FROM alugueis
    WHERE id IN (
      ${ids.activeOrder},
      ${ids.historyOrder}
    )
  `;

  await sql`
    DELETE FROM carrinho
    WHERE consumidor_id = ${ids.consumer}
  `;

  await sql`
    DELETE FROM cacambas
    WHERE cacambeiro_id IN (
      ${ids.supplier},
      ${ids.otherSupplier}
    )
  `;

  await sql`
    DELETE FROM enderecos
    WHERE usuario_id = ${ids.consumer}
  `;

  await sql`
    DELETE FROM usuarios
    WHERE id IN (
      ${ids.supplier},
      ${ids.otherSupplier},
      ${ids.consumer}
    )
  `;

  await sql`
    DELETE FROM categorias
    WHERE nome = ${categoryName}
  `;
}

async function prepareFixtures() {
  const passwordHash = await bcrypt.hash("123456", 10);

  await sql`
    INSERT INTO categorias (nome)
    VALUES (${categoryName})
  `;

  await sql`
    INSERT INTO usuarios (
      id,
      nome_completo,
      email,
      senha_hash,
      tipo_perfil,
      documento,
      telefone,
      status
    )
    VALUES
      (
        ${ids.supplier},
        'Fornecedor Principal Teste',
        ${`supplier.${marker}@test.local`},
        ${passwordHash},
        'CACAMBEIRO',
        ${documents.supplier},
        '11911111111',
        'ATIVO'
      ),
      (
        ${ids.otherSupplier},
        'Outro Fornecedor Teste',
        ${`supplier2.${marker}@test.local`},
        ${passwordHash},
        'CACAMBEIRO',
        ${documents.otherSupplier},
        '11922222222',
        'ATIVO'
      ),
      (
        ${ids.consumer},
        'Consumidor Teste',
        ${`consumer.${marker}@test.local`},
        ${passwordHash},
        'CONSUMIDOR',
        ${documents.consumer},
        '11933333333',
        'ATIVO'
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
        ${ids.supplier},
        '08:00',
        '18:00',
        30,
        50
      ),
      (
        ${ids.otherSupplier},
        '08:00',
        '18:00',
        40,
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
    VALUES (
      ${ids.address},
      ${ids.consumer},
      '01311000',
      'Avenida Paulista',
      '1000',
      'Bela Vista',
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
      foto_url,
      disponivel
    )
    VALUES
      (
        ${ids.availableDumpster},
        ${ids.supplier},
        ${`${marker} Disponível`},
        ${categoryName},
        5,
        350,
        NULL,
        TRUE
      ),
      (
        ${ids.unavailableDumpster},
        ${ids.supplier},
        ${`${marker} Indisponível`},
        ${categoryName},
        3,
        280,
        NULL,
        FALSE
      ),
      (
        ${ids.otherDumpster},
        ${ids.otherSupplier},
        ${`${marker} Outro Fornecedor`},
        ${categoryName},
        7,
        420,
        NULL,
        TRUE
      ),
      (
        ${ids.activeDumpster},
        ${ids.supplier},
        ${`${marker} Pedido Ativo`},
        ${categoryName},
        5,
        360,
        NULL,
        TRUE
      ),
      (
        ${ids.historyDumpster},
        ${ids.supplier},
        ${`${marker} Histórico`},
        ${categoryName},
        5,
        370,
        NULL,
        TRUE
      ),
      (
        ${ids.removableDumpster},
        ${ids.supplier},
        ${`${marker} Removível`},
        ${categoryName},
        3,
        250,
        NULL,
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
        ${ids.activeOrder},
        ${ids.consumer},
        ${ids.supplier},
        ${ids.address},
        NOW(),
        CURRENT_DATE + INTERVAL '2 days',
        3,
        1130,
        'PENDENTE',
        'AGUARDANDO_ENTREGA'
      ),
      (
        ${ids.historyOrder},
        ${ids.consumer},
        ${ids.supplier},
        ${ids.address},
        NOW() - INTERVAL '10 days',
        CURRENT_DATE - INTERVAL '9 days',
        3,
        1160,
        'PAGO',
        'FINALIZADO'
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
        ${ids.activeOrder},
        ${ids.activeDumpster},
        1,
        3,
        360
      ),
      (
        ${ids.historyOrder},
        ${ids.historyDumpster},
        1,
        3,
        370
      )
  `;
}

async function testPublicList() {
  console.log("1. Testando listagem pública...");

  const response = await request(
    `/cacambas?search=${encodeURIComponent(marker)}`,
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}`,
  );

  assert(
    response.body.success === true,
    "Resposta não está padronizada.",
  );

  const items = response.body.data.items;

  assert(Array.isArray(items), "data.items deve ser um array.");

  assert(
    items.some(
      (item) => item.id === ids.availableDumpster,
    ),
    "Caçamba disponível não foi listada.",
  );

  assert(
    !items.some(
      (item) => item.id === ids.unavailableDumpster,
    ),
    "Caçamba indisponível apareceu no marketplace.",
  );

  assert(
    response.body.data.pagination,
    "Paginação não foi retornada.",
  );

  console.log("✅ Listagem pública funcionando.");
}

async function testCategoryFilter() {
  console.log("2. Testando filtro por categoria...");

  const response = await request(
    `/cacambas?tipo_residuo=${encodeURIComponent(categoryName)}`,
  );

  assert(response.status === 200, "Filtro retornou erro.");

  const items = response.body.data.items;

  assert(
    items.length >= 1,
    "Nenhuma caçamba foi retornada pelo filtro.",
  );

  assert(
    items.every(
      (item) =>
        item.tipo_residuo.toLowerCase() ===
        categoryName.toLowerCase(),
    ),
    "O filtro retornou categoria incorreta.",
  );

  console.log("✅ Filtro por categoria funcionando.");
}

async function testDetails() {
  console.log("3. Testando detalhes da caçamba...");

  const response = await request(
    `/cacambas/${ids.availableDumpster}`,
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}`,
  );

  assert(
    response.body.data.id === ids.availableDumpster,
    "A caçamba retornada está incorreta.",
  );

  assert(
    response.body.data.cacambeiro,
    "Dados do fornecedor não foram retornados.",
  );

  assert(
    Array.isArray(response.body.data.avaliacoes),
    "Avaliações não foram retornadas.",
  );

  console.log("✅ Detalhes funcionando.");
}

async function testNotFound() {
  console.log("4. Testando caçamba inexistente...");

  const response = await request(
    `/cacambas/${crypto.randomUUID()}`,
  );

  assert(
    response.status === 404,
    `Esperado 404, recebido ${response.status}`,
  );

  assert(
    response.body.code === "DUMPSTER_NOT_FOUND",
    "Código de erro incorreto.",
  );

  console.log("✅ Caçamba inexistente tratada corretamente.");
}

async function testInvalidId() {
  console.log("5. Testando UUID inválido...");

  const response = await request("/cacambas/id-invalido");

  assert(
    response.status === 400,
    `Esperado 400, recebido ${response.status}`,
  );

  assert(
    response.body.code === "VALIDATION_ERROR",
    "Erro de validação não foi padronizado.",
  );

  console.log("✅ UUID inválido bloqueado.");
}

async function testMyDumpsters(supplierToken) {
  console.log("6. Testando minhas caçambas...");

  const response = await request("/cacambas/minhas", {
    headers: {
      Authorization: `Bearer ${supplierToken}`,
    },
  });

  assert(
    response.status === 200,
    `Falha ao listar próprias caçambas. Status: ${
      response.status
    }. Resposta: ${JSON.stringify(response.body)}`,
  );

  const items = response.body.data;

  assert(
    items.some(
      (item) => item.id === ids.availableDumpster,
    ),
    "Caçamba disponível não retornada.",
  );

  assert(
    items.some(
      (item) => item.id === ids.unavailableDumpster,
    ),
    "Caçamba indisponível não retornada em /minhas.",
  );

  assert(
    items.every(
      (item) => item.cacambeiro_id === ids.supplier,
    ),
    "Foi retornada caçamba de outro fornecedor.",
  );

  console.log("✅ Minhas caçambas funcionando.");
}

async function testMyDumpstersWithoutToken() {
  console.log("7. Testando /minhas sem autenticação...");

  const response = await request("/cacambas/minhas");

  assert(
    response.status === 401,
    `Esperado 401, recebido ${response.status}`,
  );

  console.log("✅ Rota protegida corretamente.");
}

async function testCreate(supplierToken) {
  console.log("8. Testando criação de caçamba...");

  const response = await request("/cacambas", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supplierToken}`,
    },
    body: JSON.stringify({
      nome: `${marker} Criada`,
      tipo_residuo: categoryName,
      tamanho_m3: 6,
      preco_diaria: 399.90,
    }),
  });

  assert(
    response.status === 201,
    `Criação falhou: ${JSON.stringify(response.body)}`,
  );

  createdDumpsterId = response.body.data.id;

  assert(
    response.body.data.cacambeiro_id === ids.supplier,
    "A caçamba foi associada ao fornecedor incorreto.",
  );

  assert(
    response.body.data.disponivel === true,
    "Nova caçamba deveria estar disponível.",
  );

  console.log("✅ Criação funcionando.");
}

async function testInvalidCategory(supplierToken) {
  console.log("9. Testando categoria inexistente...");

  const response = await request("/cacambas", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supplierToken}`,
    },
    body: JSON.stringify({
      nome: `${marker} Categoria Inválida`,
      tipo_residuo: "Categoria inexistente",
      tamanho_m3: 5,
      preco_diaria: 300,
    }),
  });

  assert(
    response.status === 400,
    `Esperado 400, recebido ${response.status}`,
  );

  assert(
    response.body.code === "CATEGORY_NOT_FOUND",
    "Código de categoria inválida incorreto.",
  );

  console.log("✅ Categoria inexistente bloqueada.");
}

async function testUpdateOwnDumpster(supplierToken) {
  console.log("10. Testando atualização da própria caçamba...");

  const response = await request(
    `/cacambas/${ids.availableDumpster}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${supplierToken}`,
      },
      body: JSON.stringify({
        preco_diaria: 375.50,
        disponivel: false,
      }),
    },
  );

  assert(
    response.status === 200,
    `Atualização falhou: ${JSON.stringify(response.body)}`,
  );

  assert(
    response.body.data.preco_diaria === 375.50,
    "Preço não foi atualizado.",
  );

  assert(
    response.body.data.disponivel === false,
    "Disponibilidade não foi atualizada.",
  );

  console.log("✅ Atualização funcionando.");
}

async function testUpdateAnotherSupplierDumpster(
  supplierToken,
) {
  console.log("11. Testando atualização sem propriedade...");

  const response = await request(
    `/cacambas/${ids.otherDumpster}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${supplierToken}`,
      },
      body: JSON.stringify({
        preco_diaria: 1,
      }),
    },
  );

  assert(
    response.status === 403,
    `Esperado 403, recebido ${response.status}`,
  );

  assert(
    response.body.code === "DUMPSTER_ACCESS_DENIED",
    "Código de acesso negado incorreto.",
  );

  console.log("✅ Ownership protegido.");
}

async function testDeleteWithActiveOrder(supplierToken) {
  console.log("12. Testando remoção com pedido ativo...");

  const response = await request(
    `/cacambas/${ids.activeDumpster}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${supplierToken}`,
      },
    },
  );

  assert(
    response.status === 409,
    `Esperado 409, recebido ${response.status}`,
  );

  assert(
    response.body.code === "DUMPSTER_HAS_ACTIVE_ORDERS",
    "Código de pedido ativo incorreto.",
  );

  console.log("✅ Remoção com pedido ativo bloqueada.");
}

async function testDeleteWithHistory(supplierToken) {
  console.log("13. Testando remoção com histórico...");

  const response = await request(
    `/cacambas/${ids.historyDumpster}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${supplierToken}`,
      },
    },
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}`,
  );

  assert(
    response.body.data.disponivel === false,
    "Caçamba com histórico deveria ser desativada.",
  );

  const rows = await sql`
    SELECT disponivel
    FROM cacambas
    WHERE id = ${ids.historyDumpster}
  `;

  assert(
    rows.length === 1 && rows[0].disponivel === false,
    "Caçamba histórica foi removida ou não foi desativada.",
  );

  console.log("✅ Histórico preservado e caçamba desativada.");
}

async function testDeleteWithoutHistory(supplierToken) {
  console.log("14. Testando remoção sem histórico...");

  const response = await request(
    `/cacambas/${ids.removableDumpster}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${supplierToken}`,
      },
    },
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}`,
  );

  assert(
    response.body.data.removed === true,
    "Resposta não informou remoção física.",
  );

  const rows = await sql`
    SELECT id
    FROM cacambas
    WHERE id = ${ids.removableDumpster}
  `;

  assert(
    rows.length === 0,
    "Caçamba sem histórico permaneceu no banco.",
  );

  console.log("✅ Caçamba sem histórico removida.");
}

async function run() {
  console.log("Preparando testes de caçambas...\n");

  try {
    await cleanup();
    await prepareFixtures();

    const supplierToken = await login(
      `supplier.${marker}@test.local`,
    );

    await testPublicList();
    await testCategoryFilter();
    await testDetails();
    await testNotFound();
    await testInvalidId();
    await testMyDumpsters(supplierToken);
    await testMyDumpstersWithoutToken();
    await testCreate(supplierToken);
    await testInvalidCategory(supplierToken);
    await testUpdateOwnDumpster(supplierToken);
    await testUpdateAnotherSupplierDumpster(
      supplierToken,
    );
    await testDeleteWithActiveOrder(supplierToken);
    await testDeleteWithHistory(supplierToken);
    await testDeleteWithoutHistory(supplierToken);

    console.log("\n✅ TODOS OS TESTES DE CAÇAMBAS PASSARAM.");
  } finally {
    await cleanup();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ TESTE FALHOU:", error);

    cleanup()
      .catch((cleanupError) => {
        console.error(
          "Erro adicional durante limpeza:",
          cleanupError,
        );
      })
      .finally(() => process.exit(1));
  });