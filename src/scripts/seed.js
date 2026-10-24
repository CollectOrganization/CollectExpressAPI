const sql = require("../config/db");
const bcrypt = require("bcryptjs");
require("dotenv").config();

async function seed() {
  console.log("Iniciando seed do banco de dados...");

    try {
    // Senha padrão
    const senhaHash = await bcrypt.hash("123456", 10);

    // Trecho novo abaixo

    // src/scripts/seed.js — bloco principal, do "Limpando dados antigos"
    // até o final da função seed().
    /*
    * Matriz de perfis cobrindo TODAS as combinações
    * (tipo_perfil × status) para facilitar testes.
    *
    * ADMIN PENDENTE / SUSPENSO existem para testar o painel admin,
    * mas NUNCA conseguem logar — o login bloqueia nos dois estados.
    */
    const profilesSeed = [
      // ───── ADMIN ─────
      {
        nome: "Admin Sistema",
        email: "admin@collectexpress.com",
        tipo: "ADMIN",
        status: "ATIVO",
        documento: "11111111111",
        telefone: "11999990000",
      },
      {
        nome: "Admin Pendente",
        email: "admin.pendente@collectexpress.com",
        tipo: "ADMIN",
        status: "PENDENTE",
        documento: "11111111112",
        telefone: "11999990001",
      },
      {
        nome: "Admin Suspenso",
        email: "admin.suspenso@collectexpress.com",
        tipo: "ADMIN",
        status: "SUSPENSO",
        documento: "11111111113",
        telefone: "11999990002",
      },

      // ───── CONSUMIDOR ─────
      {
        nome: "João Construtor",
        email: "joao@construtor.com",
        tipo: "CONSUMIDOR",
        status: "ATIVO",
        documento: "12345678901",
        telefone: "11966666666",
      },
      {
        nome: "Maria Reformas",
        email: "maria@reformas.com",
        tipo: "CONSUMIDOR",
        status: "ATIVO",
        documento: "12345678902",
        telefone: "11966666667",
      },
      {
        nome: "Cliente Pendente",
        email: "consumidor.pendente@collectexpress.com",
        tipo: "CONSUMIDOR",
        status: "PENDENTE",
        documento: "12345678903",
        telefone: "11966666668",
      },
      {
        nome: "Cliente Suspenso",
        email: "consumidor.suspenso@collectexpress.com",
        tipo: "CONSUMIDOR",
        status: "SUSPENSO",
        documento: "12345678904",
        telefone: "11966666669",
      },

      // ───── CACAMBEIRO ─────
      {
        nome: "Silva Caçambas",
        email: "silva@cacambas.com",
        tipo: "CACAMBEIRO",
        status: "ATIVO",
        documento: "11111111000111",
        telefone: "11955555555",
      },
      {
        nome: "Entulho Rápido",
        email: "contato@entulhorapido.com",
        tipo: "CACAMBEIRO",
        status: "PENDENTE",
        documento: "11111111000112",
        telefone: "11955555556",
      },
      {
        nome: "Caçambas Suspenso",
        email: "cacambeiro.suspenso@collectexpress.com",
        tipo: "CACAMBEIRO",
        status: "SUSPENSO",
        documento: "11111111000113",
        telefone: "11955555557",
      },
    ];

    /*
    * Uma caçamba para cada categoria, todas vinculadas ao fornecedor
    * ATIVO (silva@cacambas.com), garantindo que o catálogo público
    * tenha pelo menos um item por filtro em qualquer execução.
    */
    const cacambasPorCategoria = [
      {
        nome: "Caçamba Entulho 5m³",
        tipo: "Entulho de Obra",
        tamanho: 5,
        preco: 350,
      },
      {
        nome: "Caçamba Podas 3m³",
        tipo: "Podas",
        tamanho: 3,
        preco: 290,
      },
      {
        nome: "Caçamba Recicláveis 7m³",
        tipo: "Recicláveis",
        tamanho: 7,
        preco: 420,
      },
    ];

    console.log("Limpando dados antigos...");

    /*
    * TRUNCATE CASCADE garante que dependências (itens, tokens,
    * histórico etc.) sejam removidas na ordem correta sem
    * precisar de DELETEs manuais.
    */
    await sql`
      TRUNCATE TABLE
        avaliacoes,
        itens_aluguel,
        alugueis,
        itens_carrinho,
        carrinho,
        cacambas,
        detalhes_cacambeiro,
        enderecos,
        usuarios,
        categorias,
        login_attempts,
        revoked_tokens,
        refresh_tokens,
        password_recovery_tokens
      RESTART IDENTITY CASCADE
    `;

    // ─────────────────────────────────────────────
    // 1. Categorias
    // ─────────────────────────────────────────────
    console.log("Criando categorias...");

    const categoriasRows = await sql`
      INSERT INTO categorias (id, nome)
      VALUES
        (gen_random_uuid(), 'Entulho de Obra'),
        (gen_random_uuid(), 'Podas'),
        (gen_random_uuid(), 'Recicláveis')
      RETURNING id, nome
    `;

    // ─────────────────────────────────────────────
    // 2. Usuários (matriz tipo_perfil × status)
    // ─────────────────────────────────────────────
    console.log("Criando usuários...");

    //const senhaHash = await bcrypt.hash("123456", 10);
    const usuariosCriados = {};

    for (const p of profilesSeed) {
      /*
      * Cada perfil é inserido individualmente para preservar o `id`
      * em memória — será usado para ligar endereços, caçambas e
      * pedidos logo abaixo.
      */
      const [user] = await sql`
        INSERT INTO usuarios (
          nome_completo,
          email,
          senha_hash,
          tipo_perfil,
          documento,
          telefone,
          status
        )
        VALUES (
          ${p.nome},
          ${p.email.toLowerCase()},
          ${senhaHash},
          ${p.tipo},
          ${p.documento},
          ${p.telefone},
          ${p.status}
        )
        RETURNING id, email, tipo_perfil, status
      `;

      usuariosCriados[p.email] = user;
    }

    // ─────────────────────────────────────────────
    // 3. Detalhes do caçambeiro
    // ─────────────────────────────────────────────
    console.log("Criando detalhes dos caçambeiros...");

    const cacambeiros = profilesSeed.filter(
      (p) => p.tipo === "CACAMBEIRO",
    );

    for (const c of cacambeiros) {
      const user = usuariosCriados[c.email];

      await sql`
        INSERT INTO detalhes_cacambeiro (
          usuario_id,
          horario_inicio,
          horario_fim,
          raio_entrega_km,
          taxa_entrega
        )
        VALUES (
          ${user.id},
          '08:00',
          '18:00',
          30,
          50
        )
      `;
    }

    // ─────────────────────────────────────────────
    // 4. Endereços para consumidores ATIVOS
    // ─────────────────────────────────────────────
    console.log("Criando endereços...");

    const enderecos = {};

    for (const email of ["joao@construtor.com", "maria@reformas.com"]) {
      const user = usuariosCriados[email];
      const isJoao = email === "joao@construtor.com";

      const [endereco] = await sql`
        INSERT INTO enderecos (
          usuario_id,
          cep,
          logradouro,
          numero,
          bairro,
          cidade_estado
        )
        VALUES (
          ${user.id},
          ${isJoao ? "01311000" : "01001000"},
          ${isJoao ? "Avenida Paulista" : "Praça da Sé"},
          ${isJoao ? "1000" : "1"},
          ${isJoao ? "Bela Vista" : "Sé"},
          'São Paulo - SP'
        )
        RETURNING id
      `;

      enderecos[email] = endereco;
    }

    // ─────────────────────────────────────────────
    // 5. Caçambas
    // ─────────────────────────────────────────────
    console.log("Criando caçambas...");

    const silva = usuariosCriados["silva@cacambas.com"];
    const contato = usuariosCriados["contato@entulhorapido.com"];
    const suspensoCac = usuariosCriados[
      "cacambeiro.suspenso@collectexpress.com"
    ];

    const cacambasCriadas = [];

    // 5.1 — Fornecedor ATIVO: cobertura completa das categorias
    for (const c of cacambasPorCategoria) {
      const [row] = await sql`
        INSERT INTO cacambas (
          cacambeiro_id,
          nome,
          tipo_residuo,
          tamanho_m3,
          preco_diaria,
          disponivel
        )
        VALUES (
          ${silva.id},
          ${c.nome},
          ${c.tipo},
          ${c.tamanho},
          ${c.preco},
          TRUE
        )
        RETURNING id, tipo_residuo
      `;

      cacambasCriadas.push(row);
    }

    /*
    * 5.2 — Fornecedores não-ativos também possuem caçambas.
    *
    * Elas NÃO devem aparecer no catálogo público se o backend
    * filtrar corretamente por `usuarios.status = 'ATIVO'`.
    * Servem para exercitar esse filtro em testes.
    */
    for (const fornecedor of [
      { user: contato, nome: "Caçamba Pendente 5m³", tipo: "Entulho de Obra" },
      { user: suspensoCac, nome: "Caçamba Suspensa 5m³", tipo: "Entulho de Obra" },
    ]) {
      await sql`
        INSERT INTO cacambas (
          cacambeiro_id,
          nome,
          tipo_residuo,
          tamanho_m3,
          preco_diaria,
          disponivel
        )
        VALUES (
          ${fornecedor.user.id},
          ${fornecedor.nome},
          ${fornecedor.tipo},
          5,
          300,
          TRUE
        )
      `;
    }

    // ─────────────────────────────────────────────
    // 6. Pedido de exemplo (João × Silva)
    // ─────────────────────────────────────────────
    console.log("Criando pedido de exemplo...");

    const joao = usuariosCriados["joao@construtor.com"];

    // Usa sempre a caçamba de Entulho para manter valores previsíveis.
    const cacambaEntulho = cacambasCriadas.find(
      (c) => c.tipo_residuo === "Entulho de Obra",
    );

    const dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() + 3);
    const dataInicioISO = dataInicio.toISOString().split("T")[0];

    const [pedido] = await sql`
      INSERT INTO alugueis (
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
      VALUES (
        ${joao.id},
        ${silva.id},
        ${enderecos["joao@construtor.com"].id},
        NOW(),
        ${dataInicioISO},
        3,
        1100,
        'PAGO',
        'FINALIZADO'
      )
      RETURNING id
    `;

    await sql`
      INSERT INTO itens_aluguel (
        aluguel_id,
        cacamba_id,
        quantidade,
        dias_aluguel,
        preco_diaria
      )
      VALUES (
        ${pedido.id},
        ${cacambaEntulho.id},
        1,
        3,
        350
      )
    `;

    // ─────────────────────────────────────────────
    // 7. Avaliação do pedido finalizado
    // ─────────────────────────────────────────────
    console.log("Criando avaliação...");

    await sql`
      INSERT INTO avaliacoes (
        aluguel_id,
        consumidor_id,
        cacambeiro_id,
        nota,
        comentario
      )
      VALUES (
        ${pedido.id},
        ${joao.id},
        ${silva.id},
        5,
        'Excelente atendimento e entrega no prazo.'
      )
    `;

    // ─────────────────────────────────────────────
    // 8. Resumo final
    // ─────────────────────────────────────────────
    console.log("");
    console.log("✅ Seed concluído com sucesso.");
    console.log("");
    console.log("Credenciais (senha 123456 para todos):");
    console.log("");
    console.log("  ADMIN");
    console.log("    admin@collectexpress.com         → ATIVO");
    console.log("    admin.pendente@collectexpress.com → PENDENTE (não loga)");
    console.log("    admin.suspenso@collectexpress.com → SUSPENSO (não loga)");
    console.log("");
    console.log("  CONSUMIDOR");
    console.log("    joao@construtor.com              → ATIVO");
    console.log("    maria@reformas.com               → ATIVO");
    console.log("    consumidor.pendente@collectexpress.com → PENDENTE (não loga)");
    console.log("    consumidor.suspenso@collectexpress.com → SUSPENSO (não loga)");
    console.log("");
    console.log("  CACAMBEIRO");
    console.log("    silva@cacambas.com               → ATIVO (3 caçambas)");
    console.log("    contato@entulhorapido.com        → PENDENTE (não loga)");
    console.log("    cacambeiro.suspenso@collectexpress.com → SUSPENSO (não loga)");
    console.log("");
    console.log(`Categorias criadas: ${categoriasRows.map((c) => c.nome).join(", ")}`);
    console.log(`Caçambas do fornecedor ATIVO: ${cacambasCriadas.length}`);
    console.log("");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao rodar seed:", error);
    process.exit(1);
  }
}  

seed();
    /* ------- Removido em funcao de uma nova seed contendo mais dados de usuarios etc.
    // 1. Limpar dados existentes (CASCADE resolverá as dependências)
    console.log("Limpando dados antigos...");

    await sql`
      TRUNCATE TABLE
        password_recovery_tokens,
        refresh_tokens,
        revoked_tokens,
        login_attempts,
        avaliacoes,
        itens_aluguel,
        alugueis,
        itens_carrinho,
        carrinho,
        cacambas,
        detalhes_cacambeiro,
        enderecos,
        usuarios,
        categorias
      RESTART IDENTITY CASCADE
    `;

    console.log("Dados antigos removidos.");

    // 2. Criar Categorias
    console.log("Criando categorias...");
    const categorias = await sql`
      INSERT INTO categorias (nome) VALUES 
      ('Entulho de Obra'),
      ('Gesso e Drywall'),
      ('Madeira'),
      ('Terra e Areia'),
      ('Recicláveis')
      RETURNING *
    `;

    // 3. Criar Admin
    console.log("Criando administrador...");
    await sql`
      INSERT INTO usuarios (nome_completo, email, senha_hash, tipo_perfil, documento, telefone)
      VALUES ('Admin Sistema', 'admin@collectexpress.com', ${senhaHash}, 'ADMIN', '00000000000', '11999999999')
    `;

    // 4. Criar Caçambeiros
    console.log("Criando caçambeiros e seus detalhes...");
    const cacambeiros = await sql`
      INSERT INTO usuarios (nome_completo, email, senha_hash, tipo_perfil, documento, telefone)
      VALUES 
      ('Caçambas Silva', 'silva@cacambas.com', ${senhaHash}, 'CACAMBEIRO', '11111111111', '11988888888'),
      ('Entulho Rápido', 'contato@entulhorapido.com', ${senhaHash}, 'CACAMBEIRO', '22222222222', '11977777777')
      RETURNING *
    `;

    await sql`
      INSERT INTO detalhes_cacambeiro (usuario_id, horario_inicio, horario_fim, raio_entrega_km, taxa_entrega)
      VALUES 
      (${cacambeiros[0].id}, '08:00:00', '18:00:00', 30.0, 50.00),
      (${cacambeiros[1].id}, '07:00:00', '19:00:00', 50.0, 75.00)
    `;

    // 5. Criar Caçambas
    console.log("Criando caçambas...");
    const cacambas = await sql`
      INSERT INTO cacambas (cacambeiro_id, nome, tipo_residuo, tamanho_m3, preco_diaria, foto_url, disponivel)
      VALUES 
      (${cacambeiros[0].id}, 'Caçamba Standard', 'Entulho de Obra', 4.0, 150.00, 'https://via.placeholder.com/400x300.png?text=Cacamba+4m3', true),
      (${cacambeiros[0].id}, 'Caçamba Gesso', 'Gesso e Drywall', 5.0, 180.00, 'https://via.placeholder.com/400x300.png?text=Cacamba+5m3', true),
      (${cacambeiros[1].id}, 'Caçamba Grande', 'Terra e Areia', 7.0, 250.00, 'https://via.placeholder.com/400x300.png?text=Cacamba+7m3', true)
      RETURNING *
    `;

    // 6. Criar Consumidores
    console.log("Criando consumidores...");
    const consumidores = await sql`
      INSERT INTO usuarios (nome_completo, email, senha_hash, tipo_perfil, documento, telefone)
      VALUES 
      ('João Construtor', 'joao@construtor.com', ${senhaHash}, 'CONSUMIDOR', '33333333333', '11966666666'),
      ('Maria Reformas', 'maria@reformas.com', ${senhaHash}, 'CONSUMIDOR', '44444444444', '11955555555')
      RETURNING *
    `;

    // 7. Criar Endereços
    console.log("Criando endereços...");
    const enderecos = await sql`
      INSERT INTO enderecos (usuario_id, cep, logradouro, numero, bairro, cidade_estado)
      VALUES 
      (${consumidores[0].id}, '01001000', 'Praça da Sé', '1', 'Sé', 'São Paulo - SP'),
      (${consumidores[1].id}, '01310100', 'Av. Paulista', '1578', 'Bela Vista', 'São Paulo - SP')
      RETURNING *
    `;

    // 8. Criar Aluguéis (Pedidos passados para ter histórico no financeiro)
    console.log("Criando aluguéis e itens...");
    const alugueis = await sql`
      INSERT INTO alugueis (consumidor_id, cacambeiro_id, endereco_id, data_pedido, data_inicio, dias_aluguel, preco_final, status_pagamento, status_aluguel)
      VALUES 
      (${consumidores[0].id}, ${cacambeiros[0].id}, ${enderecos[0].id}, NOW() - INTERVAL '15 days', CURRENT_DATE - INTERVAL '14 days', 3, 500.00, 'PAGO', 'FINALIZADO'),
      (${consumidores[1].id}, ${cacambeiros[1].id}, ${enderecos[1].id}, NOW() - INTERVAL '5 days', CURRENT_DATE - INTERVAL '3 days', 5, 1325.00, 'PAGO', 'EM_USO'),
      (${consumidores[0].id}, ${cacambeiros[0].id}, ${enderecos[0].id}, NOW() - INTERVAL '1 day', CURRENT_DATE + INTERVAL '2 days', 2, 350.00, 'PENDENTE', 'AGUARDANDO_ENTREGA')
      RETURNING *
    `;

    // Itens Aluguel
    await sql`
      INSERT INTO itens_aluguel (aluguel_id, cacamba_id, quantidade, dias_aluguel, preco_diaria)
      VALUES 
      (${alugueis[0].id}, ${cacambas[0].id}, 1, 3, 150.00),
      (${alugueis[1].id}, ${cacambas[2].id}, 1, 5, 250.00),
      (${alugueis[2].id}, ${cacambas[0].id}, 1, 2, 150.00)
    `;

    // 9. Criar Avaliações
    console.log("Criando avaliações...");
    await sql`
      INSERT INTO avaliacoes (aluguel_id, consumidor_id, cacambeiro_id, nota, comentario, data_avaliacao)
      VALUES 
      (${alugueis[0].id}, ${consumidores[0].id}, ${cacambeiros[0].id}, 5, 'Excelente serviço, entregou no prazo!', NOW() - INTERVAL '10 days')
    `;

    console.log("✅ Seed concluído com sucesso!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erro ao rodar seed:", error);
    process.exit(1);
  }*/




