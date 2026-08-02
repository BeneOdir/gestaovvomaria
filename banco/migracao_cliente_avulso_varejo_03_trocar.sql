-- ETAPA 3 - Trocar nomes. Mantém a tabela original como backup.
-- Execute somente após todas as conferências da ETAPA 2 retornarem OK.

ALTER TABLE clientes RENAME TO clientes_backup_pre_avulso_varejo;
ALTER TABLE clientes_migracao_tmp RENAME TO clientes;

SELECT name, type, sql
FROM sqlite_master
WHERE name IN ('clientes', 'clientes_backup_pre_avulso_varejo')
ORDER BY name;

SELECT name, seq
FROM sqlite_sequence
WHERE name IN ('clientes', 'clientes_backup_pre_avulso_varejo')
ORDER BY name;
