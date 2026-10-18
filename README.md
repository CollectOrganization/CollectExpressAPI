```markdown
# CollectExpress — API

A API do **CollectExpress** é o backend responsável por orquestrar o marketplace de locação de caçambas.

Ela fornece endpoints para gerenciamento de perfis, autenticação, catálogo de caçambas, carrinho, endereços, processamento de aluguéis, avaliações e relatórios administrativos.

## Tecnologias utilizadas

- **Node.js e Express:** ambiente de execução e framework HTTP;
- **PostgreSQL e NeonDB:** banco de dados relacional em nuvem;
- **Neon Serverless SQL:** driver baseado em tagged templates e queries parametrizadas;
- **JWT:** autenticação baseada em tokens;
- **bcryptjs:** geração de hash seguro das senhas;
- **dotenv:** gerenciamento de variáveis de ambiente;
- **express-rate-limit:** limitação de requisições;
- **Jest:** testes automatizados;
- **Nodemon:** reinicialização automática em desenvolvimento.

## Funcionalidades

- Cadastro e autenticação de usuários;
- Controle de acesso por perfil;
- Recuperação e alteração de senha;
- Revogação de tokens no logout;
- Cadastro e gerenciamento de caçambas;
- Filtros e paginação do catálogo;
- Carrinho de locação;
- Gerenciamento de endereços;
- Checkout e criação de pedidos;
- Histórico e acompanhamento de pedidos;
- Gestão de pedidos por fornecedores;
- Avaliação dos fornecedores;
- Dashboard administrativo;
- Dashboard e relatório financeiro dos fornecedores;
- Gerenciamento administrativo de usuários e categorias.

## Perfis de usuário

| Perfil | Descrição |
|---|---|
| `CONSUMIDOR` | Pesquisa e aluga caçambas, gerencia endereços e acompanha pedidos |
| `CACAMBEIRO` | Cadastra caçambas e gerencia suas locações |
| `ADMIN` | Gerencia usuários, categorias, pedidos e relatórios |

> O backend para parceiros de reciclagem ainda está em desenvolvimento.

## Requisitos

- Node.js 20 ou superior;
- npm;
- Banco PostgreSQL ou NeonDB;
- Git.

Confira as versões:

```bash
node --version
npm --version
git --version
```

## Instalação

Clone o repositório:

```bash
git clone https://github.com/SEU-USUARIO/CollectExpressAPI.git
cd CollectExpressAPI
```

Instale as dependências:

```bash
npm install
```

## Variáveis de ambiente

Crie um arquivo `.env` na raiz:

```env
DATABASE_URL=postgresql://usuario:senha@host/banco?sslmode=require
JWT_SECRET=adicione-um-segredo-seguro
JWT_EXPIRES_IN=1h
PORT=3001
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

O arquivo `.env` não deve ser enviado ao GitHub.

Crie também um `.env.example`:

```env
DATABASE_URL=
JWT_SECRET=
JWT_EXPIRES_IN=1h
PORT=3001
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
```

Confirme o `.gitignore`:

```gitignore
node_modules/
.env
.env.*
!.env.example
coverage/
.DS_Store
.claude/
.vscode/
.kiro/
```

## Banco de dados

O schema principal está localizado em:

```text
src/config/schema.sql
```

Execute o schema no banco PostgreSQL ou no SQL Editor do NeonDB.

Depois execute as migrations auxiliares:

```bash
npm run migrate
```

### Extensões utilizadas

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
```

### Popular o banco

```bash
npm run seed
```

> Atenção: o seed apaga os dados atuais e recria os dados acadêmicos de desenvolvimento.

### Verificar o banco

```bash
npm run db:check
```

## Executar a API

### Desenvolvimento

```bash
npm run dev
```

### Produção

```bash
npm start
```

Por padrão, a API estará disponível em:

```text
http://localhost:3001
```

Endpoint raiz:

```http
GET /
```

Health check:

```http
GET /api/health
```

Exemplo:

```bash
curl http://localhost:3001/api/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "message": "API de Caçambas operando normalmente! 🚀",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## Scripts disponíveis

| Comando | Descrição |
|---|---|
| `npm start` | Inicia a API |
| `npm run dev` | Inicia a API com Nodemon |
| `npm run migrate` | Executa migrations auxiliares |
| `npm run seed` | Recria os dados acadêmicos |
| `npm run db:check` | Verifica registros do banco |
| `npm test` | Executa os testes |
| `npm run test:watch` | Executa os testes em modo contínuo |

## Credenciais de desenvolvimento

Todos os usuários gerados pelo seed utilizam a senha:

```text
123456
```

### Administrador

```text
E-mail: admin@collectexpress.com
Senha: 123456
Perfil: ADMIN
```

### Fornecedores

```text
E-mail: silva@cacambas.com
Senha: 123456
Perfil: CACAMBEIRO
```

```text
E-mail: contato@entulhorapido.com
Senha: 123456
Perfil: CACAMBEIRO
```

### Consumidores

```text
E-mail: joao@construtor.com
Senha: 123456
Perfil: CONSUMIDOR
```

```text
E-mail: maria@reformas.com
Senha: 123456
Perfil: CONSUMIDOR
```

> Essas credenciais são exclusivamente para desenvolvimento e testes acadêmicos.

## Autenticação

### Login

```http
POST /api/auth/login
Content-Type: application/json
```

Body:

```json
{
  "email": "joao@construtor.com",
  "senha": "123456"
}
```

Resposta:

```json
{
  "token": "jwt-token",
  "usuario": {
    "id": "uuid",
    "nome_completo": "João Construtor",
    "email": "joao@construtor.com",
    "tipo_perfil": "CONSUMIDOR"
  }
}
```

Para acessar uma rota protegida, envie:

```http
Authorization: Bearer jwt-token
```

Exemplo:

```bash
curl http://localhost:3001/api/usuarios/perfil \
  -H "Authorization: Bearer SEU_TOKEN"
```

## Política de senha

Novos cadastros devem usar uma senha com:

- no mínimo 8 caracteres;
- pelo menos uma letra maiúscula;
- pelo menos uma letra minúscula;
- pelo menos um número.

A senha `123456` é utilizada somente pelos dados acadêmicos do seed.

## Endpoints

### Autenticação

| Método | Endpoint | Acesso |
|---|---|---|
| `POST` | `/api/auth/register` | Público |
| `POST` | `/api/auth/login` | Público |
| `POST` | `/api/auth/logout` | Autenticado |
| `POST` | `/api/auth/forgot-password` | Público |
| `POST` | `/api/auth/reset-password` | Público |

### Usuários

| Método | Endpoint | Acesso |
|---|---|---|
| `GET` | `/api/usuarios/perfil` | Autenticado |
| `PUT` | `/api/usuarios/perfil` | Autenticado |
| `GET` | `/api/usuarios` | `ADMIN` |
| `GET` | `/api/usuarios/:id` | `ADMIN` |
| `POST` | `/api/usuarios` | `ADMIN` |

### Caçambas

| Método | Endpoint | Acesso |
|---|---|---|
| `GET` | `/api/cacambas` | Público |
| `GET` | `/api/cacambas/:id` | Público |
| `GET` | `/api/cacambas/minhas` | `CACAMBEIRO` |
| `POST` | `/api/cacambas` | `CACAMBEIRO` |
| `PUT` | `/api/cacambas/:id` | Proprietário |
| `DELETE` | `/api/cacambas/:id` | Proprietário |

Filtros disponíveis:

```text
GET /api/cacambas?page=1
GET /api/cacambas?tipo_residuo=Entulho%20de%20Obra
GET /api/cacambas?cacambeiro_id=UUID
GET /api/cacambas?search=standard
```

### Fornecedores

| Método | Endpoint | Acesso |
|---|---|---|
| `GET` | `/api/cacambeiros` | Público |
| `GET` | `/api/cacambeiros/:id` | Público |
| `GET` | `/api/cacambeiros/:id/avaliacoes` | Público |
| `GET` | `/api/cacambeiros/dashboard` | `CACAMBEIRO` |
| `GET` | `/api/cacambeiros/financeiro` | `CACAMBEIRO` |

### Carrinho

| Método | Endpoint | Acesso |
|---|---|---|
| `GET` | `/api/carrinho` | `CONSUMIDOR` |
| `POST` | `/api/carrinho/itens` | `CONSUMIDOR` |
| `PUT` | `/api/carrinho/itens/:id` | `CONSUMIDOR` |
| `DELETE` | `/api/carrinho/itens/:id` | `CONSUMIDOR` |
| `DELETE` | `/api/carrinho` | `CONSUMIDOR` |

### Endereços

| Método | Endpoint | Acesso |
|---|---|---|
| `GET` | `/api/enderecos` | Autenticado |
| `POST` | `/api/enderecos` | Autenticado |
| `DELETE` | `/api/enderecos/:id` | Proprietário |

### Pedidos e aluguéis

| Método | Endpoint | Acesso |
|---|---|---|
| `POST` | `/api/alugueis/checkout` | `CONSUMIDOR` |
| `GET` | `/api/alugueis/meus` | `CONSUMIDOR` |
| `GET` | `/api/alugueis/gestao` | `CACAMBEIRO` |
| `PATCH` | `/api/alugueis/:id/status` | `CACAMBEIRO` |
| `GET` | `/api/alugueis` | `ADMIN` |

### Avaliações

| Método | Endpoint | Acesso |
|---|---|---|
| `POST` | `/api/avaliacoes` | `CONSUMIDOR` |
| `GET` | `/api/avaliacoes/cacambeiro/:id` | Público |

### Administração

| Método | Endpoint | Acesso |
|---|---|---|
| `GET` | `/api/admin/dashboard` | `ADMIN` |
| `GET` | `/api/admin/categorias` | `ADMIN` |
| `POST` | `/api/admin/categorias` | `ADMIN` |
| `PUT` | `/api/admin/categorias/:id` | `ADMIN` |
| `DELETE` | `/api/admin/categorias/:id` | `ADMIN` |

## Status de aluguel

Os pedidos seguem uma sequência obrigatória:

```text
AGUARDANDO_ENTREGA
        ↓
EM_USO
        ↓
AGUARDANDO_RETIRADA
        ↓
FINALIZADO
```

Não é permitido pular etapas nem alterar um pedido já finalizado.

## Status de pagamento

```text
PENDENTE
PAGO
```

## Paginação

Endpoints paginados retornam:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "totalPages": 0
}
```

O limite atual é de 20 registros por página.

## Respostas de erro

Erro simples:

```json
{
  "error": "Mensagem do erro"
}
```

Erro de validação:

```json
{
  "errors": [
    {
      "campo": "email",
      "mensagem": "O campo 'email' deve ser um email válido"
    }
  ]
}
```

Erro de campos:

```json
{
  "error": "Campos inválidos.",
  "fields": {
    "cep": "CEP deve conter exatamente 8 dígitos numéricos."
  }
}
```

## Códigos HTTP utilizados

| Código | Significado |
|---|---|
| `200` | Operação realizada |
| `201` | Recurso criado |
| `400` | Dados inválidos |
| `401` | Não autenticado |
| `403` | Sem permissão |
| `404` | Recurso não encontrado |
| `409` | Registro duplicado |
| `429` | Muitas requisições |
| `500` | Erro interno |

## Testes rápidos

Defina a URL:

```bash
export API_URL="http://localhost:3001/api"
```

### Health check

```bash
curl -s "$API_URL/health"
```

### Login do consumidor

```bash
CONSUMER_RESPONSE=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "joao@construtor.com",
    "senha": "123456"
  }')

echo "$CONSUMER_RESPONSE"
```

### Salvar o token

Com `jq` instalado:

```bash
CONSUMER_TOKEN=$(echo "$CONSUMER_RESPONSE" | jq -r '.token')
```

### Consultar perfil

```bash
curl -s "$API_URL/usuarios/perfil" \
  -H "Authorization: Bearer $CONSUMER_TOKEN"
```

### Listar caçambas

```bash
curl -s "$API_URL/cacambas"
```

### Testar autorização

Um consumidor não deve acessar o dashboard administrativo:

```bash
curl -i "$API_URL/admin/dashboard" \
  -H "Authorization: Bearer $CONSUMER_TOKEN"
```

Resposta esperada:

```text
HTTP/1.1 403 Forbidden
```

## Testes automatizados

Execute:

```bash
npm test
```

Para modo contínuo:

```bash
npm run test:watch
```

Não execute automaticamente:

```bash
npm audit fix --force
```

Analise as alterações antes de atualizar dependências com breaking changes.

## GitHub Codespaces

Utilize portas diferentes:

```text
Flutter Web: 3000
API: 3001
```

Na aba **Ports**, encaminhe a porta `3001` da API.

Durante o desenvolvimento, o CORS deve permitir:

- `http://localhost:3000`;
- `http://localhost:8081`;
- IPs locais `192.168.x.x`;
- URLs do GitHub Codespaces terminadas em `.app.github.dev`.

## Estrutura do projeto

```text
CollectExpressAPI/
├── src/
│   ├── config/
│   │   ├── db.js
│   │   └── schema.sql
│   ├── controllers/
│   │   ├── adminController.js
│   │   ├── alugueisController.js
│   │   ├── authController.js
│   │   ├── avaliacoesController.js
│   │   ├── cacambasController.js
│   │   ├── cacambeirosController.js
│   │   ├── carrinhoController.js
│   │   ├── enderecosController.js
│   │   └── usuariosController.js
│   ├── middlewares/
│   │   ├── authMiddleware.js
│   │   ├── rateLimitMiddleware.js
│   │   ├── roleMiddleware.js
│   │   └── validationMiddleware.js
│   ├── routes/
│   ├── scripts/
│   │   ├── createMigrations.js
│   │   ├── hardeningMigration.js
│   │   ├── checkDatabase.js
│   │   └── seed.js
│   └── server.js
├── test/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Segurança

A API implementa:

- hash de senhas com bcrypt;
- autenticação JWT;
- expiração configurável do token;
- autorização por perfil;
- rate limit global;
- bloqueio temporário após tentativas de login;
- blacklist de tokens no logout;
- queries parametrizadas;
- validação de entrada;
- isolamento de recursos por proprietário;
- mascaramento de documentos em consultas administrativas.

Nunca publique:

- `.env`;
- `DATABASE_URL`;
- `JWT_SECRET`;
- tokens JWT;
- credenciais de produção;
- dados pessoais reais.

## Funcionalidades pendentes

- refresh token;
- persistência dos tokens de recuperação;
- envio de recuperação de senha por e-mail;
- upload de imagens;
- gateway de pagamento;
- transação atômica no checkout;
- complemento e endereço padrão;
- perfil de parceiro de reciclagem;
- materiais recicláveis;
- preços por quilograma;
- agendamento de coletas recicláveis;
- cadastro administrativo por convite;
- suíte completa de testes automatizados.

## Integração com Flutter

A aplicação Flutter deve utilizar:

```text
API_BASE_URL=http://localhost:3001/api
```

No Codespaces ou em produção, substitua pela URL pública da API.

O fluxo de autenticação esperado é:

```text
POST /api/auth/login
        ↓
Salvar token JWT
        ↓
Identificar tipo_perfil
        ↓
CONSUMIDOR → aplicação do cliente
CACAMBEIRO → painel do fornecedor
ADMIN → painel administrativo
```

## Licença

Projeto acadêmico desenvolvido para fins de estudo e demonstração.
```

Depois salve e faça o commit:

```bash
git add README.md .env.example
git commit -m "Atualiza documentação completa da API"
```