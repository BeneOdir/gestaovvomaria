-- ETAPA 1 - Auditoria e tabela temporária. Execute somente após ETAPA 0 = caso A.

CREATE TABLE migracao_cliente_avulso_varejo_auditoria (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  clientes_quantidade INTEGER NOT NULL,
  clientes_menor_id INTEGER,
  clientes_maior_id INTEGER,
  clientes_seq_historica INTEGER NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO migracao_cliente_avulso_varejo_auditoria (
  id, clientes_quantidade, clientes_menor_id,
  clientes_maior_id, clientes_seq_historica
)
SELECT
  1, COUNT(*), MIN(id), MAX(id),
  COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'clientes'), 0)
FROM clientes;

CREATE TABLE clientes_migracao_tmp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendedor_id INTEGER,
  tipo_pessoa TEXT DEFAULT 'PJ',
  documento TEXT UNIQUE,
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
  tipo_cliente TEXT NOT NULL DEFAULT 'cadastrado'
    CHECK (tipo_cliente IN ('cadastrado', 'avulso')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

SELECT
  *,
  CASE WHEN clientes_quantidade = 115 THEN 'OK' ELSE 'ERRO' END AS resultado
FROM migracao_cliente_avulso_varejo_auditoria;

PRAGMA table_info('clientes_migracao_tmp');
