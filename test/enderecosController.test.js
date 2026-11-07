jest.mock("../src/config/db", () => jest.fn());

// Nunca chama a internet nos testes: a geocodificação é simulada.
jest.mock("../src/services/geocodingService", () => ({
  geocodificarEndereco: jest.fn(),
}));

const { geocodificarEndereco } = require(
  "../src/services/geocodingService",
);

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
    geocodificarEndereco.mockReset();
    geocodificarEndereco.mockResolvedValue(null);
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

  describe("coordenadas do endereço", () => {
    const corpo = {
      cep: "01310-100",
      logradouro: "  Avenida Paulista ",
      numero: " 1000 ",
      bairro: "Bela Vista",
      cidade_estado: "São Paulo - SP",
    };

    test("criar localiza o endereço e grava latitude e longitude", async () => {
      geocodificarEndereco.mockResolvedValueOnce({
        latitude: -23.564886,
        longitude: -46.651918,
        precisao: "numero",
      });

      sql.mockResolvedValueOnce([{ total: 0 }]);
      sql.mockResolvedValueOnce([{ id: "e1" }]);

      const res = createResponse();
      await enderecosController.criar(
        { usuario_id: "u1", body: corpo },
        res,
      );

      // Recebe o endereço já normalizado.
      expect(geocodificarEndereco).toHaveBeenCalledWith({
        cep: "01310100",
        logradouro: "Avenida Paulista",
        numero: "1000",
        bairro: "Bela Vista",
        cidade_estado: "São Paulo - SP",
      });

      const insert = sql.mock.calls[1];
      expect(insert[0].join("?")).toContain("latitude");
      expect(insert.slice(1)).toEqual(
        expect.arrayContaining([-23.564886, -46.651918]),
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test("se não localizar, salva o endereço mesmo assim, sem coordenadas", async () => {
      sql.mockResolvedValueOnce([{ total: 0 }]);
      sql.mockResolvedValueOnce([{ id: "e1" }]);

      const res = createResponse();
      await enderecosController.criar(
        { usuario_id: "u1", body: corpo },
        res,
      );

      const valores = sql.mock.calls[1].slice(1);
      expect(valores.slice(-2)).toEqual([null, null]);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test("falha inesperada na geocodificação não impede de salvar", async () => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      geocodificarEndereco.mockRejectedValueOnce(new Error("quebrou"));

      sql.mockResolvedValueOnce([{ total: 0 }]);
      sql.mockResolvedValueOnce([{ id: "e1" }]);

      const res = createResponse();
      await enderecosController.criar(
        { usuario_id: "u1", body: corpo },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(201);
      console.error.mockRestore();
    });

    test("atualizar localiza de novo e troca as coordenadas", async () => {
      geocodificarEndereco.mockResolvedValueOnce({
        latitude: -22.9,
        longitude: -47.06,
        precisao: "rua",
      });

      sql.mockResolvedValueOnce([{ id: "e1" }]); // existe
      sql.mockResolvedValueOnce([]); // sem pedido ativo
      sql.mockResolvedValueOnce([{ id: "e1" }]); // UPDATE

      const res = createResponse();
      await enderecosController.atualizar(
        { usuario_id: "u1", params: { id: "e1" }, body: corpo },
        res,
      );

      const update = sql.mock.calls[2];
      expect(update[0].join("?")).toContain("latitude");
      expect(update.slice(1)).toEqual(
        expect.arrayContaining([-22.9, -47.06]),
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("atualizar um endereço bloqueado não chama o serviço de mapas", async () => {
      sql.mockResolvedValueOnce([{ id: "e1" }]);
      sql.mockResolvedValueOnce([{ "?column?": 1 }]); // pedido ativo

      const res = createResponse();
      await enderecosController.atualizar(
        { usuario_id: "u1", params: { id: "e1" }, body: corpo },
        res,
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(geocodificarEndereco).not.toHaveBeenCalled();
    });

    test("listar devolve as coordenadas", async () => {
      sql.mockResolvedValueOnce([
        { id: "e1", latitude: "-23.564886", longitude: "-46.651918" },
      ]);

      const res = createResponse();
      await enderecosController.listar({ usuario_id: "u1" }, res);

      expect(sql.mock.calls[0][0].join("?")).toContain("latitude");
      expect(res.json.mock.calls[0][0].data[0].latitude).toBe("-23.564886");
    });
  });
});
