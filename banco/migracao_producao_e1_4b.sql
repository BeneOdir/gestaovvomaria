-- Gestao Vovo Maria
-- Sprint E1.4-B - Registro de Producao por Fardos Concluidos
--
-- Esta migration cria estruturas exclusivas do modulo de Producao.
-- Nao altera produtos nem qualquer tabela do modulo Comercial.
-- produtos.id e vendedores.id permanecem referencias logicas validadas pelo
-- Worker, sem FOREIGN KEY para tabelas comerciais nesta etapa.
--
-- A unidade operacional oficial e FARDO CONCLUIDO.
-- Os parametros sao copiados para cada registro como snapshots, preservando
-- calculos historicos mesmo depois de uma alteracao de configuracao.

CREATE TABLE IF NOT EXISTS producao_parametros_produto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL
    CHECK (produto_id > 0),
  pacotes_por_fardo INTEGER NOT NULL
    CHECK (pacotes_por_fardo > 0),
  valor_por_pacote REAL NOT NULL
    CHECK (valor_por_pacote >= 0),
  ativo INTEGER NOT NULL DEFAULT 1
    CHECK (ativo IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (produto_id)
);

CREATE INDEX IF NOT EXISTS idx_producao_parametros_ativo
  ON producao_parametros_produto(ativo, produto_id);

CREATE TABLE IF NOT EXISTS producao_registros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL
    CHECK (produto_id > 0),
  usuario_id INTEGER NOT NULL
    CHECK (usuario_id > 0),
  data_producao TEXT NOT NULL
    CHECK (LENGTH(data_producao) = 10),
  quantidade_fardos INTEGER NOT NULL
    CHECK (quantidade_fardos > 0),
  pacotes_por_fardo_snapshot INTEGER NOT NULL
    CHECK (pacotes_por_fardo_snapshot > 0),
  quantidade_pacotes INTEGER NOT NULL
    CHECK (quantidade_pacotes > 0),
  valor_por_pacote_snapshot REAL NOT NULL
    CHECK (valor_por_pacote_snapshot >= 0),
  valor_producao REAL NOT NULL
    CHECK (valor_producao >= 0),
  observacao TEXT,
  chave_idempotencia TEXT NOT NULL
    CHECK (LENGTH(TRIM(chave_idempotencia)) > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (chave_idempotencia),
  CHECK (quantidade_pacotes = quantidade_fardos * pacotes_por_fardo_snapshot),
  CHECK (
    ABS(
      valor_producao - ROUND(quantidade_pacotes * valor_por_pacote_snapshot, 2)
    ) < 0.00001
  )
);

CREATE INDEX IF NOT EXISTS idx_producao_registros_data_produto
  ON producao_registros(data_producao, produto_id);

CREATE INDEX IF NOT EXISTS idx_producao_registros_produto_data
  ON producao_registros(produto_id, data_producao);

CREATE INDEX IF NOT EXISTS idx_producao_registros_usuario_data
  ON producao_registros(usuario_id, data_producao);

-- Nao sao criados movimentos de estoque nesta Sprint.
-- A integracao futura devera usar producao_registros.id como origem_id de uma
-- operacao ENTRADA_PRODUCAO idempotente no Estoque Central.
