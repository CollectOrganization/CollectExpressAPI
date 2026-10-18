require("dotenv").config();

const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const sql = require("../config/db");

const apiUrl =
  process.env.API_TEST_URL || "http://localhost:3001/api";

const marker = `ATOMIC_${Date.now()}`;

const fixtures = {
  consumerId: crypto.randomUUID(),
  secondConsumerId: crypto.randomUUID(),
  supplierId: crypto.randomUUID(),
  secondSupplierId: crypto.randomUUID(),
  addressId: crypto.randomUUID(),
  foreignAddressId: crypto.randomUUID(),
  dumpsterId: crypto.randomUUID(),
  foreignDumpsterId: crypto.randomUUID(),
  cartId: crypto.randomUUID(),
  cartItemId: crypto.randomUUID(),
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

  let body;

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
        'Consumidor Checkout Atômico',
        ${`consumer.${marker}@test.local`},
        ${passwordHash},
        'CONSUMIDOR',
        ${`${Date.now()}`.padStart(11, "0").slice(-11)},
        '11911111111',
        'ATIVO'
      ),
      (
        ${fixtures.secondConsumerId},
        'Outro Consumidor Checkout',
        ${`consumer2.${marker}@test.local`},
        ${passwordHash},
        'CONSUMIDOR',
        ${`${Date.now() + 1}`.padStart(11, "0").slice(-11)},
        '11922222222',
        'ATIVO'
      ),
      (
        ${fixtures.supplierId},
        'Fornecedor Checkout Atômico',
        ${`supplier.${marker}@test.local`},
        ${passwordHash},
        'CACAMBEIRO',
        ${`${Date.now()}`.padStart(14, "0").slice(-14)},
        '11933333333',
        'ATIVO'
      ),
      (
        ${fixtures.secondSupplierId},
        'Outro Fornecedor Checkout',
        ${`supplier2.${marker}@test.local`},
        ${passwordHash},
        'CACAMBEIRO',
        ${`${Date.now() + 1}`.padStart(14, "0").slice(-14)},
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
        ${fixtures.foreignAddressId},
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
    VALUES
      (
        ${fixtures.dumpsterId},
        ${fixtures.supplierId},
        ${`TEST_ATOMIC_FAIL_${marker}`},
        'Entulho de Obra',
        5,
        100,
        TRUE
      ),
      (
        ${fixtures.foreignDumpsterId},
        ${fixtures.secondSupplierId},
        ${`TEST_FOREIGN_${marker}`},
        'Entulho de Obra',
        5,
        120,
        TRUE
      )
  `;

  await recreateCart();
}

async function recreateCart() {
  await sql`
    DELETE FROM carrinho
    WHERE consumidor_id = ${fixtures.consumerId}
  `;

  await sql`
    INSERT INTO carrinho (
      id,
      consumidor_id,
      cacambeiro_id
    )
    VALUES (
      ${fixtures.cartId},
      ${fixtures.consumerId},
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
      ${fixtures.cartItemId},
      ${fixtures.cartId},
      ${fixtures.dumpsterId},
      1,
      3
    )
  `;
}

async function login() {
  const response = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: `consumer.${marker}@test.local`,
      senha: "123456",
    }),
  });

  assert(
    response.status === 200,
    `Login falhou: ${JSON.stringify(response.body)}`,
  );

  return response.body.data.access_token;
}

function checkoutDate() {
  const date = new Date();
  date.setDate(date.getDate() + 3);
  return date.toISOString().split("T")[0];
}

async function checkout(token, addressId) {
  return request("/alugueis/checkout", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      endereco_id: addressId,
      data_inicio: checkoutDate(),
    }),
  });
}

async function assertCartExists() {
  const carts = await sql`
    SELECT id
    FROM carrinho
    WHERE consumidor_id = ${fixtures.consumerId}
  `;

  const items = await sql`
    SELECT ic.id
    FROM itens_carrinho ic
    JOIN carrinho c ON c.id = ic.carrinho_id
    WHERE c.consumidor_id = ${fixtures.consumerId}
  `;

  assert(carts.length === 1, "O carrinho deveria existir.");
  assert(items.length === 1, "O item do carrinho deveria existir.");
}

async function assertNoOrders() {
  const orders = await sql`
    SELECT id
    FROM alugueis
    WHERE consumidor_id = ${fixtures.consumerId}
  `;

  assert(
    orders.length === 0,
    "Um pedido foi persistido indevidamente.",
  );
}

async function testForeignAddress(token) {
  console.log("1. Testando endereço de outro usuário...");

  const response = await checkout(
    token,
    fixtures.foreignAddressId,
  );

  assert(
    response.status === 404,
    `Esperado 404, recebido ${response.status}`,
  );

  await assertCartExists();
  await assertNoOrders();

  console.log("✅ Endereço de outro usuário bloqueado.");
}

async function testUnavailableDumpster(token) {
  console.log("2. Testando caçamba indisponível...");

  await sql`
    UPDATE cacambas
    SET disponivel = FALSE
    WHERE id = ${fixtures.dumpsterId}
  `;

  const response = await checkout(
    token,
    fixtures.addressId,
  );

  assert(
    response.status === 400,
    `Esperado 400, recebido ${response.status}`,
  );

  await assertCartExists();
  await assertNoOrders();

  await sql`
    UPDATE cacambas
    SET disponivel = TRUE
    WHERE id = ${fixtures.dumpsterId}
  `;

  console.log("✅ Caçamba indisponível bloqueada.");
}

async function testWrongSupplier(token) {
  console.log("3. Testando fornecedor incompatível...");

  await sql`
    UPDATE itens_carrinho
    SET cacamba_id = ${fixtures.foreignDumpsterId}
    WHERE id = ${fixtures.cartItemId}
  `;

  const response = await checkout(
    token,
    fixtures.addressId,
  );

  assert(
    response.status === 400,
    `Esperado 400, recebido ${response.status}`,
  );

  await assertCartExists();
  await assertNoOrders();

  await sql`
    UPDATE itens_carrinho
    SET cacamba_id = ${fixtures.dumpsterId}
    WHERE id = ${fixtures.cartItemId}
  `;

  console.log("✅ Fornecedor incompatível bloqueado.");
}

async function installFailureTrigger() {
  await sql`
    CREATE OR REPLACE FUNCTION test_atomic_checkout_failure()
    RETURNS TRIGGER AS $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM cacambas
        WHERE id = NEW.cacamba_id
          AND nome LIKE 'TEST_ATOMIC_FAIL_%'
      ) THEN
        RAISE EXCEPTION 'Falha proposital no checkout atômico';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    DROP TRIGGER IF EXISTS trigger_test_atomic_checkout
    ON itens_aluguel
  `;

  await sql`
    CREATE TRIGGER trigger_test_atomic_checkout
    BEFORE INSERT ON itens_aluguel
    FOR EACH ROW
    EXECUTE FUNCTION test_atomic_checkout_failure()
  `;
}

async function removeFailureTrigger() {
  await sql`
    DROP TRIGGER IF EXISTS trigger_test_atomic_checkout
    ON itens_aluguel
  `;

  await sql`
    DROP FUNCTION IF EXISTS test_atomic_checkout_failure()
  `;
}

async function testDatabaseRollback(token) {
  console.log("4. Testando rollback após falha interna...");

  await installFailureTrigger();

  const response = await checkout(
    token,
    fixtures.addressId,
  );

  assert(
    response.status === 500,
    `Esperado 500, recebido ${response.status}`,
  );

  await assertNoOrders();
  await assertCartExists();

  await removeFailureTrigger();

  console.log("✅ Pedido revertido e carrinho preservado.");
}

async function testSuccessfulCheckout(token) {
  console.log("5. Testando checkout válido...");

  const response = await checkout(
    token,
    fixtures.addressId,
  );

  assert(
    response.status === 201,
    `Checkout deveria retornar 201: ${JSON.stringify(response.body)}`,
  );

  const orders = await sql`
    SELECT id, preco_final
    FROM alugueis
    WHERE consumidor_id = ${fixtures.consumerId}
  `;

  assert(orders.length === 1, "O pedido não foi criado.");

  const orderItems = await sql`
    SELECT id
    FROM itens_aluguel
    WHERE aluguel_id = ${orders[0].id}
  `;

  assert(
    orderItems.length === 1,
    "Os itens do pedido não foram criados.",
  );

  const carts = await sql`
    SELECT id
    FROM carrinho
    WHERE consumidor_id = ${fixtures.consumerId}
  `;

  assert(
    carts.length === 0,
    "O carrinho não foi removido após o sucesso.",
  );

  assert(
    Number(orders[0].preco_final) === 350,
    `Total incorreto: ${orders[0].preco_final}`,
  );

  console.log("✅ Pedido e itens criados.");
  console.log("✅ Carrinho removido.");
  console.log("✅ Total calculado corretamente: R$ 350,00.");
}

async function cleanup() {
  await removeFailureTrigger();

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
  console.log("Preparando teste de checkout atômico...");

  try {
    await cleanup();
    await prepareFixtures();

    const token = await login();

    await testForeignAddress(token);
    await testUnavailableDumpster(token);
    await testWrongSupplier(token);
    await testDatabaseRollback(token);
    await testSuccessfulCheckout(token);

    console.log("\n✅ TODOS OS TESTES PASSARAM.");
  } finally {
    await cleanup();
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ TESTE FALHOU:", error);
    process.exit(1);
  });