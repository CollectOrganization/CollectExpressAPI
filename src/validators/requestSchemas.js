const strongPassword = (value) => {
  const valid =
    value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /\d/.test(value);

  return (
    valid ||
    "A senha deve possuir ao menos 8 caracteres, uma letra maiúscula, uma minúscula e um número."
  );
};

const schemas = {
  uuidParam: {
    id: {
      required: true,
      type: "string",
      format: "uuid",
    },
  },

  cacambeiroReviewParam: {
    id: {
      required: true,
      type: "string",
      format: "uuid",
    },
  },

  register: {
    nome_completo: {
      required: true,
      type: "string",
      minLength: 3,
      maxLength: 150,
    },
    email: {
      required: true,
      type: "string",
      format: "email",
      maxLength: 255,
    },
    senha: {
      required: true,
      type: "string",
      maxLength: 128,
      custom: strongPassword,
    },
    tipo_perfil: {
      required: true,
      type: "string",
      enum: ["CONSUMIDOR", "CACAMBEIRO"],
    },
    documento: {
      required: true,
      type: "string",
      format: "digits",
      custom: (value) =>
        [11, 14].includes(value.length) ||
        "Documento deve possuir 11 ou 14 dígitos.",
    },
    telefone: {
      required: true,
      type: "string",
      format: "digits",
      minLength: 10,
      maxLength: 11,
    },
  },

  login: {
    email: {
      required: true,
      type: "string",
      format: "email",
      maxLength: 255,
    },
    senha: {
      required: true,
      type: "string",
      minLength: 6,
      maxLength: 128,
    },
  },

  refresh: {
    refresh_token: {
      required: true,
      type: "string",
      minLength: 20,
      maxLength: 200,
    },
  },

  logout: {
    refresh_token: {
      required: true,
      type: "string",
      minLength: 20,
      maxLength: 200,
    },
  },

  forgotPassword: {
    identifier: {
      required: true,
      type: "string",
      minLength: 5,
      maxLength: 255,
    },
    channel: {
      required: true,
      type: "string",
      enum: ["EMAIL", "SMS", "WHATSAPP"],
    },
  },

  resetPassword: {
    request_id: {
      required: true,
      type: "string",
      format: "uuid",
    },
    code: {
      required: true,
      type: "string",
      format: "digits",
      minLength: 6,
      maxLength: 6,
    },
    nova_senha: {
      required: true,
      type: "string",
      maxLength: 128,
      custom: strongPassword,
    },
  },

  createAdmin: {
    nome_completo: {
      required: true,
      type: "string",
      minLength: 3,
      maxLength: 150,
    },
    email: {
      required: true,
      type: "string",
      format: "email",
      maxLength: 255,
    },
    senha: {
      required: true,
      type: "string",
      maxLength: 128,
      custom: strongPassword,
    },
    documento: {
      required: true,
      type: "string",
      format: "digits",
      custom: (value) =>
        [11, 14].includes(value.length) ||
        "Documento deve possuir 11 ou 14 dígitos.",
    },
    telefone: {
      required: true,
      type: "string",
      format: "digits",
      minLength: 10,
      maxLength: 11,
    },
  },

  updateProfile: {
    nome_completo: {
      required: false,
      type: "string",
      minLength: 3,
      maxLength: 120,
    },
    telefone: {
      required: false,
      type: "string",
      format: "digits",
      minLength: 10,
      maxLength: 15,
    },
  },

  createAddress: {
    cep: {
      required: true,
      type: "string",
      format: "digits",
      minLength: 8,
      maxLength: 8,
    },
    logradouro: {
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 200,
    },
    numero: {
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 20,
    },
    bairro: {
      required: false,
      type: "string",
      maxLength: 100,
    },
    cidade_estado: {
      required: true,
      type: "string",
      minLength: 3,
      maxLength: 100,
    },
  },

  createDumpster: {
    nome: {
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 100,
    },
    foto_url: {
      required: false,
      type: "string",
      format: "url",
      maxLength: 500,
    },
    tipo_residuo: {
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 50,
    },
    tamanho_m3: {
      required: true,
      type: "number",
      min: 0.01,
      max: 999.99,
    },
    preco_diaria: {
      required: true,
      type: "number",
      min: 0.01,
      max: 99999999.99,
    },
  },

  updateDumpster: {
    nome: {
      required: false,
      type: "string",
      minLength: 1,
      maxLength: 100,
    },
    foto_url: {
      required: false,
      type: "string",
      format: "url",
      maxLength: 500,
    },
    tipo_residuo: {
      required: false,
      type: "string",
      minLength: 1,
      maxLength: 50,
    },
    tamanho_m3: {
      required: false,
      type: "number",
      min: 0.01,
      max: 999.99,
    },
    preco_diaria: {
      required: false,
      type: "number",
      min: 0.01,
      max: 99999999.99,
    },
    disponivel: {
      required: false,
      type: "boolean",
    },
  },

  createCartItem: {
    cacamba_id: {
      required: true,
      type: "string",
      format: "uuid",
    },
    quantidade: {
      required: true,
      type: "integer",
      min: 1,
      max: 10,
    },
    dias_aluguel: {
      required: true,
      type: "integer",
      min: 1,
      max: 30,
    },
  },

  updateCartItem: {
    quantidade: {
      required: false,
      type: "integer",
      min: 1,
      max: 10,
    },
    dias_aluguel: {
      required: false,
      type: "integer",
      min: 1,
      max: 30,
    },
  },

  checkout: {
    endereco_id: {
      required: true,
      type: "string",
      format: "uuid",
    },
    data_inicio: {
      required: true,
      type: "string",
      format: "date",
    },
  },

  updateOrderStatus: {
    status_aluguel: {
      required: true,
      type: "string",
      enum: [
        "EM_USO",
        "AGUARDANDO_RETIRADA",
        "FINALIZADO",
      ],
    },
  },

  createReview: {
    aluguel_id: {
      required: true,
      type: "string",
      format: "uuid",
    },
    nota: {
      required: true,
      type: "integer",
      min: 1,
      max: 5,
    },
    comentario: {
      required: false,
      type: "string",
      maxLength: 500,
    },
  },

  category: {
    nome: {
      required: true,
      type: "string",
      minLength: 1,
      maxLength: 100,
    },
  },
    dashboardQuery: {
    granularity: {
      required: false,
      type: "string",
      enum: ["daily", "weekly"],
    },
  },
};

module.exports = schemas;