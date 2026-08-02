-- ETAPA 4 - Índices da tabela ativa. Não altera visitas nem visita_itens.

CREATE INDEX idx_clientes_vendedor_ativo ON clientes(vendedor_id);
CREATE INDEX idx_clientes_status_ativo ON clientes(status_comercial, status_cliente);
CREATE INDEX idx_clientes_tipo_ativo ON clientes(tipo_cliente);

SELECT name, tbl_name, sql
FROM sqlite_master
WHERE type = 'index'
  AND tbl_name IN ('clientes', 'clientes_backup_pre_avulso_varejo')
ORDER BY tbl_name, name;
