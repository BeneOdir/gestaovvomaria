-- Gestão Vovó Maria - Clientes avulsos em tabela separada
-- Não altera clientes, visitas, visita_itens ou produtos.

CREATE TABLE IF NOT EXISTS clientes_avulsos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendedor_id INTEGER NOT NULL,
  nome_estabelecimento TEXT NOT NULL,
  tipo_pessoa TEXT,
  cpf TEXT,
  cnpj TEXT,
  telefone TEXT,
  whatsapp TEXT,
  cep TEXT,
  endereco TEXT,
  cidade TEXT,
  estado TEXT,
  observacoes_gerais TEXT,
  status_cadastro TEXT NOT NULL DEFAULT 'incompleto',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clientes_avulsos_vendedor
  ON clientes_avulsos(vendedor_id);

CREATE INDEX IF NOT EXISTS idx_clientes_avulsos_nome
  ON clientes_avulsos(nome_estabelecimento);

CREATE INDEX IF NOT EXISTS idx_clientes_avulsos_status
  ON clientes_avulsos(status_cadastro);
