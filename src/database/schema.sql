-- CollectExpress Marketplace - Database Schema
-- PostgreSQL (NeonDB Serverless)

-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- ENUMS
-- ============================================
DO $$ BEGIN
  CREATE TYPE tipo_perfil AS ENUM ('CONSUMIDOR', 'CACAMBEIRO', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE status_aluguel AS ENUM ('AGUARDANDO_ENTREGA', 'EM_USO', 'AGUARDANDO_RETIRADA', 'FINALIZADO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE status_pagamento AS ENUM ('PENDENTE', 'PAGO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE status_usuario AS ENUM ('PENDENTE', 'ATIVO', 'SUSPENSO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
-- ============================================
-- TABLES
-- ============================================

-- Usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome_completo VARCHAR(150) NOT NULL,
  email VARCHAR(255) NOT NULL,
  senha_hash VARCHAR(255) NOT NULL,
  tipo_perfil tipo_perfil NOT NULL,
  documento VARCHAR(14) NOT NULL,
  telefone VARCHAR(11) NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  token_version INTEGER NOT NULL DEFAULT 0,
  status status_usuario NOT NULL DEFAULT 'ATIVO',

  CONSTRAINT usuarios_email_unique UNIQUE (email),
  CONSTRAINT usuarios_documento_unique UNIQUE (documento)
);

-- Detalhes Cacambeiro
CREATE TABLE IF NOT EXISTS detalhes_cacambeiro (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL,
  horario_inicio TIME NOT NULL,
  horario_fim TIME NOT NULL,
  raio_entrega_km DECIMAL(5, 2) NOT NULL,
  taxa_entrega DECIMAL(7, 2) NOT NULL,

  CONSTRAINT fk_detalhes_cacambeiro_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT detalhes_cacambeiro_usuario_unique UNIQUE (usuario_id)
);

-- Cacambas
CREATE TABLE IF NOT EXISTS cacambas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cacambeiro_id UUID NOT NULL,
  nome VARCHAR(100) NOT NULL,
  tipo_residuo VARCHAR(50) NOT NULL,
  tamanho_m3 DECIMAL(5, 2) NOT NULL,
  preco_diaria DECIMAL(10, 2) NOT NULL,
  foto_url VARCHAR(500),
  disponivel BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_cacambas_cacambeiro
    FOREIGN KEY (cacambeiro_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Enderecos
CREATE TABLE IF NOT EXISTS enderecos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL,
  cep VARCHAR(8) NOT NULL,
  logradouro VARCHAR(200) NOT NULL,
  numero VARCHAR(20) NOT NULL,
  bairro VARCHAR(100) NOT NULL,
  cidade_estado VARCHAR(100) NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_enderecos_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- Carrinho
CREATE TABLE IF NOT EXISTS carrinho (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consumidor_id UUID NOT NULL,
  cacambeiro_id UUID NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_carrinho_consumidor
    FOREIGN KEY (consumidor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_carrinho_cacambeiro
    FOREIGN KEY (cacambeiro_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT carrinho_consumidor_unique UNIQUE (consumidor_id)
);

-- Itens Carrinho
CREATE TABLE IF NOT EXISTS itens_carrinho (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  carrinho_id UUID NOT NULL,
  cacamba_id UUID NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 1,
  dias_aluguel INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT fk_itens_carrinho_carrinho
    FOREIGN KEY (carrinho_id) REFERENCES carrinho(id) ON DELETE CASCADE,
  CONSTRAINT fk_itens_carrinho_cacamba
    FOREIGN KEY (cacamba_id) REFERENCES cacambas(id) ON DELETE CASCADE,
  CONSTRAINT itens_carrinho_quantidade_check CHECK (quantidade >= 1 AND quantidade <= 10),
  CONSTRAINT itens_carrinho_dias_check CHECK (dias_aluguel >= 1 AND dias_aluguel <= 90)
);

-- Alugueis
CREATE TABLE IF NOT EXISTS alugueis (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consumidor_id UUID NOT NULL,
  cacambeiro_id UUID NOT NULL,
  endereco_id UUID NOT NULL,
  data_pedido TIMESTAMP NOT NULL DEFAULT NOW(),
  data_inicio DATE NOT NULL,
  dias_aluguel INTEGER NOT NULL,
  preco_final DECIMAL(12, 2) NOT NULL,
  status_pagamento status_pagamento NOT NULL DEFAULT 'PENDENTE',
  status_aluguel status_aluguel NOT NULL DEFAULT 'AGUARDANDO_ENTREGA',

  CONSTRAINT fk_alugueis_consumidor
    FOREIGN KEY (consumidor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_alugueis_cacambeiro
    FOREIGN KEY (cacambeiro_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_alugueis_endereco
    FOREIGN KEY (endereco_id) REFERENCES enderecos(id) ON DELETE RESTRICT,
  CONSTRAINT alugueis_dias_check CHECK (dias_aluguel >= 1 AND dias_aluguel <= 30)
);

-- Itens Aluguel
CREATE TABLE IF NOT EXISTS itens_aluguel (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aluguel_id UUID NOT NULL,
  cacamba_id UUID NOT NULL,
  quantidade INTEGER NOT NULL,
  dias_aluguel INTEGER NOT NULL,
  preco_diaria DECIMAL(10, 2) NOT NULL,

  CONSTRAINT fk_itens_aluguel_aluguel
    FOREIGN KEY (aluguel_id) REFERENCES alugueis(id) ON DELETE CASCADE,
  CONSTRAINT fk_itens_aluguel_cacamba
    FOREIGN KEY (cacamba_id) REFERENCES cacambas(id) ON DELETE RESTRICT
);

-- Avaliacoes
CREATE TABLE IF NOT EXISTS avaliacoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aluguel_id UUID NOT NULL,
  consumidor_id UUID NOT NULL,
  cacambeiro_id UUID NOT NULL,
  nota INTEGER NOT NULL,
  comentario VARCHAR(500),
  data_avaliacao TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_avaliacoes_aluguel
    FOREIGN KEY (aluguel_id) REFERENCES alugueis(id) ON DELETE CASCADE,
  CONSTRAINT fk_avaliacoes_consumidor
    FOREIGN KEY (consumidor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_avaliacoes_cacambeiro
    FOREIGN KEY (cacambeiro_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT avaliacoes_aluguel_unique UNIQUE (aluguel_id),
  CONSTRAINT avaliacoes_nota_check CHECK (nota >= 1 AND nota <= 5)
);

-- Categorias
CREATE TABLE IF NOT EXISTS categorias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(100) NOT NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT categorias_nome_unique UNIQUE (nome)
);

-- Token
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,

  CONSTRAINT fk_refresh_token_usuario
    FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id)
    ON DELETE CASCADE
);

--Recuperação de Senha
CREATE TABLE IF NOT EXISTS password_recovery_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,

  CONSTRAINT fk_password_recovery_usuario
    FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id)
    ON DELETE CASCADE
);

--Autenticação negada
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

--Login
CREATE TABLE IF NOT EXISTS login_attempts (
  ip VARCHAR(255) PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1,
  first_attempt BIGINT NOT NULL
);

-- Materiais recicláveis
CREATE TABLE IF NOT EXISTS materiais_reciclaveis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(100) NOT NULL,
  descricao TEXT,
  icone_url VARCHAR(500),
  tipos_aceitos TEXT[] NOT NULL DEFAULT '{}',
  tipos_nao_aceitos TEXT[] NOT NULL DEFAULT '{}',
  impacto_energia INTEGER NOT NULL DEFAULT 0,
  impacto_co2 INTEGER NOT NULL DEFAULT 0,
  tempo_decomposicao VARCHAR(50),
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT materiais_reciclaveis_nome_unique UNIQUE (nome)
);
CREATE INDEX IF NOT EXISTS idx_materiais_reciclaveis_nome
ON materiais_reciclaveis(nome);

-- Pagamentos PIX (cobranças criadas na AbacatePay)
CREATE TABLE IF NOT EXISTS pagamentos_pix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aluguel_id UUID NOT NULL,
  cobranca_id VARCHAR(100) NOT NULL,
  valor_centavos INTEGER NOT NULL CHECK (valor_centavos >= 100),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  copia_cola TEXT NOT NULL,
  qr_code_base64 TEXT,
  dev_mode BOOLEAN NOT NULL DEFAULT FALSE,
  expira_em TIMESTAMPTZ,
  pago_em TIMESTAMPTZ,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_pagamentos_pix_aluguel
    FOREIGN KEY (aluguel_id) REFERENCES alugueis(id) ON DELETE CASCADE,
  CONSTRAINT pagamentos_pix_cobranca_unique UNIQUE (cobranca_id)
);
CREATE INDEX IF NOT EXISTS idx_pagamentos_pix_aluguel
ON pagamentos_pix(aluguel_id, criado_em DESC);


-- ============================================
-- INDEXES
-- ============================================

-- Usuarios
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_tipo_perfil ON usuarios(tipo_perfil);
CREATE INDEX IF NOT EXISTS idx_usuarios_documento ON usuarios(documento);

-- Detalhes Cacambeiro
CREATE INDEX IF NOT EXISTS idx_detalhes_cacambeiro_usuario ON detalhes_cacambeiro(usuario_id);

-- Cacambas
CREATE INDEX IF NOT EXISTS idx_cacambas_cacambeiro ON cacambas(cacambeiro_id);
CREATE INDEX IF NOT EXISTS idx_cacambas_disponivel ON cacambas(disponivel);
CREATE INDEX IF NOT EXISTS idx_cacambas_tipo_residuo ON cacambas(tipo_residuo);
CREATE INDEX IF NOT EXISTS idx_cacambas_criado_em ON cacambas(criado_em DESC);

-- Enderecos
CREATE INDEX IF NOT EXISTS idx_enderecos_usuario ON enderecos(usuario_id);

-- Carrinho
CREATE INDEX IF NOT EXISTS idx_carrinho_consumidor ON carrinho(consumidor_id);

-- Itens Carrinho
CREATE INDEX IF NOT EXISTS idx_itens_carrinho_carrinho ON itens_carrinho(carrinho_id);
CREATE INDEX IF NOT EXISTS idx_itens_carrinho_cacamba ON itens_carrinho(cacamba_id);

-- Alugueis
CREATE INDEX IF NOT EXISTS idx_alugueis_consumidor ON alugueis(consumidor_id);
CREATE INDEX IF NOT EXISTS idx_alugueis_cacambeiro ON alugueis(cacambeiro_id);
CREATE INDEX IF NOT EXISTS idx_alugueis_status_aluguel ON alugueis(status_aluguel);
CREATE INDEX IF NOT EXISTS idx_alugueis_status_pagamento ON alugueis(status_pagamento);
CREATE INDEX IF NOT EXISTS idx_alugueis_data_pedido ON alugueis(data_pedido DESC);
CREATE INDEX IF NOT EXISTS idx_alugueis_data_inicio ON alugueis(data_inicio);

-- Itens Aluguel
CREATE INDEX IF NOT EXISTS idx_itens_aluguel_aluguel ON itens_aluguel(aluguel_id);
CREATE INDEX IF NOT EXISTS idx_itens_aluguel_cacamba ON itens_aluguel(cacamba_id);

-- Avaliacoes
CREATE INDEX IF NOT EXISTS idx_avaliacoes_aluguel ON avaliacoes(aluguel_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_cacambeiro ON avaliacoes(cacambeiro_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_consumidor ON avaliacoes(consumidor_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_data ON avaliacoes(data_avaliacao DESC);

-- Categorias
CREATE INDEX IF NOT EXISTS idx_categorias_nome ON categorias(nome);

-- ============================================
-- PARCEIROS DE RECICLAGEM E COLETAS
-- ============================================

-- Detalhes Parceiro de Reciclagem
CREATE TABLE IF NOT EXISTS detalhes_parceiro (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL,
  capacidade_diaria_kg DECIMAL(10, 2) NOT NULL,
  materiais_aceitos TEXT NOT NULL,
  endereco_coleta VARCHAR(255) NOT NULL,
  disponivel BOOLEAN NOT NULL DEFAULT TRUE,

  CONSTRAINT fk_detalhes_parceiro_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT detalhes_parceiro_usuario_unique UNIQUE (usuario_id)
);

-- Coletas Agendadas
CREATE TABLE IF NOT EXISTS coletas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  consumidor_id UUID NOT NULL,
  parceiro_id UUID NOT NULL,
  endereco_id UUID NOT NULL,
  materiais TEXT NOT NULL,
  data_agendada TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
  criado_em TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_coletas_consumidor
    FOREIGN KEY (consumidor_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_coletas_parceiro
    FOREIGN KEY (parceiro_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_coletas_endereco
    FOREIGN KEY (endereco_id) REFERENCES enderecos(id) ON DELETE RESTRICT
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_detalhes_parceiro_usuario ON detalhes_parceiro(usuario_id);
CREATE INDEX IF NOT EXISTS idx_coletas_consumidor ON coletas(consumidor_id);
CREATE INDEX IF NOT EXISTS idx_coletas_parceiro ON coletas(parceiro_id);
CREATE INDEX IF NOT EXISTS idx_coletas_data ON coletas(data_agendada);
