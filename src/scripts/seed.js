const sql = require("../config/db");
const bcrypt = require("bcryptjs");
require("dotenv").config();

async function seed() {
  console.log("Iniciando seed do banco de dados...");

  try {
    // Senha padrão
    const senhaHash = await bcrypt.hash("123456", 10);

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
  }
}

seed();
