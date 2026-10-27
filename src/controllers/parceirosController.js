const sql = require("../config/db");

const parceirosController = {
  async listar(req, res) {
    try {
      const parceiros = await sql`
        SELECT 
          p.id as detalhes_id,
          p.usuario_id,
          p.capacidade_diaria_kg,
          p.materiais_aceitos,
          p.endereco_coleta,
          p.disponivel,
          u.nome_completo,
          u.telefone
        FROM detalhes_parceiro p
        JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.disponivel = true
      `;
      return res.status(200).json({ data: parceiros });
    } catch (error) {
      console.error("Erro ao listar parceiros:", error);
      return res.status(500).json({ error: "Erro ao buscar parceiros." });
    }
  },

  async detalhes(req, res) {
    try {
      const { id } = req.params;
      const parceiro = await sql`
        SELECT 
          p.id as detalhes_id,
          p.usuario_id,
          p.capacidade_diaria_kg,
          p.materiais_aceitos,
          p.endereco_coleta,
          p.disponivel,
          u.nome_completo,
          u.telefone
        FROM detalhes_parceiro p
        JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.usuario_id = ${id} OR p.id = ${id}
      `;

      if (parceiro.length === 0) {
        return res.status(404).json({ error: "Parceiro não encontrado." });
      }

      return res.status(200).json(parceiro[0]);
    } catch (error) {
      console.error("Erro ao buscar detalhes do parceiro:", error);
      return res.status(500).json({ error: "Erro ao buscar parceiro." });
    }
  },

  async salvarPerfil(req, res) {
    try {
      const usuario_id = req.usuario_id;
      const { capacidade_diaria_kg, materiais_aceitos, endereco_coleta, disponivel } = req.body;

      // Verificar se já existe perfil
      const existente = await sql`SELECT id FROM detalhes_parceiro WHERE usuario_id = ${usuario_id}`;

      if (existente.length > 0) {
        // Atualizar
        const atualizado = await sql`
          UPDATE detalhes_parceiro SET
            capacidade_diaria_kg = COALESCE(${capacidade_diaria_kg}, capacidade_diaria_kg),
            materiais_aceitos = COALESCE(${materiais_aceitos}, materiais_aceitos),
            endereco_coleta = COALESCE(${endereco_coleta}, endereco_coleta),
            disponivel = COALESCE(${disponivel}, disponivel)
          WHERE usuario_id = ${usuario_id}
          RETURNING *
        `;
        return res.status(200).json(atualizado[0]);
      } else {
        // Criar
        const novo = await sql`
          INSERT INTO detalhes_parceiro (usuario_id, capacidade_diaria_kg, materiais_aceitos, endereco_coleta, disponivel)
          VALUES (${usuario_id}, ${capacidade_diaria_kg}, ${materiais_aceitos}, ${endereco_coleta}, true)
          RETURNING *
        `;
        return res.status(201).json(novo[0]);
      }
    } catch (error) {
      console.error("Erro ao salvar perfil de parceiro:", error);
      return res.status(500).json({ error: "Erro ao salvar perfil de parceiro." });
    }
  }
};

module.exports = parceirosController;
