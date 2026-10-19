jest.mock("../src/config/db", () => jest.fn());

const sql = require("../src/config/db");
const enderecosController = require(
  "../src/controllers/enderecosController",
);

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("enderecosController", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listar", () => {
    test("lista os endereços do usuário autenticado", async () => {
      const enderecos = [
        {
          id: "endereco-1",
          cep: "01311000",
          logradouro: "Avenida Paulista",
          numero: "1000",
          bairro: "Bela Vista",
          cidade_estado: "São Paulo - SP",
        },
      ];

      sql.mockResolvedValueOnce(enderecos);

      const req = {
        usuario_id: "usuario-1",
      };

      const res = createResponse();

      await enderecosController.listar(req, res);

      expect(sql).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Endereços encontrados com sucesso.",
        data: enderecos,
      });
    });

    test("retorna lista vazia quando não há endereços", async () => {
      sql.mockResolvedValueOnce([]);

      const req = {
        usuario_id: "usuario-1",
      };

      const res = createResponse();

      await enderecosController.listar(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Endereços encontrados com sucesso.",
        data: [],
      });
    });

    test("retorna 500 quando ocorre erro no banco", async () => {
      sql.mockRejectedValueOnce(new Error("Database error"));

      const req = {
        usuario_id: "usuario-1",
      };

      const res = createResponse();

      await enderecosController.listar(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Erro interno ao buscar endereços.",
        code: "INTERNAL_SERVER_ERROR",
      });
    });
  });

  describe("criar", () => {
    test("cria um endereço com dados normalizados", async () => {
      const enderecoCriado = {
        id: "endereco-1",
        cep: "01311000",
        logradouro: "Avenida Paulista",
        numero: "1000",
        bairro: "Bela Vista",
        cidade_estado: "São Paulo - SP",
      };

      // Primeira consulta: quantidade atual de endereços.
      sql.mockResolvedValueOnce([{ total: 2 }]);

      // Segunda consulta: INSERT do endereço.
      sql.mockResolvedValueOnce([enderecoCriado]);

      const req = {
        usuario_id: "usuario-1",
        body: {
          cep: "01311000",
          logradouro: "  Avenida Paulista  ",
          numero: "  1000  ",
          bairro: "  Bela Vista  ",
          cidade_estado: "  São Paulo - SP  ",
        },
      };

      const res = createResponse();

      await enderecosController.criar(req, res);

      expect(sql).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Endereço cadastrado com sucesso.",
        data: enderecoCriado,
      });
    });

    test("bloqueia criação ao atingir 10 endereços", async () => {
      sql.mockResolvedValueOnce([{ total: 10 }]);

      const req = {
        usuario_id: "usuario-1",
        body: {
          cep: "01311000",
          logradouro: "Avenida Paulista",
          numero: "1000",
          bairro: "Bela Vista",
          cidade_estado: "São Paulo - SP",
        },
      };

      const res = createResponse();

      await enderecosController.criar(req, res);

      expect(sql).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Limite de 10 endereços atingido.",
        code: "ADDRESS_LIMIT_REACHED",
      });
    });

    test("retorna 500 quando o INSERT falha", async () => {
      sql
        .mockResolvedValueOnce([{ total: 1 }])
        .mockRejectedValueOnce(new Error("Insert error"));

      const req = {
        usuario_id: "usuario-1",
        body: {
          cep: "01311000",
          logradouro: "Avenida Paulista",
          numero: "1000",
          bairro: "Bela Vista",
          cidade_estado: "São Paulo - SP",
        },
      };

      const res = createResponse();

      await enderecosController.criar(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Erro interno ao salvar o endereço.",
        code: "INTERNAL_SERVER_ERROR",
      });
    });
  });

  describe("remover", () => {
    test("retorna 404 quando o endereço não pertence ao usuário", async () => {
      sql.mockResolvedValueOnce([]);

      const req = {
        usuario_id: "usuario-1",
        params: {
          id: "endereco-outro-usuario",
        },
      };

      const res = createResponse();

      await enderecosController.remover(req, res);

      expect(sql).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Endereço não encontrado.",
        code: "ADDRESS_NOT_FOUND",
      });
    });

    test("bloqueia endereço com pedidos ativos", async () => {
      sql
        .mockResolvedValueOnce([{ id: "endereco-1" }])
        .mockResolvedValueOnce([
          {
            total: 2,
            ativos: 1,
          },
        ]);

      const req = {
        usuario_id: "usuario-1",
        params: {
          id: "endereco-1",
        },
      };

      const res = createResponse();

      await enderecosController.remover(req, res);

      expect(sql).toHaveBeenCalledTimes(2);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message:
          "Não é possível remover este endereço porque existem pedidos ativos vinculados.",
        code: "ADDRESS_HAS_ACTIVE_ORDERS",
      });
    });

    test("bloqueia endereço presente no histórico", async () => {
      sql
        .mockResolvedValueOnce([{ id: "endereco-1" }])
        .mockResolvedValueOnce([
          {
            total: 2,
            ativos: 0,
          },
        ]);

      const req = {
        usuario_id: "usuario-1",
        params: {
          id: "endereco-1",
        },
      };

      const res = createResponse();

      await enderecosController.remover(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message:
          "Não é possível remover este endereço porque ele faz parte do histórico de pedidos.",
        code: "ADDRESS_HAS_ORDER_HISTORY",
      });
    });

    test("remove endereço sem pedidos vinculados", async () => {
      sql
        .mockResolvedValueOnce([{ id: "endereco-1" }])
        .mockResolvedValueOnce([
          {
            total: 0,
            ativos: 0,
          },
        ])
        .mockResolvedValueOnce([{ id: "endereco-1" }]);

      const req = {
        usuario_id: "usuario-1",
        params: {
          id: "endereco-1",
        },
      };

      const res = createResponse();

      await enderecosController.remover(req, res);

      expect(sql).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: "Endereço removido com sucesso.",
        data: null,
      });
    });

    test("retorna 404 se o endereço desaparecer antes do DELETE", async () => {
      sql
        .mockResolvedValueOnce([{ id: "endereco-1" }])
        .mockResolvedValueOnce([
          {
            total: 0,
            ativos: 0,
          },
        ])
        .mockResolvedValueOnce([]);

      const req = {
        usuario_id: "usuario-1",
        params: {
          id: "endereco-1",
        },
      };

      const res = createResponse();

      await enderecosController.remover(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Endereço não encontrado.",
        code: "ADDRESS_NOT_FOUND",
      });
    });

    test("trata violação de chave estrangeira", async () => {
      const databaseError = new Error("Foreign key violation");
      databaseError.code = "23503";

      sql
        .mockResolvedValueOnce([{ id: "endereco-1" }])
        .mockResolvedValueOnce([
          {
            total: 0,
            ativos: 0,
          },
        ])
        .mockRejectedValueOnce(databaseError);

      const req = {
        usuario_id: "usuario-1",
        params: {
          id: "endereco-1",
        },
      };

      const res = createResponse();

      await enderecosController.remover(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message:
          "O endereço está vinculado a outros registros e não pode ser removido.",
        code: "ADDRESS_IN_USE",
      });
    });

    test("retorna 500 para erro inesperado", async () => {
      sql.mockRejectedValueOnce(new Error("Unexpected error"));

      const req = {
        usuario_id: "usuario-1",
        params: {
          id: "endereco-1",
        },
      };

      const res = createResponse();

      await enderecosController.remover(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: "Erro interno ao remover endereço.",
        code: "INTERNAL_SERVER_ERROR",
      });
    });
  });
});