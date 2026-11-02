const sql = require("../config/db");

/**
 * Pedido visível para o usuário logado: o consumidor dono, o
 * caçambeiro dono ou um ADMIN. Pedido de outra pessoa devolve null,
 * o mesmo que um pedido inexistente, para não revelar que ele existe.
 */
async function buscarPedidoDoUsuario(aluguelId, usuarioId, perfil) {
  const rows = await sql`
    SELECT id, consumidor_id, cacambeiro_id
    FROM alugueis
    WHERE id = ${aluguelId}
    LIMIT 1
  `;

  const pedido = rows[0];

  if (!pedido) {
    return null;
  }

  const possuiAcesso =
    perfil === "ADMIN" ||
    pedido.consumidor_id === usuarioId ||
    pedido.cacambeiro_id === usuarioId;

  return possuiAcesso ? pedido : null;
}

module.exports = { buscarPedidoDoUsuario };
