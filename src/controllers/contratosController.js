const {
  sendError,
} = require("../utils/apiResponse");
const {
  buscarPedidoDoUsuario,
} = require("../services/acessoPedido");
const {
  buscarContrato,
  emitirContrato,
  codigoDoPedido,
} = require("../services/contratoService");

const contratosController = {
  /**
   * GET /api/alugueis/:id/contrato
   *
   * Devolve o PDF do contrato. Só o consumidor e o caçambeiro do
   * pedido (ou um ADMIN) podem baixar. Se o arquivo ainda não foi
   * gerado ou sumiu do disco, é gerado de novo a partir do banco.
   *
   * Pedidos anteriores ao recurso não têm contrato (404).
   */
  async baixar(req, res) {
    try {
      const pedido = await buscarPedidoDoUsuario(
        req.params.id,
        req.usuario_id,
        req.tipo_perfil,
      );

      if (!pedido) {
        return sendError(
          res,
          404,
          "Pedido não encontrado.",
          "ORDER_NOT_FOUND",
        );
      }

      const contrato = await buscarContrato(pedido.id);

      if (!contrato) {
        return sendError(
          res,
          404,
          "Este pedido não possui contrato.",
          "CONTRACT_NOT_FOUND",
        );
      }

      const pdf = await emitirContrato(pedido.id);

      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="contrato-${codigoDoPedido(pedido.id)}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });

      return res.status(200).send(pdf);
    } catch (error) {
      console.error("Erro ao entregar contrato:", error);

      return sendError(
        res,
        500,
        "Erro interno ao gerar o contrato.",
        "CONTRACT_INTERNAL_ERROR",
      );
    }
  },
};

module.exports = contratosController;
