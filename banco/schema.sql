-- Gestão Vovó Maria - Schema novo para D1
-- Use este schema em banco novo OU depois de apagar as tabelas antigas.

DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS vendedores;

CREATE TABLE vendedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  role TEXT DEFAULT 'vendedor',
  status TEXT DEFAULT 'ativo',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO vendedores (nome, email, senha_hash, role, status)
VALUES ('Administrador', 'admin@vovomaria.com', 'admin123', 'admin', 'ativo');

CREATE TABLE clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendedor_id INTEGER,
  tipo_pessoa TEXT DEFAULT 'PJ',
  documento TEXT UNIQUE NOT NULL,
  cnpj TEXT,
  cpf TEXT,
  razao_social TEXT,
  nome_estabelecimento TEXT,
  nome_fantasia TEXT,
  ie TEXT,
  situacao_ie TEXT DEFAULT 'pendente',
  responsavel_empresa TEXT,
  responsavel_compra TEXT,
  telefone TEXT,
  whatsapp TEXT,
  instagram TEXT,
  email TEXT,
  contato_emergencia TEXT,
  cep TEXT,
  endereco TEXT,
  cidade TEXT,
  estado TEXT,
  concorrentes TEXT,
  observacoes_gerais TEXT,
  status_comercial TEXT DEFAULT 'prospect',
  status_cliente TEXT DEFAULT 'ativo',
  ultima_visita TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_clientes_documento ON clientes(documento);
CREATE INDEX idx_clientes_vendedor ON clientes(vendedor_id);
CREATE INDEX idx_clientes_status ON clientes(status_comercial, status_cliente);
