-- Gestao Vovo Maria
-- Producao Teste V1 - separacao persistente entre OFICIAL e TESTE
--
-- PRECONDICOES OBRIGATORIAS (somente leitura; executar antes da migration):
--   PRAGMA table_info(producao_lotes);
--   PRAGMA table_info(producao_registros);
-- Confirmar que a coluna ambiente ainda nao existe nas duas tabelas.
-- SQLite/D1 nao oferece ADD COLUMN IF NOT EXISTS: esta migration nao e
-- reexecutavel e deve ser aplicada uma unica vez.
--
-- Registros anteriores permanecem OFICIAL pelo DEFAULT. Esta migration nao
-- cria operacoes nem movimentacoes de estoque e nao possui triggers.

ALTER TABLE producao_lotes
  ADD COLUMN ambiente TEXT NOT NULL DEFAULT 'OFICIAL'
    CHECK (ambiente IN ('OFICIAL', 'TESTE'));

ALTER TABLE producao_registros
  ADD COLUMN ambiente TEXT NOT NULL DEFAULT 'OFICIAL'
    CHECK (ambiente IN ('OFICIAL', 'TESTE'));

CREATE INDEX IF NOT EXISTS idx_producao_lotes_ambiente_status_fluxo_data
  ON producao_lotes(ambiente, status, fluxo, data_producao);

CREATE INDEX IF NOT EXISTS idx_producao_registros_ambiente_lote_produto_data
  ON producao_registros(ambiente, lote_id, produto_id, data_producao);

-- VALIDACOES POSTERIORES (somente leitura):
-- PRAGMA table_info(producao_lotes);
-- PRAGMA table_info(producao_registros);
-- SELECT ambiente, COUNT(*) FROM producao_lotes GROUP BY ambiente;
-- SELECT ambiente, COUNT(*) FROM producao_registros GROUP BY ambiente;
-- SELECT COUNT(*) AS ambientes_invalidos_lotes
--   FROM producao_lotes WHERE ambiente NOT IN ('OFICIAL', 'TESTE');
-- SELECT COUNT(*) AS ambientes_invalidos_registros
--   FROM producao_registros WHERE ambiente NOT IN ('OFICIAL', 'TESTE');
-- PRAGMA foreign_key_check;
-- PRAGMA quick_check;
