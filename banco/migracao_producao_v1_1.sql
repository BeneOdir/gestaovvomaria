-- Gestao Vovo Maria
-- Producao V1.1 - Lotes abertos e lancamentos graduais
--
-- PRECONDICOES OBRIGATORIAS:
--   1. migracao_producao_e1_4b.sql aplicada;
--   2. migracao_producao_lotes_v1.sql aplicada;
--   3. confirmar que as colunas abaixo e producao_lote_produtos nao existem.
--
-- A migration preserva todos os lotes V1.0 como V1_LEGADO/ENCERRADO.
-- Nenhum movimento de estoque e criado por esta migration.
-- Os ALTER TABLE tornam este arquivo nao reexecutavel.

ALTER TABLE producao_lotes
  ADD COLUMN fluxo TEXT NOT NULL DEFAULT 'V1_LEGADO'
    CHECK (fluxo IN ('V1_LEGADO', 'V1_1_GRADUAL'));

ALTER TABLE producao_lotes
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ENCERRADO'
    CHECK (status IN ('ABERTO', 'ENCERRADO'));

ALTER TABLE producao_lotes
  ADD COLUMN encerrado_em DATETIME;

ALTER TABLE producao_lotes
  ADD COLUMN encerrado_por INTEGER
    CHECK (encerrado_por IS NULL OR encerrado_por > 0);

ALTER TABLE producao_lotes
  ADD COLUMN chave_encerramento TEXT;

ALTER TABLE producao_lotes
  ADD COLUMN motivo_encerramento TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_producao_lotes_chave_encerramento
  ON producao_lotes(chave_encerramento)
  WHERE chave_encerramento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_producao_lotes_status_fluxo_data
  ON producao_lotes(status, fluxo, data_producao);

CREATE TABLE IF NOT EXISTS producao_lote_produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote_id INTEGER NOT NULL
    CHECK (lote_id > 0),
  produto_id INTEGER NOT NULL
    CHECK (produto_id > 0),
  pacotes_por_fardo_snapshot INTEGER NOT NULL
    CHECK (pacotes_por_fardo_snapshot > 0),
  valor_por_pacote_snapshot REAL NOT NULL
    CHECK (valor_por_pacote_snapshot >= 0),
  incluido_por INTEGER NOT NULL
    CHECK (incluido_por > 0),
  observacao TEXT,
  chave_idempotencia TEXT NOT NULL
    CHECK (LENGTH(TRIM(chave_idempotencia)) > 0),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (lote_id, produto_id),
  UNIQUE (chave_idempotencia),

  FOREIGN KEY (lote_id)
    REFERENCES producao_lotes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_producao_lote_produtos_produto
  ON producao_lote_produtos(produto_id, lote_id);

CREATE INDEX IF NOT EXISTS idx_producao_lote_produtos_lote_criacao
  ON producao_lote_produtos(lote_id, created_at);

ALTER TABLE producao_registros
  ADD COLUMN confirmacao_fisica INTEGER NOT NULL DEFAULT 1
    CHECK (confirmacao_fisica IN (0, 1));

-- V1.0 permitia um unico registro por produto/lote. Na V1.1, a identidade
-- de cada lancamento passa a ser sua chave_idempotencia UNIQUE.
DROP INDEX IF EXISTS uq_producao_registros_lote_produto;

CREATE INDEX IF NOT EXISTS idx_producao_registros_lote_produto_data
  ON producao_registros(lote_id, produto_id, data_producao);

