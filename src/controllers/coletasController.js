const sql = require("../config/db");

const coletasController = {
  async agendar(req, res) {
    try {
      const consumidor_id = req.usuario_id;
      const { parceiro_id, endereco_id, materiais, data_agendada } = req.body;

      const nova = await sql`
        INSERT INTO coletas (consumidor_id, parceiro_id, endereco_id, materiais, data_agendada, status)
        VALUES (${consumidor_id}, ${parceiro_id}, ${endereco_id}, ${materiais}, ${data_agendada}, 'PENDENTE')
        RETURNING *
      `;

      return res.status(201).json(nova[0]);
    } catch (error) {
      console.error("Erro ao agendar coleta:", error);
      return res.status(500).json({ error: "Erro ao agendar coleta." });
    }
  },

  async listar(req, res) {
    try {
      const usuario_id = req.usuario_id;
      
      const coletas = await sql`
        SELECT 
          c.*,
          u_cons.nome_completo as consumidor_nome,
          u_parc.nome_completo as parceiro_nome
        FROM coletas c
        JOIN usuarios u_cons ON u_cons.id = c.consumidor_id
        JOIN usuarios u_parc ON u_parc.id = c.parceiro_id
        WHERE c.consumidor_id = ${usuario_id} OR c.parceiro_id = ${usuario_id}
        ORDER BY c.data_agendada DESC
      `;
      
      return res.status(200).json({ data: coletas });
    } catch (error) {
      console.error("Erro ao listar coletas:", error);
      return res.status(500).json({ error: "Erro ao listar coletas." });
    }
  },

  async atualizarStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const parceiro_id = req.usuario_id;

      // Opcional: verificar se o usuário é realmente o parceiro desta coleta
      const atualizada = await sql`
        UPDATE coletas SET status = ${status}
        WHERE id = ${id} AND parceiro_id = ${parceiro_id}
        RETURNING *
      `;

      if (atualizada.length === 0) {
        return res.status(403).json({ error: "Coleta não encontrada ou não autorizada." });
      }

      return res.status(200).json(atualizada[0]);
    } catch (error) {
      console.error("Erro ao atualizar status da coleta:", error);
      return res.status(500).json({ error: "Erro ao atualizar status da coleta." });
    }
  }
};

module.exports = coletasController;
