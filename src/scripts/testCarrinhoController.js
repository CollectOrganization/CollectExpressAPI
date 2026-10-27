require("dotenv").config();

const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const sql = require("../config/db");

const apiUrl =
  process.env.API_TEST_URL || "http://localhost:3001/api";

const marker = Date.now().toString();

const fixtures = {
  consumerId: crypto.randomUUID(),
  secondConsumerId: crypto.randomUUID(),
  supplierId: crypto.randomUUID(),
  secondSupplierId: crypto.randomUUID(),

  dumpsterId: crypto.randomUUID(),
  secondDumpsterId: crypto.randomUUID(),
  unavailableDumpsterId: crypto.randomUUID(),
  foreignDumpsterId: crypto.randomUUID(),

  secondConsumerCartId: crypto.randomUUID(),
  secondConsumerItemId: crypto.randomUUID(),
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function uniqueDigits(length, offset = 0) {
  return `${Date.now() + offset}`
    .padStart(length, "0")
    .slice(-length);
}

async function request(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
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
      status
    )
    VALUES
      (
        ${fixtures.consumerId},
        'Consumidor Teste Carrinho',
        ${`consumer.cart.${marker}@test.local`},
        ${passwordHash},
        'CONSUMIDOR',
        ${uniqueDigits(11, 1)},
        '11911111111',
        'ATIVO'
      ),
      (
        ${fixtures.secondConsumerId},
        'Segundo Consumidor Teste',
        ${`consumer2.cart.${marker}@test.local`},
        ${passwordHash},
        'CONSUMIDOR',
        ${uniqueDigits(11, 2)},
        '11922222222',
        'ATIVO'
      ),
      (
        ${fixtures.supplierId},
        'Fornecedor Teste Carrinho',
        ${`supplier.cart.${marker}@test.local`},
        ${passwordHash},
        'CACAMBEIRO',
        ${uniqueDigits(14, 3)},
        '11933333333',
        'ATIVO'
      ),
      (
        ${fixtures.secondSupplierId},
        'Segundo Fornecedor Teste',
        ${`supplier2.cart.${marker}@test.local`},
        ${passwordHash},
        'CACAMBEIRO',
        ${uniqueDigits(14, 4)},
        '11944444444',
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
        ${fixtures.supplierId},
        '08:00',
        '18:00',
        30,
        50
      ),
      (
        ${fixtures.secondSupplierId},
        '08:00',
        '18:00',
        40,
        70
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
        'Caçamba Teste 5m³',
        'Entulho de Obra',
        5,
        100,
        TRUE
      ),
      (
        ${fixtures.secondDumpsterId},
        ${fixtures.supplierId},
        'Caçamba Teste 3m³',
        'Entulho de Obra',
        3,
        80,
        TRUE
      ),
      (
        ${fixtures.unavailableDumpsterId},
        ${fixtures.supplierId},
        'Caçamba Indisponível',
        'Entulho de Obra',
        7,
        150,
        FALSE
      ),
      (
        ${fixtures.foreignDumpsterId},
        ${fixtures.secondSupplierId},
        'Caçamba Outro Fornecedor',
        'Entulho de Obra',
        5,
        120,
        TRUE
      )
  `;

  /*
   * Cria um carrinho pertencente ao segundo consumidor para testar
   * isolamento e ownership.
   */
  await sql`
    INSERT INTO carrinho (
      id,
      consumidor_id,
      cacambeiro_id
    )
    VALUES (
      ${fixtures.secondConsumerCartId},
      ${fixtures.secondConsumerId},
      ${fixtures.supplierId}
    )
  `;

  await sql`
    INSERT INTO itens_carrinho (
      id,
      carrinho_id,
      cacamba_id,
      quantidade,
      dias_aluguel
    )
    VALUES (
      ${fixtures.secondConsumerItemId},
      ${fixtures.secondConsumerCartId},
      ${fixtures.secondDumpsterId},
      1,
      2
    )
  `;
}

async function login() {
  const response = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: `consumer.cart.${marker}@test.local`,
      senha: "123456",
    }),
  });

  assert(
    response.status === 200,
    `Login falhou: ${JSON.stringify(response.body)}`,
  );

  const token = response.body?.data?.access_token;

  assert(token, "O login não retornou access_token.");

  return token;
}

function authenticatedOptions(token, method, body) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined
      ? { body: JSON.stringify(body) }
      : {}),
  };
}

async function testEmptyCart(token) {
  console.log("1. Consultando carrinho vazio...");

  const response = await request(
    "/carrinho",
    authenticatedOptions(token, "GET"),
  );

  assert(response.status === 200, "Esperado status 200.");
  assert(response.body.success === true, "Resposta sem success=true.");
  assert(response.body.data.id === null, "O carrinho deveria estar vazio.");
  assert(
    response.body.data.itens.length === 0,
    "O carrinho não deveria possuir itens.",
  );
  assert(
    response.body.data.resumo.total_estimado === 0,
    "O total deveria ser zero.",
  );

  console.log("✅ Carrinho vazio retornado corretamente.");
}

async function testValidation(token) {
  console.log("2. Validando dados inválidos...");

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: "id-invalido",
      quantidade: 0,
      dias_aluguel: 31,
    }),
  );

  assert(response.status === 400, "Esperado status 400.");
  assert(
    response.body.code === "VALIDATION_ERROR",
    "Esperado VALIDATION_ERROR.",
  );
  assert(
    response.body.fields.cacamba_id,
    "Erro de cacamba_id não retornado.",
  );
  assert(
    response.body.fields.quantidade,
    "Erro de quantidade não retornado.",
  );
  assert(
    response.body.fields.dias_aluguel,
    "Erro de dias_aluguel não retornado.",
  );

  console.log("✅ Validação dos campos funcionando.");
}

async function testDumpsterNotFound(token) {
  console.log("3. Testando caçamba inexistente...");

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: crypto.randomUUID(),
      quantidade: 1,
      dias_aluguel: 3,
    }),
  );

  assert(response.status === 404, "Esperado status 404.");
  assert(
    response.body.code === "DUMPSTER_NOT_FOUND",
    "Código de erro inesperado.",
  );

  console.log("✅ Caçamba inexistente bloqueada.");
}

async function testUnavailableDumpster(token) {
  console.log("4. Testando caçamba indisponível...");

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: fixtures.unavailableDumpsterId,
      quantidade: 1,
      dias_aluguel: 3,
    }),
  );

  assert(response.status === 409, "Esperado status 409.");
  assert(
    response.body.code === "DUMPSTER_UNAVAILABLE",
    "Esperado DUMPSTER_UNAVAILABLE.",
  );

  console.log("✅ Caçamba indisponível bloqueada.");
}

async function testAddItem(token) {
  console.log("5. Adicionando item válido...");

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: fixtures.dumpsterId,
      quantidade: 2,
      dias_aluguel: 3,
    }),
  );

  assert(response.status === 201, "Esperado status 201.");

  const cart = response.body.data;

  assert(cart.itens.length === 1, "Esperado um item.");
  assert(
    cart.resumo.quantidade_itens === 2,
    "Quantidade total incorreta.",
  );
  assert(
    cart.resumo.subtotal === 600,
    `Subtotal incorreto: ${cart.resumo.subtotal}`,
  );
  assert(
    cart.resumo.taxa_entrega === 50,
    "Taxa de entrega incorreta.",
  );
  assert(
    cart.resumo.total_estimado === 650,
    "Total estimado incorreto.",
  );

  console.log("✅ Item adicionado e totais calculados.");
}

async function testDuplicateItem(token) {
  console.log("6. Testando item duplicado...");

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: fixtures.dumpsterId,
      quantidade: 1,
      dias_aluguel: 2,
    }),
  );

  assert(response.status === 409, "Esperado status 409.");
  assert(
    response.body.code === "ITEM_ALREADY_IN_CART",
    "Esperado ITEM_ALREADY_IN_CART.",
  );

  console.log("✅ Item duplicado bloqueado.");
}

async function testInactiveSupplier(token) {
  console.log("7. Testando fornecedor suspenso...");

  await sql`
    UPDATE usuarios
    SET status = 'SUSPENSO'
    WHERE id = ${fixtures.secondSupplierId}
  `;

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: fixtures.foreignDumpsterId,
      quantidade: 1,
      dias_aluguel: 2,
    }),
  );

  assert(response.status === 409, "Esperado status 409.");
  assert(
    response.body.code === "SUPPLIER_NOT_ACTIVE",
    "Esperado SUPPLIER_NOT_ACTIVE.",
  );

  await sql`
    UPDATE usuarios
    SET status = 'ATIVO'
    WHERE id = ${fixtures.secondSupplierId}
  `;

  console.log("✅ Fornecedor suspenso bloqueado.");
}

async function testSupplierConflict(token) {
  console.log("8. Testando conflito de fornecedor...");

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: fixtures.foreignDumpsterId,
      quantidade: 1,
      dias_aluguel: 2,
    }),
  );

  assert(response.status === 409, "Esperado status 409.");
  assert(
    response.body.code === "CART_SUPPLIER_CONFLICT",
    "Esperado CART_SUPPLIER_CONFLICT.",
  );

  console.log("✅ Mistura de fornecedores bloqueada.");
}

async function getFirstConsumerItem(token) {
  const response = await request(
    "/carrinho",
    authenticatedOptions(token, "GET"),
  );

  return response.body.data.itens[0];
}

async function testUpdateItem(token) {
  console.log("9. Atualizando item...");

  const item = await getFirstConsumerItem(token);

  const response = await request(
    `/carrinho/itens/${item.id}`,
    authenticatedOptions(token, "PUT", {
      quantidade: 3,
      dias_aluguel: 4,
    }),
  );

  assert(response.status === 200, "Esperado status 200.");

  const updatedItem = response.body.data.itens[0];

  assert(updatedItem.quantidade === 3, "Quantidade não atualizada.");
  assert(updatedItem.dias_aluguel === 4, "Período não atualizado.");
  assert(
    response.body.data.resumo.subtotal === 1200,
    "Subtotal após atualização incorreto.",
  );
  assert(
    response.body.data.resumo.total_estimado === 1250,
    "Total após atualização incorreto.",
  );

  console.log("✅ Item atualizado e totais recalculados.");
}

async function testEmptyUpdate(token) {
  console.log("10. Testando atualização vazia...");

  const item = await getFirstConsumerItem(token);

  const response = await request(
    `/carrinho/itens/${item.id}`,
    authenticatedOptions(token, "PUT", {}),
  );

  assert(response.status === 400, "Esperado status 400.");
  assert(
    response.body.code === "VALIDATION_ERROR",
    "Esperado VALIDATION_ERROR.",
  );

  console.log("✅ Atualização vazia bloqueada.");
}

async function testOwnership(token) {
  console.log("11. Testando isolamento entre consumidores...");

  const updateResponse = await request(
    `/carrinho/itens/${fixtures.secondConsumerItemId}`,
    authenticatedOptions(token, "PUT", {
      quantidade: 5,
    }),
  );

  assert(updateResponse.status === 404, "Esperado status 404.");
  assert(
    updateResponse.body.code === "CART_ITEM_NOT_FOUND",
    "Esperado CART_ITEM_NOT_FOUND.",
  );

  const deleteResponse = await request(
    `/carrinho/itens/${fixtures.secondConsumerItemId}`,
    authenticatedOptions(token, "DELETE"),
  );

  assert(deleteResponse.status === 404, "Esperado status 404.");

  const rows = await sql`
    SELECT quantidade
    FROM itens_carrinho
    WHERE id = ${fixtures.secondConsumerItemId}
  `;

  assert(rows.length === 1, "Item de outro consumidor foi removido.");
  assert(rows[0].quantidade === 1, "Item de outro consumidor foi alterado.");

  console.log("✅ Ownership do carrinho respeitado.");
}

async function testSecondItem(token) {
  console.log("12. Adicionando segundo item do mesmo fornecedor...");

  const response = await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: fixtures.secondDumpsterId,
      quantidade: 1,
      dias_aluguel: 2,
    }),
  );

  assert(response.status === 201, "Esperado status 201.");
  assert(
    response.body.data.itens.length === 2,
    "Esperados dois itens.",
  );

  /*
   * Primeiro item: 3 × 4 × 100 = 1.200
   * Segundo item: 1 × 2 × 80 = 160
   * Taxa: 50
   * Total: 1.410
   */
  assert(
    response.body.data.resumo.subtotal === 1360,
    "Subtotal dos dois itens incorreto.",
  );
  assert(
    response.body.data.resumo.total_estimado === 1410,
    "Total dos dois itens incorreto.",
  );

  console.log("✅ Segundo item adicionado corretamente.");
}

async function testRemoveItems(token) {
  console.log("13. Removendo itens...");

  let response = await request(
    "/carrinho",
    authenticatedOptions(token, "GET"),
  );

  const firstItem = response.body.data.itens.find(
    (item) => item.cacamba_id === fixtures.dumpsterId,
  );

  const removeFirst = await request(
    `/carrinho/itens/${firstItem.id}`,
    authenticatedOptions(token, "DELETE"),
  );

  assert(removeFirst.status === 200, "Erro ao remover primeiro item.");
  assert(
    removeFirst.body.data.itens.length === 1,
    "Deveria restar um item.",
  );

  const lastItem = removeFirst.body.data.itens[0];

  const removeLast = await request(
    `/carrinho/itens/${lastItem.id}`,
    authenticatedOptions(token, "DELETE"),
  );

  assert(removeLast.status === 200, "Erro ao remover último item.");
  assert(removeLast.body.data.id === null, "O carrinho deveria ser removido.");
  assert(
    removeLast.body.data.itens.length === 0,
    "O carrinho deveria estar vazio.",
  );

  console.log("✅ Itens removidos e carrinho vazio excluído.");
}

async function testClearCart(token) {
  console.log("14. Testando limpeza do carrinho...");

  await request(
    "/carrinho/itens",
    authenticatedOptions(token, "POST", {
      cacamba_id: fixtures.dumpsterId,
      quantidade: 1,
      dias_aluguel: 2,
    }),
  );

  const clearResponse = await request(
    "/carrinho",
    authenticatedOptions(token, "DELETE"),
  );

  assert(clearResponse.status === 200, "Erro ao limpar carrinho.");
  assert(
    clearResponse.body.data.removido === true,
    "O carrinho deveria ter sido removido.",
  );

  const secondClear = await request(
    "/carrinho",
    authenticatedOptions(token, "DELETE"),
  );

  assert(secondClear.status === 200, "Limpeza idempotente falhou.");
  assert(
    secondClear.body.data.removido === false,
    "O carrinho já deveria estar vazio.",
  );

  console.log("✅ Limpeza idempotente funcionando.");
}

async function cleanup() {
  await sql`
    DELETE FROM usuarios
    WHERE id IN (
      ${fixtures.consumerId},
      ${fixtures.secondConsumerId},
      ${fixtures.supplierId},
      ${fixtures.secondSupplierId}
    )
  `;
}

async function run() {
  console.log("Preparando testes do carrinho...\n");

  try {
    await cleanup();
    await prepareFixtures();

    const token = await login();

    await testEmptyCart(token);
    await testValidation(token);
    await testDumpsterNotFound(token);
    await testUnavailableDumpster(token);
    await testAddItem(token);
    await testDuplicateItem(token);
    await testInactiveSupplier(token);
    await testSupplierConflict(token);
    await testUpdateItem(token);
    await testEmptyUpdate(token);
    await testOwnership(token);
    await testSecondItem(token);
    await testRemoveItems(token);
    await testClearCart(token);

    console.log("\n✅ TODOS OS TESTES DO CARRINHO PASSARAM.");
  } finally {
    await cleanup();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ TESTE DO CARRINHO FALHOU:", error);
    process.exit(1);
  });