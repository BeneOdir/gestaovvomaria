-- Gestao Vovo Maria
-- Producao V1.0 - Receita Base e Lotes de Producao
--
-- Esta migration cria somente a estrutura de Receita Base e lotes.
-- Nao cadastra ingredientes, insumos ou movimentos de materia-prima.
-- Registros de Producao anteriores permanecem validos com lote_id NULL.
-- A validacao de usuario ativo e dos perfis admin/operacao permanece no Worker.

CREATE TABLE IF NOT EXISTS producao_receitas_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL
    CHECK (LENGTH(TRIM(nome)) > 0),
  versao INTEGER NOT NULL
    CHECK (versao > 0),
  ativo INTEGER NOT NULL DEFAULT 1
    CHECK (ativo IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (nome, versao)
);

CREATE INDEX IF NOT EXISTS idx_producao_receitas_base_ativo
  ON producao_receitas_base(ativo, nome, versao);

-- Receita oficial inicial. A composicao sera estruturada somente na Sprint
-- de Materia-Prima, quando existirem insumo_id e unidades de medida oficiais.
INSERT OR IGNORE INTO producao_receitas_base (
  nome, versao, ativo, created_at, updated_at
)
VALUES (
  'Receita Base Tradicional', 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS producao_lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receita_base_id INTEGER NOT NULL
    CHECK (receita_base_id > 0),
  quantidade_receitas_base REAL NOT NULL
    CHECK (quantidade_receitas_base > 0),
  data_producao TEXT NOT NULL
    CHECK (LENGTH(data_producao) = 10),
  usuario_id INTEGER NOT NULL
    CHECK (usuario_id > 0),
  observacao TEXT,
  chave_idempotencia TEXT NOT NULL
    CHECK (LENGTH(TRIM(chave_idempotencia)) > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (chave_idempotencia),

  FOREIGN KEY (receita_base_id)
    REFERENCES producao_receitas_base(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_producao_lotes_data_receita
  ON producao_lotes(data_producao, receita_base_id);

CREATE INDEX IF NOT EXISTS idx_producao_lotes_usuario_data
  ON producao_lotes(usuario_id, data_producao);

-- SQLite/D1 nao oferece ADD COLUMN IF NOT EXISTS. Esta migration e versionada
-- e deve ser aplicada uma unica vez, depois de preflight da coluna lote_id.
ALTER TABLE producao_registros
  ADD COLUMN lote_id INTEGER
    CHECK (lote_id IS NULL OR lote_id > 0)
    REFERENCES producao_lotes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;

-- Um produto aparece no maximo uma vez em cada lote. Registros legados com
-- lote_id NULL nao participam desta restricao.
CREATE UNIQUE INDEX IF NOT EXISTS uq_producao_registros_lote_produto
  ON producao_registros(lote_id, produto_id)
  WHERE lote_id IS NOT NULL;

