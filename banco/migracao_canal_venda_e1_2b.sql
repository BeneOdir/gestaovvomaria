-- Gestão Vovó Maria
-- Sprint E1.2B — Canal da venda
--
-- Objetivo:
--   Identificar se a venda ocorreu em rota ou na loja/fábrica.
--
-- Compatibilidade com o histórico:
--   A coluna aceita NULL exclusivamente para preservar registros anteriores.
--   Novas vendas recebem obrigatoriamente o canal definido pelo Worker.
--
-- Valores oficiais:
--   ROTA
--   LOJA_FABRICA

ALTER TABLE visitas
ADD COLUMN canal_venda TEXT NULL
CHECK (
  canal_venda IS NULL
  OR canal_venda IN ('ROTA', 'LOJA_FABRICA')
);

-- Acelera consultas futuras por canal dentro de um período de vendas.
CREATE INDEX idx_visitas_canal_venda_data
ON visitas (canal_venda, data_visita);
