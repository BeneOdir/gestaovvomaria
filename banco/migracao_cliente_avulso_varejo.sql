-- Gestão Vovó Maria - Cliente Avulso - ETAPA 0 (somente diagnóstico)
-- Execute este arquivo primeiro. Ele não altera dados nem schema.
-- As etapas de escrita estão separadas nos arquivos 01 a 05.

SELECT name, type, sql
FROM sqlite_master
WHERE name IN (
  'clientes',
  'clientes_migracao_tmp',
  'clientes_backup_pre_avulso_varejo',
  'migracao_cliente_avulso_varejo_auditoria',
  'idx_clientes_vendedor_ativo',
  'idx_clientes_status_ativo',
  'idx_clientes_tipo_ativo'
)
ORDER BY type, name;

SELECT
  'clientes_ativos' AS conferencia,
  COUNT(*) AS quantidade,
  MIN(id) AS menor_id,
  MAX(id) AS maior_id,
  CASE WHEN COUNT(*) = 115 THEN 'OK' ELSE 'ERRO' END AS resultado
FROM clientes;

SELECT name, seq
FROM sqlite_sequence
WHERE name IN (
  'clientes',
  'clientes_migracao_tmp',
  'clientes_backup_pre_avulso_varejo'
)
ORDER BY name;

PRAGMA table_info('clientes');
PRAGMA foreign_key_list('clientes');
PRAGMA foreign_key_list('visitas');

SELECT type, name, tbl_name, sql
FROM sqlite_master
WHERE type IN ('trigger', 'view')
  AND (
    tbl_name = 'clientes'
    OR LOWER(COALESCE(sql, '')) LIKE '%clientes%'
  )
ORDER BY type, name;

-- DECISÃO OBRIGATÓRIA:
-- A) Banco ainda original: existe apenas clientes; documento é NOT NULL;
--    não existem tmp, backup, auditoria nem índices *_ativo. Pode iniciar 01.
-- B) Existem tmp, backup, auditoria ou índices *_ativo: execução anterior foi
--    parcial ou completa. NÃO execute 01 a 05 até revisar o estado.
-- C) visitas possui FK para clientes ou há trigger/view relacionada: pare e
--    adapte o procedimento antes de qualquer ALTER TABLE RENAME.
