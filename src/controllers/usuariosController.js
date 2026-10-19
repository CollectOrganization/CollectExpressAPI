const bcrypt = require("bcryptjs");

const sql = require("../config/db");
const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

/**
 * Remove caracteres não numéricos.
 */
function apenasDigitos(value) {
  return value?.replace(/\D/g, "") ?? "";
}

/**
 * Mascara CPF ou CNPJ antes de retornar ao frontend.
 *
 * CPF:  ***.***.789-00
 * CNPJ: **.***.678/0001-00
 */
function mascararDocumento(documento) {
  if (!documento) return null;

  const numeros = apenasDigitos(documento);

  if (numeros.length === 11) {
    return (
      `***.***.${numeros.substring(6, 9)}` +
      `-${numeros.substring(9, 11)}`
    );
  }

  if (numeros.length === 14) {
    return (
      `**.***.${numeros.substring(5, 8)}` +
      `/${numeros.substring(8, 12)}` +
      `-${numeros.substring(12, 14)}`
    );
  }

  return "***";
}

/**
 * Prepara um usuário para ser enviado ao frontend.
 *
 * O objeto retornado nunca contém senha_hash ou documento completo.
 */
function serializarUsuario(usuario) {
  return {
    ...usuario,
    documento: mascararDocumento(usuario.documento),
  };
}

/**
 * Busca o perfil completo do usuário.
 *
 * Se o perfil for CACAMBEIRO, inclui também os dados específicos
 * existentes na tabela detalhes_cacambeiro.
 */
async function buscarPerfilCompleto(usuarioId) {
  const usuarios = await sql`
    SELECT
      id,
      nome_completo,
      email,
      tipo_perfil,
      documento,
      telefone,
      status,
      criado_em
    FROM usuarios
    WHERE id = ${usuarioId}
  `;

  if (usuarios.length === 0) {
    return null;
  }

  const usuario = serializarUsuario(usuarios[0]);

  if (usuario.tipo_perfil === "CACAMBEIRO") {
    const detalhes = await sql`
      SELECT
        horario_inicio,
        horario_fim,
        raio_entrega_km,
        taxa_entrega
      FROM detalhes_cacambeiro
      WHERE usuario_id = ${usuarioId}
    `;

    usuario.detalhes_cacambeiro =
      detalhes.length > 0 ? detalhes[0] : null;
  }

  return usuario;
}

/**
 * Traduz erros conhecidos do PostgreSQL em respostas de negócio.
 *
 * Retorna true quando o erro já foi tratado.
 */
function tratarErroDeUnicidade(error, res) {
  if (error.code !== "23505") {
    return false;
  }

  const constraint = error.constraint ?? "";
  const detail = error.detail ?? "";

  if (
    constraint.includes("email") ||
    detail.includes("email")
  ) {
    sendError(
      res,
      409,
      "Este e-mail já está cadastrado.",
      "EMAIL_ALREADY_EXISTS",
      {
        email: "Este e-mail já está cadastrado.",
      },
    );

    return true;
  }

  if (
    constraint.includes("documento") ||
    detail.includes("documento")
  ) {
    sendError(
      res,
      409,
      "Este documento já está cadastrado.",
      "DOCUMENT_ALREADY_EXISTS",
      {
        documento: "Este documento já está cadastrado.",
      },
    );

    return true;
  }

  sendError(
    res,
    409,
    "Já existe um registro com estes dados.",
    "DUPLICATE_RECORD",
  );

  return true;
}

const usuariosController = {
  /**
   * GET /api/usuarios/perfil
   *
   * Retorna o perfil do usuário autenticado.
   * O usuário é identificado exclusivamente pelo JWT.
   */
  async getPerfil(req, res) {
    try {
      const usuario = await buscarPerfilCompleto(
        req.usuario_id,
      );

      if (!usuario) {
        return sendError(
          res,
          404,
          "Usuário não encontrado.",
          "USER_NOT_FOUND",
        );
      }

      return sendSuccess(
        res,
        usuario,
        200,
        "Perfil carregado com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao buscar perfil:", error);

      return sendError(
        res,
        500,
        "Erro interno ao buscar o perfil.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * PUT /api/usuarios/perfil
   *
   * Atualiza somente os campos permitidos:
   * - nome_completo;
   * - telefone.
   *
   * A validação de formato é realizada pelo
   * validationMiddleware antes deste controller.
   */
  async updatePerfil(req, res) {
    try {
      const usuarioId = req.usuario_id;

      const nomeCompleto =
        req.body.nome_completo !== undefined
          ? req.body.nome_completo.trim()
          : null;

      const telefone =
        req.body.telefone !== undefined
          ? apenasDigitos(req.body.telefone)
          : null;

      /**
       * COALESCE mantém o valor atual quando o campo não foi
       * enviado na requisição.
       */
      const resultado = await sql`
        UPDATE usuarios
        SET
          nome_completo = COALESCE(
            ${nomeCompleto},
            nome_completo
          ),
          telefone = COALESCE(
            ${telefone},
            telefone
          )
        WHERE id = ${usuarioId}
        RETURNING id
      `;

      if (resultado.length === 0) {
        return sendError(
          res,
          404,
          "Usuário não encontrado.",
          "USER_NOT_FOUND",
        );
      }

      const usuario = await buscarPerfilCompleto(usuarioId);

      return sendSuccess(
        res,
        usuario,
        200,
        "Perfil atualizado com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);

      return sendError(
        res,
        500,
        "Erro interno ao atualizar o perfil.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * POST /api/usuarios/admin
   *
   * Cria um administrador.
   *
   * Segurança:
   * - a rota deve usar authMiddleware;
   * - a rota deve exigir roleMiddleware(["ADMIN"]);
   * - o perfil é definido como ADMIN no backend;
   * - o frontend não pode escolher o tipo do perfil.
   */
  async criarAdmin(req, res) {
    try {
      const {
        nome_completo,
        email,
        senha,
        documento,
        telefone,
      } = req.body;

      const nomeNormalizado = nome_completo.trim();
      const emailNormalizado = email
        .trim()
        .toLowerCase();

      const documentoNormalizado =
        apenasDigitos(documento);

      const telefoneNormalizado =
        apenasDigitos(telefone);

      /**
       * Defesa adicional.
       *
       * A validação principal da senha é executada pelo schema
       * createAdmin, mas o controller preserva a regra crítica.
       */
      const senhaForte =
        senha.length >= 8 &&
        /[A-Z]/.test(senha) &&
        /[a-z]/.test(senha) &&
        /\d/.test(senha);

      if (!senhaForte) {
        return sendError(
          res,
          400,
          "A senha não atende aos requisitos de segurança.",
          "WEAK_PASSWORD",
          {
            senha:
              "Use pelo menos 8 caracteres, uma letra maiúscula, uma minúscula e um número.",
          },
        );
      }

      const senhaHash = await bcrypt.hash(senha, 10);

      const resultado = await sql`
        INSERT INTO usuarios (
          id,
          nome_completo,
          email,
          senha_hash,
          tipo_perfil,
          documento,
          telefone,
          status,
          criado_em
        )
        VALUES (
          gen_random_uuid(),
          ${nomeNormalizado},
          ${emailNormalizado},
          ${senhaHash},
          'ADMIN',
          ${documentoNormalizado},
          ${telefoneNormalizado},
          'ATIVO',
          NOW()
        )
        RETURNING
          id,
          nome_completo,
          email,
          tipo_perfil,
          documento,
          telefone,
          status,
          criado_em
      `;

      const administrador = serializarUsuario(
        resultado[0],
      );

      return sendSuccess(
        res,
        administrador,
        201,
        "Administrador cadastrado com sucesso.",
      );
    } catch (error) {
      if (tratarErroDeUnicidade(error, res)) {
        return;
      }

      console.error(
        "Erro ao criar administrador:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao criar o administrador.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * GET /api/usuarios
   *
   * Lista usuários para administradores.
   *
   * Query params:
   * - page: página atual;
   * - tipo_perfil: CONSUMIDOR, CACAMBEIRO ou ADMIN;
   * - search: busca por nome ou e-mail.
   */
  async listarUsuarios(req, res) {
    try {
      const page = Math.max(
        1,
        Number.parseInt(req.query.page, 10) || 1,
      );

      const limit = 20;
      const offset = (page - 1) * limit;

      const tipoPerfil =
        req.query.tipo_perfil?.trim() || null;

      const search = req.query.search?.trim() || null;

      const perfisPermitidos = [
        "CONSUMIDOR",
        "CACAMBEIRO",
        "ADMIN",
      ];

      if (
        tipoPerfil &&
        !perfisPermitidos.includes(tipoPerfil)
      ) {
        return sendError(
          res,
          400,
          "Filtro de perfil inválido.",
          "INVALID_PROFILE_FILTER",
          {
            tipo_perfil:
              "Use CONSUMIDOR, CACAMBEIRO ou ADMIN.",
          },
        );
      }

      const searchPattern =
        search && search.length >= 3
          ? `%${search}%`
          : null;

      /**
       * Os filtros opcionais são aplicados sem concatenar SQL.
       * Isso mantém a consulta parametrizada.
       */
      const countResult = await sql`
        SELECT COUNT(*)::int AS total
        FROM usuarios
        WHERE (
          ${tipoPerfil}::text IS NULL
          OR tipo_perfil::text = ${tipoPerfil}
        )
        AND (
          ${searchPattern}::text IS NULL
          OR nome_completo ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
        )
      `;

      const total = countResult[0].total;
      const totalPages = Math.ceil(total / limit);

      const usuarios = await sql`
        SELECT
          id,
          nome_completo,
          email,
          tipo_perfil,
          documento,
          telefone,
          status,
          criado_em
        FROM usuarios
        WHERE (
          ${tipoPerfil}::text IS NULL
          OR tipo_perfil::text = ${tipoPerfil}
        )
        AND (
          ${searchPattern}::text IS NULL
          OR nome_completo ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
        )
        ORDER BY criado_em DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      const data = usuarios.map(serializarUsuario);

      return sendSuccess(
        res,
        {
          items: data,
          pagination: {
            total,
            page,
            per_page: limit,
            total_pages: totalPages,
          },
        },
        200,
        "Usuários carregados com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao listar usuários:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao listar usuários.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },

  /**
   * GET /api/usuarios/:id
   *
   * Retorna ao administrador:
   * - dados básicos do usuário;
   * - endereços;
   * - histórico de pedidos como consumidor ou caçambeiro;
   * - detalhes do fornecedor, quando aplicável.
   */
  async detalheUsuario(req, res) {
    try {
      const { id } = req.params;

      const usuarios = await sql`
        SELECT
          id,
          nome_completo,
          email,
          tipo_perfil,
          documento,
          telefone,
          status,
          criado_em
        FROM usuarios
        WHERE id = ${id}
      `;

      if (usuarios.length === 0) {
        return sendError(
          res,
          404,
          "Usuário não encontrado.",
          "USER_NOT_FOUND",
        );
      }

      const usuario = serializarUsuario(usuarios[0]);

      const enderecos = await sql`
        SELECT
          id,
          usuario_id,
          cep,
          logradouro,
          numero,
          bairro,
          cidade_estado,
          criado_em
        FROM enderecos
        WHERE usuario_id = ${id}
        ORDER BY criado_em DESC
      `;

      const pedidos = await sql`
        SELECT
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
        FROM alugueis
        WHERE consumidor_id = ${id}
           OR cacambeiro_id = ${id}
        ORDER BY data_pedido DESC
      `;

      usuario.enderecos = enderecos;
      usuario.pedidos = pedidos;

      if (usuario.tipo_perfil === "CACAMBEIRO") {
        const detalhes = await sql`
          SELECT
            horario_inicio,
            horario_fim,
            raio_entrega_km,
            taxa_entrega
          FROM detalhes_cacambeiro
          WHERE usuario_id = ${id}
        `;

        usuario.detalhes_cacambeiro =
          detalhes.length > 0 ? detalhes[0] : null;
      }

      return sendSuccess(
        res,
        usuario,
        200,
        "Detalhes do usuário carregados com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao buscar detalhes do usuário:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao buscar detalhes do usuário.",
        "INTERNAL_SERVER_ERROR",
      );
    }
  },
};

module.exports = usuariosController;


// ------------- Old version --------------
/*const sql = require("../config/db");
const bcrypt = require("bcryptjs");

function mascararDocumento(doc) {
  if (!doc) return doc;
  const docLimpo = doc.replace(/\D/g, "");
  if (docLimpo.length === 11) {
    return `***.***.${docLimpo.substring(6, 9)}-${docLimpo.substring(9, 11)}`;
  } else if (docLimpo.length === 14) {
    return `**.***.${docLimpo.substring(5, 8)}/${docLimpo.substring(8, 12)}-${docLimpo.substring(12, 14)}`;
  }
  return "***";
}
const usuariosController = {
  // Buscar perfil do usuário autenticado
  async getPerfil(req, res) {
    try {
      const usuarioId = req.usuario_id;

      const resultado = await sql`
        SELECT id, nome_completo, email, tipo_perfil, documento, telefone, criado_em
        FROM usuarios
        WHERE id = ${usuarioId}
      `;

      if (resultado.length === 0) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      const usuario = resultado[0];

      // Se for CACAMBEIRO, buscar detalhes adicionais
      if (usuario.tipo_perfil === "CACAMBEIRO") {
        const detalhes = await sql`
          SELECT horario_inicio, horario_fim, raio_entrega_km, taxa_entrega
          FROM detalhes_cacambeiro
          WHERE usuario_id = ${usuarioId}
        `;

        if (detalhes.length > 0) {
          usuario.detalhes_cacambeiro = detalhes[0];
        }
      }

      return res.status(200).json(usuario);
    } catch (error) {
      console.error("Erro ao buscar perfil:", error);
      return res.status(500).json({ error: "Erro interno no servidor ao buscar perfil." });
    }
  },

  // Atualizar perfil do usuário autenticado (apenas nome_completo e telefone)
  async updatePerfil(req, res) {
    try {
      const usuarioId = req.usuario_id;
      const { nome_completo, telefone } = req.body;

      // Validação dos campos
      const fields = {};

      if (nome_completo !== undefined) {
        if (typeof nome_completo !== "string" || nome_completo.trim().length < 3 || nome_completo.trim().length > 120) {
          fields.nome_completo = "Nome completo deve ter entre 3 e 120 caracteres";
        }
      }

      if (telefone !== undefined) {
        if (typeof telefone !== "string" || !/^\d{10,15}$/.test(telefone)) {
          fields.telefone = "Telefone deve conter entre 10 e 15 dígitos numéricos";
        }
      }

      if (Object.keys(fields).length > 0) {
        return res.status(400).json({ error: "Dados inválidos", fields });
      }

      // Montar atualização dinâmica apenas com campos fornecidos
      if (nome_completo !== undefined && telefone !== undefined) {
        await sql`
          UPDATE usuarios
          SET nome_completo = ${nome_completo.trim()}, telefone = ${telefone}
          WHERE id = ${usuarioId}
        `;
      } else if (nome_completo !== undefined) {
        await sql`
          UPDATE usuarios
          SET nome_completo = ${nome_completo.trim()}
          WHERE id = ${usuarioId}
        `;
      } else if (telefone !== undefined) {
        await sql`
          UPDATE usuarios
          SET telefone = ${telefone}
          WHERE id = ${usuarioId}
        `;
      } else {
        // Nenhum campo editável fornecido, retornar perfil atual
      }

      // Retornar perfil atualizado (mesmo formato do GET)
      const resultado = await sql`
        SELECT id, nome_completo, email, tipo_perfil, documento, telefone, criado_em
        FROM usuarios
        WHERE id = ${usuarioId}
      `;

      if (resultado.length === 0) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      const usuario = resultado[0];

      if (usuario.tipo_perfil === "CACAMBEIRO") {
        const detalhes = await sql`
          SELECT horario_inicio, horario_fim, raio_entrega_km, taxa_entrega
          FROM detalhes_cacambeiro
          WHERE usuario_id = ${usuarioId}
        `;

        if (detalhes.length > 0) {
          usuario.detalhes_cacambeiro = detalhes[0];
        }
      }

      return res.status(200).json(usuario);
    } catch (error) {
      console.error("Erro ao atualizar perfil:", error);
      return res.status(500).json({ error: "Erro interno no servidor ao atualizar perfil." });
    }
  },

  // Listar usuários (ADMIN) - paginado, com filtro e busca
async criarAdmin(req, res) {
  try {
    const {
      nome_completo,
      email,
      senha,
      documento,
      telefone,
    } = req.body;

    if (
      !nome_completo ||
      !email ||
      !senha ||
      !documento ||
      !telefone
    ) {
      return res.status(400).json({
        error: "Preencha todos os campos obrigatórios.",
      });
    }

    if (senha.length < 8) {
      return res.status(400).json({
        error: "A senha deve possuir no mínimo 8 caracteres.",
      });
    }

    const hasUppercase = /[A-Z]/.test(senha);
    const hasLowercase = /[a-z]/.test(senha);
    const hasDigit = /\d/.test(senha);

    if (!hasUppercase || !hasLowercase || !hasDigit) {
      return res.status(400).json({
        error:
          "A senha deve conter letra maiúscula, minúscula e número.",
      });
    }

    const senha_hash = await bcrypt.hash(senha, 10);

    const resultado = await sql`
      INSERT INTO usuarios (
        id,
        nome_completo,
        email,
        senha_hash,
        tipo_perfil,
        documento,
        telefone,
        criado_em
      )
      VALUES (
        gen_random_uuid(),
        ${nome_completo.trim()},
        ${email.trim().toLowerCase()},
        ${senha_hash},
        'ADMIN',
        ${documento},
        ${telefone},
        NOW()
      )
      RETURNING
        id,
        nome_completo,
        email,
        tipo_perfil,
        documento,
        telefone,
        criado_em
    `;

    return res.status(201).json({
      message: "Administrador cadastrado com sucesso.",
      usuario: resultado[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        error: "E-mail ou documento já cadastrado.",
      });
    }

    console.error("Erro ao criar administrador:", error);

    return res.status(500).json({
      error: "Erro interno ao criar administrador.",
    });
  }
},

/**
 * GET /api/usuarios
 * Lista usuários para administradores.
 *
 * Query params:
 * - page: página atual
 * - tipo_perfil: CONSUMIDOR, CACAMBEIRO ou ADMIN
 * - search: busca por nome ou e-mail
 *
async listarUsuarios(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const tipoPerfil = req.query.tipo_perfil;
    const search = req.query.search?.trim();

    let conditions = sql`WHERE 1 = 1`;

    if (tipoPerfil) {
      conditions = sql`
        ${conditions}
        AND tipo_perfil = ${tipoPerfil}
      `;
    }

    if (search && search.length >= 3) {
      const searchPattern = `%${search}%`;

      conditions = sql`
        ${conditions}
        AND (
          nome_completo ILIKE ${searchPattern}
          OR email ILIKE ${searchPattern}
        )
      `;
    }

    const countResult = await sql`
      SELECT COUNT(*)::int AS total
      FROM usuarios
      ${conditions}
    `;

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    const usuarios = await sql`
      SELECT
        id,
        nome_completo,
        email,
        tipo_perfil,
        documento,
        telefone,
        criado_em
      FROM usuarios
      ${conditions}
      ORDER BY criado_em DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const usuariosMascarados = usuarios.map((usuario) => ({
      ...usuario,
      doc: mascararDocumento(usuario.doc),
    }));

    return res.status(200).json({
      data: usuariosMascarados,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Erro ao listar usuários:", error);

    return res.status(500).json({
      error: "Erro interno no servidor ao listar usuários.",
    });
  }
},

  // Detalhe de usuário (ADMIN) - com endereços e histórico de pedidos
  async detalheUsuario(req, res) {
    try {
      const { id } = req.params;

      // Buscar usuário (sem senha_hash)
      const resultado = await sql`
        SELECT id, nome_completo, email, tipo_perfil, documento, telefone, criado_em
        FROM usuarios
        WHERE id = ${id}
      `;

      if (resultado.length === 0) {
        return res.status(404).json({ error: "Usuário não encontrado" });
      }

      const usuario = resultado[0];
      usuario.documento = mascararDocumento(usuario.documento);

      // Buscar endereços do usuário
      const enderecos = await sql`
        SELECT id, usuario_id, cep, logradouro, numero, bairro, cidade_estado, criado_em
        FROM enderecos
        WHERE usuario_id = ${id}
      `;

      // Buscar histórico de pedidos (alugueis onde o usuário é consumidor ou cacambeiro)
      const pedidos = await sql`
        SELECT id, consumidor_id, cacambeiro_id, endereco_id, data_pedido, data_inicio, dias_aluguel, preco_final, status_pagamento, status_aluguel
        FROM alugueis
        WHERE consumidor_id = ${id} OR cacambeiro_id = ${id}
        ORDER BY data_pedido DESC
      `;

      usuario.enderecos = enderecos;
      usuario.pedidos = pedidos;

      return res.status(200).json(usuario);
    } catch (error) {
      console.error("Erro ao buscar detalhe do usuário:", error);
      return res.status(500).json({ error: "Erro interno no servidor ao buscar detalhe do usuário." });
    }
  },

  // Criar novo usuário (Consumidor ou Caçambeiro)
  async criar(req, res) {
    try {
      const { nome_completo, email, senha, tipo_perfil, documento, telefone } = req.body;

      // 1. Validação básica de campos obrigatórios
      if (!nome_completo || !email || !senha || !tipo_perfil || !documento) {
        return res.status(400).json({ error: "Preencha todos os campos obrigatórios (nome, email, senha, tipo e documento)." });
      }

      // 2. Criptografar a senha (nunca salvar em texto plano)
      const salt = await bcrypt.genSalt(10);
      const senha_hash = await bcrypt.hash(senha, salt);

      // 3. Inserir no banco de dados
      // O NeonDB utiliza tagged template literals que tratam automaticamente o escape de variáveis, evitando SQL Injection
      const resultado = await sql`
        INSERT INTO usuarios (
          id, nome_completo, email, senha_hash, tipo_perfil, documento, telefone, criado_em
        ) VALUES (
          gen_random_uuid(), 
          ${nome_completo}, 
          ${email}, 
          ${senha_hash}, 
          ${tipo_perfil}, 
          ${documento}, 
          ${telefone}, 
          NOW()
        )
        RETURNING id, nome_completo, email, tipo_perfil, documento, telefone, criado_em;
      `;

      // Retorna o registro criado (excluindo a senha por segurança)
      return res.status(201).json({
        message: "Usuário cadastrado com sucesso!",
        usuario: resultado[0]
      });

    } catch (error) {
      console.error("Erro no cadastro de usuário:", error);
      
      // Tratamento de erro específico do PostgreSQL: Violação de Unique Constraint (código 23505)
      // Disparado se o e-mail ou documento já existirem na base
      if (error.code === '23505') {
         return res.status(409).json({ error: "Este e-mail ou documento já está cadastrado." });
      }

      return res.status(500).json({ error: "Erro interno no servidor ao tentar criar usuário." });
    }
  }
};

module.exports = usuariosController;
*/