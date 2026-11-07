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
ABACATEPAY_API_KEY=chave-da-abacatepay
```

O arquivo `.env` não deve ser enviado ao GitHub.

`ABACATEPAY_API_KEY` é a chave da AbacatePay usada no pagamento por PIX (veja [Pagamento por PIX](#pagamento-por-pix)). Sem ela, a API funciona normalmente, mas as rotas de PIX respondem `503`.

Crie também um `.env.example`:

```env
DATABASE_URL=
JWT_SECRET=
JWT_EXPIRES_IN=1h
PORT=3001
FRONTEND_URL=http://localhost:3000
NODE_ENV=development
ABACATEPAY_API_KEY=
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
| `npm run migrate:pix` | Cria a tabela `pagamentos_pix` |
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
| `POST` | `/api/alugueis/:id/pix` | `CONSUMIDOR` (dono do pedido) |
| `GET` | `/api/alugueis/:id/pix` | `CONSUMIDOR` (dono do pedido) |
| `POST` | `/api/alugueis/:id/pix/simular` | `CONSUMIDOR` (dono do pedido), só no modo de teste |

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

## Pagamento por PIX

O pagamento usa o Checkout Transparente da [AbacatePay](https://docs.abacatepay.com/pages/transparents/reference).

1. Crie a tabela com `npm run migrate:pix`.
2. Crie uma conta na AbacatePay. Ela começa no modo de teste, em que nada é cobrado de verdade.
3. No painel, em **Integração**, crie uma chave com as permissões `TRANSPARENT:CREATE` e `TRANSPARENT:READ`.
4. Coloque a chave em `ABACATEPAY_API_KEY` no `.env` (e nas variáveis do Render).

Fluxo:

- `POST /api/alugueis/:id/pix` gera a cobrança e devolve o código copia e cola (`copia_cola`) e o QR Code (`qr_code_base64`). Se já existe um PIX pendente válido para o pedido, devolve o mesmo. Cada PIX vale por 1 hora.
- `GET /api/alugueis/:id/pix` consulta a cobrança na AbacatePay. Quando ela foi paga, o pedido passa para `PAGO`. O app chama esta rota a cada poucos segundos enquanto espera.
- `POST /api/alugueis/:id/pix/simular` simula o pagamento. Só funciona quando a cobrança foi criada com a chave do modo de teste (`dev_mode: true`); com a chave de produção responde `403`.

Exemplo de resposta:

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "aluguel_id": "uuid",
    "status": "PENDING",
    "status_pagamento": "PENDENTE",
    "valor": 450,
    "copia_cola": "00020101021226...",
    "qr_code_base64": "data:image/png;base64,iVBOR...",
    "dev_mode": true,
    "expira_em": "2026-10-27T18:00:00.000Z",
    "pago_em": null
  }
}
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

## Contratos, e-mails, fotos e extensão de aluguel

### Antes de subir esta versão

Rode as migrações (são aditivas e podem ser repetidas) **antes** de publicar o código:

```bash
npm run migrate:contratos   # assinatura da empresa + tabela contratos_locacao
npm run migrate:extensoes   # permite_extensao, dias_extra/valor_extra, extensoes_aluguel, pagamentos_pix.extensao_id
```

O checkout agora **exige** `aceite_termos: true` e `assinatura_base64` (PNG). O app Flutter e a API
devem ser publicados juntos; versões antigas do app deixam de conseguir criar pedidos.

### Variáveis novas

Veja `.env.example`. As principais: `PUBLIC_API_URL`, `UPLOADS_DIR`, `BREVO_API_KEY`, `EMAIL_FROM`, `JOBS_SECRET`.

### Arquivos enviados

Ficam em `storage/` (ou `UPLOADS_DIR`):

| Pasta | Conteúdo | Acesso |
|---|---|---|
| `storage/public/cacambas` | fotos das caçambas | público, em `/uploads/cacambas/...` |
| `storage/private/assinaturas` | assinaturas da empresa e do consumidor | só por rotas autenticadas |
| `storage/private/contratos` | PDFs dos contratos | só por rotas autenticadas (não versionado) |

O disco do Render gratuito é apagado a cada deploy. O que for enviado em produção só permanece
se for baixado e commitado. Os PDFs são regerados do banco quando o arquivo some.

### Rotas novas

| Rota | Perfil | Descrição |
|---|---|---|
| `POST/PUT /api/cacambas` | CACAMBEIRO | aceita `foto_base64`, `remover_foto`, `permite_extensao` |
| `GET/PUT/DELETE /api/cacambeiros/me/assinatura` | CACAMBEIRO | assinatura padrão da empresa (PNG 3:1, 300x100 a 1200x400 px, até 300 KB) |
| `POST /api/alugueis/checkout` | CONSUMIDOR | agora com `aceite_termos` e `assinatura_base64` |
| `GET /api/alugueis/:id/contrato` | dono do pedido / ADMIN | PDF do contrato |
| `GET/POST /api/alugueis/:id/extensoes` | CONSUMIDOR | lista e solicita extensão |
| `PATCH /api/alugueis/:id/extensoes/:extId` | CACAMBEIRO | `{ "acao": "ACEITAR" \| "RECUSAR" }` |
| `POST/GET /api/alugueis/:id/extensoes/:extId/pix` | CONSUMIDOR | PIX da extensão (24 h após o aceite) |
| `GET/POST /api/extensoes/resposta/:token` | link do e-mail | caçambeiro responde sem login |
| `POST /api/internal/jobs/extensoes` | cron (`x-jobs-secret`) | expira prazos vencidos |

### E-mail

O envio usa a API HTTPS do Brevo (plano gratuito), sem SMTP. Passos:

1. Crie a conta no Brevo e gere uma chave em *SMTP & API > API Keys*.
2. Em *Senders*, cadastre e verifique o remetente (`EMAIL_FROM`).
3. Defina `BREVO_API_KEY` e `EMAIL_FROM` no ambiente.

Sem `BREVO_API_KEY` o sistema só registra os e-mails no log (driver `console`).
E-mails são enviados no pedido criado (com o contrato em PDF), pagamento, entrega, retirada,
finalização e em cada passo da extensão. Uma falha de envio nunca derruba a operação.

### Prazos de extensão

- O caçambeiro tem 48 h para responder; depois disso o pedido expira.
- Aceita a extensão, o consumidor tem 24 h para pagar; depois disso a renovação é cancelada.
- O Render gratuito hiberna, então os prazos também são conferidos ao consultar o pedido.
  Para garantir os e-mails de cancelamento, agende um cron gratuito (ex.: cron-job.org) a cada
  15 minutos chamando `POST /api/internal/jobs/extensoes` com o header `x-jobs-secret`.

## Área de atendimento (cerca virtual)

Cada caçambeiro marca no mapa um círculo (centro + raio de 1 a 200 km). O catálogo só mostra ao cliente
as caçambas de quem atende o endereço dele, e o checkout confere de novo no servidor. Tudo usa serviços
gratuitos: mapa do OpenStreetMap no app, CEP pela BrasilAPI/ViaCEP e busca de endereço pelo Nominatim.

### Antes de subir esta versão

```bash
npm run migrate:area   # centro_lat/centro_lng em detalhes_cacambeiro, coordenadas em enderecos, raio opcional
```

A migração é aditiva e pode ser repetida. O raio deixou de ser obrigatório no cadastro de fornecedor.

### Regras

- Caçambeiro que ainda não definiu a área atende todo mundo (período de transição).
- `GET /api/cacambas?latitude=&longitude=&area=dentro|fora|todas`: com coordenadas o padrão é `dentro`.
  Cada item traz `dentro_da_area`, `distancia_km` e `area_definida`. Sem coordenadas não há filtro.
  Coordenadas inválidas ou só uma delas: `400 INVALID_LOCATION`.
- `GET /api/cacambas/:id?latitude=&longitude=` devolve as mesmas indicações.
- Endereços do cliente são geocodificados ao salvar. Endereços antigos são localizados no checkout.
- Checkout fora da área: `422 OUT_OF_SERVICE_AREA`. Endereço que não foi possível localizar: `422 ADDRESS_NOT_LOCATED`.

### Rotas novas

| Rota | Perfil | Descrição |
|---|---|---|
| `GET /api/localizacao/cep/:cep` | público (20 req/min) | endereço e coordenadas do CEP (`INVALID_CEP`, `CEP_NOT_FOUND`, `GEOCODING_UNAVAILABLE`) |
| `GET/PUT /api/cacambeiros/me/area` | CACAMBEIRO | cerca atual / salvar `{ latitude, longitude, raio_km }` |
| `GET /api/cacambeiros/me/pendencias` | CACAMBEIRO | `pendencias`: `AREA_ATENDIMENTO` e/ou `ASSINATURA` (o app avisa ao entrar) |

### Limites dos serviços gratuitos

O Nominatim permite 1 requisição por segundo e exige identificação: defina `GEOCODING_CONTACT` (e-mail ou site; se vazio, usa `EMAIL_FROM`).
Respostas ficam em cache por 12 h. Os mapas públicos do OpenStreetMap são para uso leve; para muito tráfego,
troque a URL dos tiles no app por um provedor próprio.

## Chat entre cliente, caçambeiro e equipe

Chat só de texto (até 1.000 caracteres) que substitui o contato por telefone. O telefone deixou de ser
devolvido nas respostas de caçambas, fornecedores e pedidos; ele continua só no cadastro e na gestão de usuários do admin.

### Antes de subir esta versão

```bash
npm run migrate:chat   # conversas, mensagens, denuncias_chat e chat_acessos_admin
```

A migração é aditiva e pode ser repetida. Ela já cria a conversa dos pedidos em andamento.

### Tipos de conversa

| Tipo | Partes | Regra |
|---|---|---|
| `PEDIDO` | cliente x caçambeiro | uma por pedido, criada no checkout; segue aberta por 7 dias depois do pedido finalizado e então vira só leitura |
| `SUPORTE_CACAMBEIRO` | caçambeiro x equipe | uma por caçambeiro, livre, com histórico |
| `CHAMADO` | cliente x equipe | aberto pelo cliente (um por vez, com pedido opcional) e fechado por um admin; não há reabertura |

A equipe é compartilhada: qualquer admin lê e responde, e a mensagem conta como lida para todos quando um deles abre a
conversa. Nas conversas de `PEDIDO` o admin só lê (`ADMIN_READ_ONLY`) e cada abertura fica em `chat_acessos_admin`.

### Rotas (`/api/chat`, todas autenticadas)

| Rota | Perfil | Descrição |
|---|---|---|
| `GET /conversas?tipo=&status=&denunciadas=&busca=&page=` | todos | lista com última mensagem e `nao_lidas`; `denunciadas` e `busca` só para admin |
| `GET /nao-lidas` | todos | `{ conversas, mensagens }` para as bolhas |
| `GET /conversas/:id` | participantes e admin | detalhe, com o resumo do pedido vinculado (sem telefone) |
| `GET /conversas/:id/mensagens?depois=&antes=&limite=` | participantes e admin | abrir marca como lidas as mensagens do outro lado |
| `POST /conversas/:id/mensagens` | participantes | `{ texto }`; limite de 30 por minuto por usuário |
| `POST /pedidos/:id/conversa` | cliente, caçambeiro, admin | abre (ou cria) a conversa do pedido |
| `POST /chamados` | CONSUMIDOR | `{ assunto, mensagem, aluguel_id? }`; `409 CHAMADO_ALREADY_OPEN` se já houver um aberto |
| `PATCH /chamados/:id/fechar` | ADMIN | encerra o chamado |
| `POST /conversas/:id/denunciar` | participantes | `{ motivo? }`; avisa todos os admins por e-mail; uma por usuário a cada 24 h |
| `PATCH /conversas/:id/denuncia` | ADMIN | marca a denúncia como analisada |
| `POST /api/internal/jobs/chat` | cron (`x-jobs-secret`) | envia os avisos de mensagens sem leitura |

Quem não participa recebe `404 CONVERSATION_NOT_FOUND`, igual a uma conversa que não existe.

### Aviso por e-mail

Mensagem sem leitura há mais de 8 horas gera um e-mail para o destinatário (para a equipe, todos os admins ativos):

- um e-mail por pessoa em cada rodada, listando as conversas;
- só avisa de novo depois que a pessoa lê tudo e chega mensagem nova;
- o e-mail não leva o texto das mensagens;
- chamado fechado não gera aviso para a equipe, e contas suspensas não recebem.

A API confere sozinha a cada 15 minutos enquanto está acordada. No Render gratuito, que hiberna, agende um cron
(ex.: cron-job.org) a cada 15 minutos em `POST /api/internal/jobs/chat` com o header `x-jobs-secret`, como já é feito
para as extensões. Denúncias avisam os admins na hora.