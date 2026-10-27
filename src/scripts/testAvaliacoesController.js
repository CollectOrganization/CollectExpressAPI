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
  addressId: crypto.randomUUID(),
  secondAddressId: crypto.randomUUID(),
  dumpsterId: crypto.randomUUID(),
  finishedOrderId: crypto.randomUUID(),
  unfinishedOrderId: crypto.randomUUID(),
  foreignOrderId: crypto.randomUUID(),
};

const emails = {
  consumer: `review.consumer.${marker}@test.local`,
  secondConsumer: `review.consumer2.${marker}@test.local`,
  supplier: `review.supplier.${marker}@test.local`,
};

function randomDigits(length) {
  let result = "";

  while (result.length < length) {
    result += crypto.randomInt(0, 10).toString();
  }

  return result;
}

const documents = {
  consumer: randomDigits(11),
  secondConsumer: randomDigits(11),
  supplier: randomDigits(14),
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

async function cleanup() {
  /*
   * A limpeza explícita evita problemas com relacionamentos
   * que usam ON DELETE RESTRICT.
   */
  await sql`
    DELETE FROM avaliacoes
    WHERE aluguel_id IN (
      ${fixtures.finishedOrderId},
      ${fixtures.unfinishedOrderId},
      ${fixtures.foreignOrderId}
    )
  `;

  await sql`
    DELETE FROM itens_aluguel
    WHERE aluguel_id IN (
      ${fixtures.finishedOrderId},
      ${fixtures.unfinishedOrderId},
      ${fixtures.foreignOrderId}
    )
  `;

  await sql`
    DELETE FROM alugueis
    WHERE id IN (
      ${fixtures.finishedOrderId},
      ${fixtures.unfinishedOrderId},
      ${fixtures.foreignOrderId}
    )
  `;

  await sql`
    DELETE FROM cacambas
    WHERE id = ${fixtures.dumpsterId}
  `;

  await sql`
    DELETE FROM enderecos
    WHERE id IN (
      ${fixtures.addressId},
      ${fixtures.secondAddressId}
    )
  `;

  await sql`
    DELETE FROM detalhes_cacambeiro
    WHERE usuario_id = ${fixtures.supplierId}
  `;

  await sql`
    DELETE FROM usuarios
    WHERE id IN (
      ${fixtures.consumerId},
      ${fixtures.secondConsumerId},
      ${fixtures.supplierId}
    )
  `;
}

async function prepareFixtures() {
  const passwordHash = await bcrypt.hash("123456", 10);

  /*
   * Cria dois consumidores e um fornecedor.
   * Todos ficam ativos para permitir os testes de autenticação.
   */
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
        'Consumidor Avaliações',
        ${emails.consumer},
        ${passwordHash},
        'CONSUMIDOR',
        ${documents.consumer},
        '11911111111',
        'ATIVO',
        0
      ),
      (
        ${fixtures.secondConsumerId},
        'Segundo Consumidor Avaliações',
        ${emails.secondConsumer},
        ${passwordHash},
        'CONSUMIDOR',
        ${documents.secondConsumer},
        '11922222222',
        'ATIVO',
        0
      ),
      (
        ${fixtures.supplierId},
        'Fornecedor Avaliações',
        ${emails.supplier},
        ${passwordHash},
        'CACAMBEIRO',
        ${documents.supplier},
        '11933333333',
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
    VALUES (
      ${fixtures.supplierId},
      '08:00',
      '18:00',
      30,
      50
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
        ${fixtures.secondAddressId},
        ${fixtures.secondConsumerId},
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
    VALUES (
      ${fixtures.dumpsterId},
      ${fixtures.supplierId},
      'Caçamba Teste Avaliação',
      'Entulho de Obra',
      5,
      150,
      TRUE
    )
  `;

  /*
   * Cria:
   * - um pedido finalizado do consumidor principal;
   * - um pedido ainda em uso;
   * - um pedido finalizado pertencente ao segundo consumidor.
   */
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
        ${fixtures.finishedOrderId},
        ${fixtures.consumerId},
        ${fixtures.supplierId},
        ${fixtures.addressId},
        NOW() - INTERVAL '10 days',
        CURRENT_DATE - INTERVAL '9 days',
        3,
        500,
        'PAGO',
        'FINALIZADO'
      ),
      (
        ${fixtures.unfinishedOrderId},
        ${fixtures.consumerId},
        ${fixtures.supplierId},
        ${fixtures.addressId},
        NOW() - INTERVAL '2 days',
        CURRENT_DATE - INTERVAL '1 day',
        3,
        500,
        'PAGO',
        'EM_USO'
      ),
      (
        ${fixtures.foreignOrderId},
        ${fixtures.secondConsumerId},
        ${fixtures.supplierId},
        ${fixtures.secondAddressId},
        NOW() - INTERVAL '8 days',
        CURRENT_DATE - INTERVAL '7 days',
        3,
        500,
        'PAGO',
        'FINALIZADO'
      )
  `;
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
    `Login falhou: ${JSON.stringify(response.body)}`,
  );

  const token = response.body?.data?.access_token;

  assert(token, "A API não retornou o access token.");

  return token;
}

async function createReview(token, body) {
  return request("/avaliacoes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function testPublicEmptyList() {
  console.log("1. Testando listagem pública vazia...");

  const response = await request(
    `/avaliacoes/cacambeiro/${fixtures.supplierId}`,
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}`,
  );

  assert(
    response.body.success === true,
    "A resposta deveria indicar sucesso.",
  );

  assert(
    Array.isArray(response.body.data.avaliacoes),
    "A resposta deveria possuir uma lista de avaliações.",
  );

  assert(
    response.body.data.avaliacoes.length === 0,
    "A lista deveria estar vazia.",
  );

  assert(
    response.body.data.resumo.total === 0,
    "O total deveria ser zero.",
  );

  console.log("✅ Listagem vazia retornada corretamente.");
}

async function testInvalidSupplierId() {
  console.log("2. Testando UUID inválido...");

  const response = await request(
    "/avaliacoes/cacambeiro/id-invalido",
  );

  assert(
    response.status === 400,
    `Esperado 400, recebido ${response.status}`,
  );

  assert(
    response.body.code === "VALIDATION_ERROR",
    "Código de validação incorreto.",
  );

  console.log("✅ UUID inválido bloqueado.");
}

async function testUnknownSupplier() {
  console.log("3. Testando fornecedor inexistente...");

  const response = await request(
    `/avaliacoes/cacambeiro/${crypto.randomUUID()}`,
  );

  assert(
    response.status === 404,
    `Esperado 404, recebido ${response.status}`,
  );

  assert(
    response.body.code === "SUPPLIER_NOT_FOUND",
    "Código de erro incorreto.",
  );

  console.log("✅ Fornecedor inexistente tratado.");
}

async function testWithoutAuthentication() {
  console.log("4. Testando criação sem autenticação...");

  const response = await request("/avaliacoes", {
    method: "POST",
    body: JSON.stringify({
      aluguel_id: fixtures.finishedOrderId,
      nota: 5,
    }),
  });

  assert(
    response.status === 401,
    `Esperado 401, recebido ${response.status}`,
  );

  console.log("✅ Criação sem autenticação bloqueada.");
}

async function testWrongRole(supplierToken) {
  console.log("5. Testando criação pelo fornecedor...");

  const response = await createReview(supplierToken, {
    aluguel_id: fixtures.finishedOrderId,
    nota: 5,
  });

  assert(
    response.status === 403,
    `Esperado 403, recebido ${response.status}`,
  );

  console.log("✅ Perfil incorreto bloqueado.");
}

async function testInvalidPayload(consumerToken) {
  console.log("6. Testando payload inválido...");

  const response = await createReview(consumerToken, {
    aluguel_id: "id-invalido",
    nota: 7,
    comentario: "a".repeat(501),
  });

  assert(
    response.status === 400,
    `Esperado 400, recebido ${response.status}`,
  );

  assert(
    response.body.code === "VALIDATION_ERROR",
    "Código de validação incorreto.",
  );

  assert(
    response.body.fields.aluguel_id,
    "Erro de aluguel_id não retornado.",
  );

  assert(
    response.body.fields.nota,
    "Erro de nota não retornado.",
  );

  assert(
    response.body.fields.comentario,
    "Erro de comentário não retornado.",
  );

  console.log("✅ Payload inválido bloqueado.");
}

async function testForeignOrder(consumerToken) {
  console.log("7. Testando pedido de outro consumidor...");

  const response = await createReview(consumerToken, {
    aluguel_id: fixtures.foreignOrderId,
    nota: 5,
    comentario: "Tentativa indevida",
  });

  assert(
    response.status === 404,
    `Esperado 404, recebido ${response.status}`,
  );

  assert(
    response.body.code === "ORDER_NOT_FOUND",
    "Código de erro incorreto.",
  );

  console.log("✅ Ownership do pedido protegido.");
}

async function testUnfinishedOrder(consumerToken) {
  console.log("8. Testando pedido não finalizado...");

  const response = await createReview(consumerToken, {
    aluguel_id: fixtures.unfinishedOrderId,
    nota: 4,
    comentario: "Pedido ainda em andamento",
  });

  assert(
    response.status === 400,
    `Esperado 400, recebido ${response.status}`,
  );

  assert(
    response.body.code === "ORDER_NOT_FINISHED",
    "Código de erro incorreto.",
  );

  console.log("✅ Pedido não finalizado bloqueado.");
}

async function testValidReview(consumerToken) {
  console.log("9. Testando criação válida...");

  const response = await createReview(consumerToken, {
    aluguel_id: fixtures.finishedOrderId,
    nota: 5,
    comentario: "  Excelente atendimento!  ",
  });

  assert(
    response.status === 201,
    `Esperado 201: ${JSON.stringify(response.body)}`,
  );

  assert(
    response.body.success === true,
    "A resposta deveria indicar sucesso.",
  );

  assert(
    response.body.data.nota === 5,
    "A nota retornada está incorreta.",
  );

  assert(
    response.body.data.comentario ===
      "Excelente atendimento!",
    "O comentário não foi normalizado.",
  );

  const rows = await sql`
    SELECT nota, comentario
    FROM avaliacoes
    WHERE aluguel_id = ${fixtures.finishedOrderId}
  `;

  assert(
    rows.length === 1,
    "A avaliação não foi persistida.",
  );

  assert(
    rows[0].nota === 5,
    "A nota persistida está incorreta.",
  );

  console.log("✅ Avaliação criada e persistida.");
}

async function testDuplicateReview(consumerToken) {
  console.log("10. Testando avaliação duplicada...");

  const response = await createReview(consumerToken, {
    aluguel_id: fixtures.finishedOrderId,
    nota: 3,
    comentario: "Segunda avaliação",
  });

  assert(
    response.status === 409,
    `Esperado 409, recebido ${response.status}`,
  );

  assert(
    response.body.code === "ORDER_ALREADY_REVIEWED",
    "Código de erro incorreto.",
  );

  const rows = await sql`
    SELECT id
    FROM avaliacoes
    WHERE aluguel_id = ${fixtures.finishedOrderId}
  `;

  assert(
    rows.length === 1,
    "Mais de uma avaliação foi persistida.",
  );

  console.log("✅ Avaliação duplicada bloqueada.");
}

async function testListWithSummary() {
  console.log("11. Testando listagem e resumo...");

  const response = await request(
    `/avaliacoes/cacambeiro/${fixtures.supplierId}`,
  );

  assert(
    response.status === 200,
    `Esperado 200, recebido ${response.status}`,
  );

  assert(
    response.body.data.avaliacoes.length === 1,
    "A listagem deveria conter uma avaliação.",
  );

  assert(
    response.body.data.resumo.total === 1,
    "O total de avaliações está incorreto.",
  );

  assert(
    Number(response.body.data.resumo.nota_media) === 5,
    "A média das avaliações está incorreta.",
  );

  console.log("✅ Listagem e resumo corretos.");
}

async function run() {
  console.log("Preparando testes de avaliações...\n");

  try {
    await cleanup();
    await prepareFixtures();

    const consumerToken = await login(emails.consumer);
    const supplierToken = await login(emails.supplier);

    await testPublicEmptyList();
    await testInvalidSupplierId();
    await testUnknownSupplier();
    await testWithoutAuthentication();
    await testWrongRole(supplierToken);
    await testInvalidPayload(consumerToken);
    await testForeignOrder(consumerToken);
    await testUnfinishedOrder(consumerToken);
    await testValidReview(consumerToken);
    await testDuplicateReview(consumerToken);
    await testListWithSummary();

    console.log("\n✅ TODOS OS TESTES DE AVALIAÇÕES PASSARAM.");
  } finally {
    await cleanup();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ TESTE DE AVALIAÇÕES FALHOU:");
    console.error(error);
    process.exit(1);
  });