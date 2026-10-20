const sql = require("../config/db");

const {
  sendSuccess,
  sendError,
} = require("../utils/apiResponse");

/**
 * Converte valores numéricos retornados pelo PostgreSQL.
 *
 * Colunas DECIMAL/NUMERIC normalmente chegam como string pelo driver.
 */
function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Retorna a estrutura vazia utilizada quando o consumidor ainda não
 * possui um carrinho.
 */
function emptyCart(consumerId) {
  return {
    id: null,
    consumidor_id: consumerId,
    cacambeiro_id: null,
    criado_em: null,
    itens: [],
    resumo: {
      quantidade_itens: 0,
      subtotal: 0,
      taxa_entrega: 0,
      total_estimado: 0,
    },
  };
}

/**
 * Busca e formata o carrinho completo de um consumidor.
 *
 * Esta função é reutilizada após operações de criação e atualização,
 * evitando repetição de consultas e de formatação das respostas.
 */
async function findConsumerCart(consumerId) {
  const cartRows = await sql`
    SELECT
      ca.id,
      ca.consumidor_id,
      ca.cacambeiro_id,
      ca.criado_em,
      COALESCE(dc.taxa_entrega, 0) AS taxa_entrega
    FROM carrinho ca
    LEFT JOIN detalhes_cacambeiro dc
      ON dc.usuario_id = ca.cacambeiro_id
    WHERE ca.consumidor_id = ${consumerId}
    LIMIT 1
  `;

  if (cartRows.length === 0) {
    return emptyCart(consumerId);
  }

  const cart = cartRows[0];

  const itemRows = await sql`
    SELECT
      ic.id,
      ic.cacamba_id,
      ic.quantidade,
      ic.dias_aluguel,
      c.nome,
      c.tipo_residuo,
      c.tamanho_m3,
      c.preco_diaria,
      c.foto_url,
      c.disponivel
    FROM itens_carrinho ic
    INNER JOIN cacambas c
      ON c.id = ic.cacamba_id
    WHERE ic.carrinho_id = ${cart.id}
    ORDER BY c.nome ASC
  `;

  const items = itemRows.map((item) => {
    const dailyPrice = toNumber(item.preco_diaria);
    const subtotal =
      item.quantidade *
      item.dias_aluguel *
      dailyPrice;

    return {
      id: item.id,
      cacamba_id: item.cacamba_id,
      quantidade: item.quantidade,
      dias_aluguel: item.dias_aluguel,
      subtotal,
      cacamba: {
        id: item.cacamba_id,
        nome: item.nome,
        tipo_residuo: item.tipo_residuo,
        tamanho_m3: toNumber(item.tamanho_m3),
        preco_diaria: dailyPrice,
        foto_url: item.foto_url,
        disponivel: item.disponivel,
      },
    };
  });

  const subtotal = items.reduce(
    (total, item) => total + item.subtotal,
    0,
  );

  const deliveryFee = toNumber(cart.taxa_entrega);

  return {
    id: cart.id,
    consumidor_id: cart.consumidor_id,
    cacambeiro_id: cart.cacambeiro_id,
    criado_em: cart.criado_em,
    itens: items,
    resumo: {
      quantidade_itens: items.reduce(
        (total, item) => total + item.quantidade,
        0,
      ),
      subtotal,
      taxa_entrega: deliveryFee,
      total_estimado: subtotal + deliveryFee,
    },
  };
}

const carrinhoController = {
  /**
   * GET /api/carrinho
   *
   * Retorna o carrinho do consumidor autenticado.
   *
   * Caso ainda não exista um carrinho, responde com uma estrutura
   * vazia. Isso permite que o Flutter trate os dois casos com o mesmo
   * modelo de dados.
   */
  async obter(req, res) {
    try {
      const consumerId = req.usuario_id;
      const cart = await findConsumerCart(consumerId);

      return sendSuccess(
        res,
        cart,
        200,
        "Carrinho carregado com sucesso.",
      );
    } catch (error) {
      console.error("Erro ao buscar carrinho:", error);

      return sendError(
        res,
        500,
        "Erro interno ao buscar o carrinho.",
        "CART_FETCH_ERROR",
      );
    }
  },

  /**
   * POST /api/carrinho/itens
   *
   * Adiciona uma caçamba ao carrinho.
   *
   * Body validado pelo middleware:
   * {
   *   cacamba_id: UUID,
   *   quantidade: inteiro entre 1 e 10,
   *   dias_aluguel: inteiro entre 1 e 30
   * }
   *
   * Regras de negócio:
   * - a caçamba deve existir;
   * - precisa estar disponível;
   * - o fornecedor precisa estar ativo;
   * - todos os itens do carrinho devem ser do mesmo fornecedor;
   * - uma caçamba não pode aparecer duplicada no carrinho.
   */
  async adicionarItem(req, res) {
    try {
      const consumerId = req.usuario_id;

      const {
        cacamba_id: dumpsterId,
        quantidade: quantity,
        dias_aluguel: rentalDays,
      } = req.body;

      /**
       * As validações de formato, quantidade e período já são feitas
       * pelo validationMiddleware. Aqui permanecem apenas as regras
       * que dependem do banco.
       */
      const dumpsterRows = await sql`
        SELECT
          c.id,
          c.cacambeiro_id,
          c.disponivel,
          u.status AS cacambeiro_status
        FROM cacambas c
        INNER JOIN usuarios u
          ON u.id = c.cacambeiro_id
        WHERE c.id = ${dumpsterId}
        LIMIT 1
      `;

      if (dumpsterRows.length === 0) {
        return sendError(
          res,
          404,
          "Caçamba não encontrada.",
          "DUMPSTER_NOT_FOUND",
        );
      }

      const dumpster = dumpsterRows[0];

      if (!dumpster.disponivel) {
        return sendError(
          res,
          409,
          "Esta caçamba não está disponível.",
          "DUMPSTER_UNAVAILABLE",
        );
      }

      if (dumpster.cacambeiro_status !== "ATIVO") {
        return sendError(
          res,
          409,
          "O fornecedor desta caçamba não está disponível.",
          "SUPPLIER_NOT_ACTIVE",
        );
      }

      const supplierId = dumpster.cacambeiro_id;

      let cartRows = await sql`
        SELECT id, cacambeiro_id
        FROM carrinho
        WHERE consumidor_id = ${consumerId}
        LIMIT 1
      `;

      if (
        cartRows.length > 0 &&
        cartRows[0].cacambeiro_id !== supplierId
      ) {
        return sendError(
          res,
          409,
          "Todos os itens do carrinho devem pertencer ao mesmo fornecedor. Limpe o carrinho para escolher outro fornecedor.",
          "CART_SUPPLIER_CONFLICT",
        );
      }

      /**
       * Cria o carrinho somente quando necessário.
       *
       * ON CONFLICT protege contra duas solicitações simultâneas,
       * pois existe uma restrição UNIQUE em consumidor_id.
       */
      if (cartRows.length === 0) {
        cartRows = await sql`
          INSERT INTO carrinho (
            id,
            consumidor_id,
            cacambeiro_id
          )
          VALUES (
            gen_random_uuid(),
            ${consumerId},
            ${supplierId}
          )
          ON CONFLICT (consumidor_id)
          DO NOTHING
          RETURNING id, cacambeiro_id
        `;

        /**
         * Se outra requisição criou o carrinho simultaneamente,
         * buscamos o registro já existente.
         */
        if (cartRows.length === 0) {
          cartRows = await sql`
            SELECT id, cacambeiro_id
            FROM carrinho
            WHERE consumidor_id = ${consumerId}
            LIMIT 1
          `;
        }
      }

      const cart = cartRows[0];

      /**
       * Faz novamente a validação do fornecedor após possível
       * concorrência na criação do carrinho.
       */
      if (cart.cacambeiro_id !== supplierId) {
        return sendError(
          res,
          409,
          "O carrinho atual pertence a outro fornecedor.",
          "CART_SUPPLIER_CONFLICT",
        );
      }

      const duplicateRows = await sql`
        SELECT id
        FROM itens_carrinho
        WHERE carrinho_id = ${cart.id}
          AND cacamba_id = ${dumpsterId}
        LIMIT 1
      `;

      if (duplicateRows.length > 0) {
        return sendError(
          res,
          409,
          "Esta caçamba já está no carrinho. Atualize a quantidade ou o período do item existente.",
          "ITEM_ALREADY_IN_CART",
        );
      }

      await sql`
        INSERT INTO itens_carrinho (
          id,
          carrinho_id,
          cacamba_id,
          quantidade,
          dias_aluguel
        )
        VALUES (
          gen_random_uuid(),
          ${cart.id},
          ${dumpsterId},
          ${quantity},
          ${rentalDays}
        )
      `;

      const updatedCart = await findConsumerCart(consumerId);

      return sendSuccess(
        res,
        updatedCart,
        201,
        "Item adicionado ao carrinho.",
      );
    } catch (error) {
      console.error(
        "Erro ao adicionar item ao carrinho:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao adicionar item ao carrinho.",
        "CART_ITEM_CREATE_ERROR",
      );
    }
  },

  /**
   * PUT /api/carrinho/itens/:id
   *
   * Atualiza a quantidade e/ou o período de aluguel.
   *
   * O middleware já garante:
   * - UUID válido;
   * - quantidade entre 1 e 10;
   * - período entre 1 e 30;
   * - pelo menos um campo presente no body.
   */
  async atualizarItem(req, res) {
    try {
      const consumerId = req.usuario_id;
      const { id: itemId } = req.params;

      const {
        quantidade: quantity,
        dias_aluguel: rentalDays,
      } = req.body;

      /**
       * UPDATE ... FROM garante que o item só seja alterado quando
       * pertence ao carrinho do consumidor autenticado.
       */
      const updatedRows = await sql`
        UPDATE itens_carrinho ic
        SET
          quantidade = COALESCE(
            ${quantity ?? null},
            ic.quantidade
          ),
          dias_aluguel = COALESCE(
            ${rentalDays ?? null},
            ic.dias_aluguel
          )
        FROM carrinho ca
        WHERE ic.id = ${itemId}
          AND ca.id = ic.carrinho_id
          AND ca.consumidor_id = ${consumerId}
        RETURNING
          ic.id,
          ic.carrinho_id
      `;

      if (updatedRows.length === 0) {
        return sendError(
          res,
          404,
          "Item não encontrado no seu carrinho.",
          "CART_ITEM_NOT_FOUND",
        );
      }

      const updatedCart = await findConsumerCart(consumerId);

      return sendSuccess(
        res,
        updatedCart,
        200,
        "Item atualizado com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao atualizar item do carrinho:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao atualizar o item do carrinho.",
        "CART_ITEM_UPDATE_ERROR",
      );
    }
  },

  /**
   * DELETE /api/carrinho
   *
   * Exclui o carrinho inteiro do consumidor.
   *
   * Os itens são removidos automaticamente pela foreign key
   * itens_carrinho.carrinho_id com ON DELETE CASCADE.
   *
   * A operação é idempotente: limpar um carrinho inexistente também
   * retorna sucesso.
   */
  async limpar(req, res) {
    try {
      const consumerId = req.usuario_id;

      const deletedRows = await sql`
        DELETE FROM carrinho
        WHERE consumidor_id = ${consumerId}
        RETURNING id
      `;

      return sendSuccess(
        res,
        {
          removido: deletedRows.length > 0,
        },
        200,
        deletedRows.length > 0
          ? "Carrinho limpo com sucesso."
          : "O carrinho já estava vazio.",
      );
    } catch (error) {
      console.error("Erro ao limpar carrinho:", error);

      return sendError(
        res,
        500,
        "Erro interno ao limpar o carrinho.",
        "CART_CLEAR_ERROR",
      );
    }
  },

  /**
   * DELETE /api/carrinho/itens/:id
   *
   * Remove somente um item.
   *
   * Se ele for o último item, o carrinho inteiro é removido. Como
   * existe ON DELETE CASCADE, excluir o carrinho também remove o item.
   */
  async removerItem(req, res) {
    try {
      const consumerId = req.usuario_id;
      const { id: itemId } = req.params;

      const targetRows = await sql`
        SELECT
          ic.id,
          ic.carrinho_id,
          (
            SELECT COUNT(*)::int
            FROM itens_carrinho other_item
            WHERE other_item.carrinho_id = ic.carrinho_id
          ) AS quantidade_itens
        FROM itens_carrinho ic
        INNER JOIN carrinho ca
          ON ca.id = ic.carrinho_id
        WHERE ic.id = ${itemId}
          AND ca.consumidor_id = ${consumerId}
        LIMIT 1
      `;

      if (targetRows.length === 0) {
        return sendError(
          res,
          404,
          "Item não encontrado no seu carrinho.",
          "CART_ITEM_NOT_FOUND",
        );
      }

      const target = targetRows[0];

      if (target.quantidade_itens === 1) {
        /**
         * Excluir o carrinho remove automaticamente o último item.
         * Essa operação ocorre em uma única instrução SQL.
         */
        await sql`
          DELETE FROM carrinho
          WHERE id = ${target.carrinho_id}
            AND consumidor_id = ${consumerId}
        `;
      } else {
        await sql`
          DELETE FROM itens_carrinho
          WHERE id = ${itemId}
        `;
      }

      const updatedCart = await findConsumerCart(consumerId);

      return sendSuccess(
        res,
        updatedCart,
        200,
        "Item removido com sucesso.",
      );
    } catch (error) {
      console.error(
        "Erro ao remover item do carrinho:",
        error,
      );

      return sendError(
        res,
        500,
        "Erro interno ao remover o item do carrinho.",
        "CART_ITEM_DELETE_ERROR",
      );
    }
  },
};

module.exports = carrinhoController;



//    ----------- Old Version --------------------
/*const sql = require("../config/db");

const carrinhoController = {
  /**
   * GET /api/carrinho
   * Retorna o carrinho do consumidor com todos os itens e detalhes das caçambas.
   * Se não existir carrinho, retorna estrutura vazia.
   *
  async obter(req, res) {
    try {
      const consumidor_id = req.usuario_id;

      // Buscar carrinho do consumidor
      const carrinhoRows = await sql`
        SELECT id, consumidor_id, cacambeiro_id, criado_em
        FROM carrinho
        WHERE consumidor_id = ${consumidor_id}
      `;

      if (carrinhoRows.length === 0) {
        return res.status(200).json({
          id: null,
          consumidor_id,
          cacambeiro_id: null,
          itens: []
        });
      }

      const carrinho = carrinhoRows[0];

      // Buscar itens com detalhes da caçamba
      const itens = await sql`
        SELECT 
          ic.id,
          ic.cacamba_id,
          ic.quantidade,
          ic.dias_aluguel,
          c.nome,
          c.tipo_residuo,
          c.preco_diaria
        FROM itens_carrinho ic
        JOIN cacambas c ON c.id = ic.cacamba_id
        WHERE ic.carrinho_id = ${carrinho.id}
      `;

      return res.status(200).json({
        id: carrinho.id,
        consumidor_id: carrinho.consumidor_id,
        cacambeiro_id: carrinho.cacambeiro_id,
        itens: itens.map(item => ({
          id: item.id,
          cacamba_id: item.cacamba_id,
          quantidade: item.quantidade,
          dias_aluguel: item.dias_aluguel,
          cacamba: {
            id: item.cacamba_id,
            nome: item.nome,
            tipo_residuo: item.tipo_residuo,
            preco_diaria: item.preco_diaria
          }
        }))
      });
    } catch (error) {
      console.error("Erro ao buscar carrinho:", error);
      return res.status(500).json({ error: "Erro interno ao buscar o carrinho." });
    }
  },

  /**
   * POST /api/carrinho/itens
   * Adiciona item ao carrinho. Valida single-cacambeiro constraint.
   * Body: { cacamba_id, quantidade (1-10), dias_aluguel (1-90) }
   *
  async adicionarItem(req, res) {
    try {
      const consumidor_id = req.usuario_id;
      const { cacamba_id, quantidade, dias_aluguel } = req.body;

      // Validar campos obrigatórios
      if (!cacamba_id) {
        return res.status(400).json({ error: "O campo 'cacamba_id' é obrigatório." });
      }

      // Validar quantidade (1-10)
      if (quantidade === undefined || quantidade === null || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 10) {
        return res.status(400).json({ error: "O campo 'quantidade' deve ser um inteiro entre 1 e 10." });
      }

      // Validar dias_aluguel (1-90)
      if (dias_aluguel === undefined || dias_aluguel === null || !Number.isInteger(dias_aluguel) || dias_aluguel < 1 || dias_aluguel > 90) {
        return res.status(400).json({ error: "O campo 'dias_aluguel' deve ser um inteiro entre 1 e 90." });
      }

      // Buscar a caçamba para obter o cacambeiro_id
      const cacambaRows = await sql`
        SELECT id, cacambeiro_id FROM cacambas WHERE id = ${cacamba_id}
      `;

      if (cacambaRows.length === 0) {
        return res.status(404).json({ error: "Caçamba não encontrada." });
      }

      const cacambeiro_id = cacambaRows[0].cacambeiro_id;

      // Verificar se já existe carrinho
      let carrinhoRows = await sql`
        SELECT id, cacambeiro_id FROM carrinho WHERE consumidor_id = ${consumidor_id}
      `;

      if (carrinhoRows.length > 0) {
        // Verificar single-cacambeiro constraint
        if (carrinhoRows[0].cacambeiro_id !== cacambeiro_id) {
          return res.status(400).json({
            error: "Todos os itens devem ser do mesmo caçambeiro. Limpe o carrinho para adicionar itens de outro fornecedor."
          });
        }
      } else {
        // Criar novo carrinho
        carrinhoRows = await sql`
          INSERT INTO carrinho (id, consumidor_id, cacambeiro_id)
          VALUES (gen_random_uuid(), ${consumidor_id}, ${cacambeiro_id})
          RETURNING id, cacambeiro_id
        `;
      }

      const carrinho_id = carrinhoRows[0].id;

      // Adicionar item ao carrinho
      await sql`
        INSERT INTO itens_carrinho (id, carrinho_id, cacamba_id, quantidade, dias_aluguel)
        VALUES (gen_random_uuid(), ${carrinho_id}, ${cacamba_id}, ${quantidade}, ${dias_aluguel})
      `;

      // Retornar carrinho atualizado
      const itens = await sql`
        SELECT 
          ic.id,
          ic.cacamba_id,
          ic.quantidade,
          ic.dias_aluguel,
          c.nome,
          c.tipo_residuo,
          c.preco_diaria
        FROM itens_carrinho ic
        JOIN cacambas c ON c.id = ic.cacamba_id
        WHERE ic.carrinho_id = ${carrinho_id}
      `;

      return res.status(201).json({
        id: carrinho_id,
        consumidor_id,
        cacambeiro_id,
        itens: itens.map(item => ({
          id: item.id,
          cacamba_id: item.cacamba_id,
          quantidade: item.quantidade,
          dias_aluguel: item.dias_aluguel,
          cacamba: {
            id: item.cacamba_id,
            nome: item.nome,
            tipo_residuo: item.tipo_residuo,
            preco_diaria: item.preco_diaria
          }
        }))
      });
    } catch (error) {
      console.error("Erro ao adicionar item ao carrinho:", error);
      return res.status(500).json({ error: "Erro interno ao adicionar item ao carrinho." });
    }
  },

  /**
   * PUT /api/carrinho/itens/:id
   * Atualiza a quantidade e/ou dias_aluguel de um item no carrinho.
   * Body: { quantidade (1-10), dias_aluguel (1-30) } - ambos opcionais
   *
  async atualizarItem(req, res) {
    try {
      const consumidor_id = req.usuario_id;
      const { id } = req.params;
      const { quantidade, dias_aluguel } = req.body;

      // Validar que ao menos um campo foi enviado
      if (quantidade === undefined && dias_aluguel === undefined) {
        return res.status(400).json({ error: "Informe 'quantidade' e/ou 'dias_aluguel' para atualizar." });
      }

      // Validar quantidade (1-10) se enviada
      if (quantidade !== undefined) {
        if (quantidade === null || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 10) {
          return res.status(400).json({ error: "O campo 'quantidade' deve ser um inteiro entre 1 e 10." });
        }
      }

      // Validar dias_aluguel (1-30) se enviado
      if (dias_aluguel !== undefined) {
        if (dias_aluguel === null || !Number.isInteger(dias_aluguel) || dias_aluguel < 1 || dias_aluguel > 30) {
          return res.status(400).json({ error: "O campo 'dias_aluguel' deve ser um inteiro entre 1 e 30." });
        }
      }

      // Verificar se o item pertence ao carrinho do consumidor
      const itemRows = await sql`
        SELECT ic.id, ic.carrinho_id
        FROM itens_carrinho ic
        JOIN carrinho c ON c.id = ic.carrinho_id
        WHERE ic.id = ${id} AND c.consumidor_id = ${consumidor_id}
      `;

      if (itemRows.length === 0) {
        return res.status(404).json({ error: "Item não encontrado no carrinho." });
      }

      const carrinho_id = itemRows[0].carrinho_id;

      // Atualizar campos enviados
      if (quantidade !== undefined && dias_aluguel !== undefined) {
        await sql`
          UPDATE itens_carrinho SET quantidade = ${quantidade}, dias_aluguel = ${dias_aluguel} WHERE id = ${id}
        `;
      } else if (quantidade !== undefined) {
        await sql`
          UPDATE itens_carrinho SET quantidade = ${quantidade} WHERE id = ${id}
        `;
      } else {
        await sql`
          UPDATE itens_carrinho SET dias_aluguel = ${dias_aluguel} WHERE id = ${id}
        `;
      }

      // Buscar carrinho atualizado
      const carrinhoRows = await sql`
        SELECT id, consumidor_id, cacambeiro_id FROM carrinho WHERE id = ${carrinho_id}
      `;

      const itens = await sql`
        SELECT 
          ic.id,
          ic.cacamba_id,
          ic.quantidade,
          ic.dias_aluguel,
          c.nome,
          c.tipo_residuo,
          c.preco_diaria
        FROM itens_carrinho ic
        JOIN cacambas c ON c.id = ic.cacamba_id
        WHERE ic.carrinho_id = ${carrinho_id}
      `;

      return res.status(200).json({
        id: carrinhoRows[0].id,
        consumidor_id: carrinhoRows[0].consumidor_id,
        cacambeiro_id: carrinhoRows[0].cacambeiro_id,
        itens: itens.map(item => ({
          id: item.id,
          cacamba_id: item.cacamba_id,
          quantidade: item.quantidade,
          dias_aluguel: item.dias_aluguel,
          cacamba: {
            id: item.cacamba_id,
            nome: item.nome,
            tipo_residuo: item.tipo_residuo,
            preco_diaria: item.preco_diaria
          }
        }))
      });
    } catch (error) {
      console.error("Erro ao atualizar item do carrinho:", error);
      return res.status(500).json({ error: "Erro interno ao atualizar item do carrinho." });
    }
  },

  /**
   * DELETE /api/carrinho
   * Limpa o carrinho (remove todos os itens e o registro do carrinho).
   *
  async limpar(req, res) {
    try {
      const consumidor_id = req.usuario_id;

      // Buscar carrinho do consumidor
      const carrinhoRows = await sql`
        SELECT id FROM carrinho WHERE consumidor_id = ${consumidor_id}
      `;

      if (carrinhoRows.length === 0) {
        return res.status(200).json({ message: "Carrinho limpo com sucesso" });
      }

      const carrinho_id = carrinhoRows[0].id;

      // Deletar itens e carrinho
      await sql`DELETE FROM itens_carrinho WHERE carrinho_id = ${carrinho_id}`;
      await sql`DELETE FROM carrinho WHERE id = ${carrinho_id}`;

      return res.status(200).json({ message: "Carrinho limpo com sucesso" });
    } catch (error) {
      console.error("Erro ao limpar carrinho:", error);
      return res.status(500).json({ error: "Erro interno ao limpar o carrinho." });
    }
  },

  /**
   * DELETE /api/carrinho/itens/:id
   * Remove um item específico do carrinho.
   *
  async removerItem(req, res) {
    try {
      const consumidor_id = req.usuario_id;
      const { id } = req.params;

      // Verificar se o item pertence ao carrinho do consumidor
      const itemRows = await sql`
        SELECT ic.id, ic.carrinho_id
        FROM itens_carrinho ic
        JOIN carrinho c ON c.id = ic.carrinho_id
        WHERE ic.id = ${id} AND c.consumidor_id = ${consumidor_id}
      `;

      if (itemRows.length === 0) {
        return res.status(404).json({ error: "Item não encontrado no carrinho." });
      }

      const carrinho_id = itemRows[0].carrinho_id;

      // Deletar o item
      await sql`DELETE FROM itens_carrinho WHERE id = ${id}`;

      // Verificar quantos itens sobraram
      const itensRestantes = await sql`
        SELECT COUNT(*) as count FROM itens_carrinho WHERE carrinho_id = ${carrinho_id}
      `;

      if (parseInt(itensRestantes[0].count) === 0) {
        // Se foi o último item, deletar o carrinho
        await sql`DELETE FROM carrinho WHERE id = ${carrinho_id}`;
      }

      return res.status(200).json({ message: "Item removido com sucesso" });
    } catch (error) {
      console.error("Erro ao remover item do carrinho:", error);
      return res.status(500).json({ error: "Erro interno ao remover item do carrinho." });
    }
  }
};

module.exports = carrinhoController;
*/