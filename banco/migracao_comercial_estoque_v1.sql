-- Gestao Vovo Maria
-- Integracao Comercial + Estoque V1
-- Estrutura aditiva: preserva integralmente vendas, itens e pagamentos existentes.

ALTER TABLE visitas ADD COLUMN chave_idempotencia TEXT NULL
  CHECK (chave_idempotencia IS NULL OR LENGTH(TRIM(chave_idempotencia)) BETWEEN 1 AND 180);
ALTER TABLE visitas ADD COLUMN idempotencia_hash TEXT NULL
  CHECK (idempotencia_hash IS NULL OR LENGTH(TRIM(idempotencia_hash)) BETWEEN 1 AND 128);
ALTER TABLE visitas ADD COLUMN status_registro TEXT NOT NULL DEFAULT 'ATIVA'
  CHECK (status_registro IN ('ATIVA', 'CANCELADA'));
ALTER TABLE visitas ADD COLUMN estoque_status TEXT NOT NULL DEFAULT 'LEGADO'
  CHECK (estoque_status IN ('LEGADO', 'NAO_APLICAVEL', 'CONFIRMADO', 'DIVERGENTE', 'SEM_BAIXA', 'CONCILIADO', 'ESTORNADO'));
ALTER TABLE visitas ADD COLUMN estoque_motivo TEXT NULL
  CHECK (estoque_motivo IS NULL OR LENGTH(TRIM(estoque_motivo)) BETWEEN 1 AND 500);
ALTER TABLE visitas ADD COLUMN cancelada_em DATETIME NULL;
ALTER TABLE visitas ADD COLUMN cancelada_por INTEGER NULL
  CHECK (cancelada_por IS NULL OR cancelada_por > 0);
ALTER TABLE visitas ADD COLUMN motivo_cancelamento TEXT NULL
  CHECK (motivo_cancelamento IS NULL OR LENGTH(TRIM(motivo_cancelamento)) BETWEEN 1 AND 500);
ALTER TABLE visitas ADD COLUMN chave_cancelamento TEXT NULL
  CHECK (chave_cancelamento IS NULL OR LENGTH(TRIM(chave_cancelamento)) BETWEEN 1 AND 180);
ALTER TABLE visitas ADD COLUMN estoque_conciliado_em DATETIME NULL;
ALTER TABLE visitas ADD COLUMN estoque_conciliado_por INTEGER NULL
  CHECK (estoque_conciliado_por IS NULL OR estoque_conciliado_por > 0);
ALTER TABLE visitas ADD COLUMN estoque_conciliacao_motivo TEXT NULL
  CHECK (estoque_conciliacao_motivo IS NULL OR LENGTH(TRIM(estoque_conciliacao_motivo)) BETWEEN 1 AND 500);
ALTER TABLE visitas ADD COLUMN chave_conciliacao TEXT NULL
  CHECK (chave_conciliacao IS NULL OR LENGTH(TRIM(chave_conciliacao)) BETWEEN 1 AND 180);

ALTER TABLE visita_itens ADD COLUMN item_ordem INTEGER NULL
  CHECK (item_ordem IS NULL OR item_ordem > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_visitas_chave_idempotencia
  ON visitas(chave_idempotencia) WHERE chave_idempotencia IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visitas_chave_cancelamento
  ON visitas(chave_cancelamento) WHERE chave_cancelamento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visitas_chave_conciliacao
  ON visitas(chave_conciliacao) WHERE chave_conciliacao IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visita_itens_visita_ordem
  ON visita_itens(visita_id, item_ordem) WHERE item_ordem IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitas_estoque_status_data
  ON visitas(estoque_status, data_visita);
CREATE INDEX IF NOT EXISTS idx_visitas_status_registro_data
  ON visitas(status_registro, data_visita);
CREATE INDEX IF NOT EXISTS idx_visitas_vendedor_canal_estoque
  ON visitas(vendedor_id, canal_venda, estoque_status);
CREATE INDEX IF NOT EXISTS idx_visitas_cancelada_em
  ON visitas(cancelada_em) WHERE cancelada_em IS NOT NULL;
