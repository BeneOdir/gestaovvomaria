-- ETAPA 5 - Validação final somente leitura.

SELECT
  'DEPOIS_clientes' AS conferencia,
  (SELECT COUNT(*) FROM clientes_backup_pre_avulso_varejo) AS antes,
  (SELECT COUNT(*) FROM clientes) AS depois,
  CASE
    WHEN (SELECT COUNT(*) FROM clientes_backup_pre_avulso_varejo) = 115
      AND (SELECT COUNT(*) FROM clientes) = 115
    THEN 'OK' ELSE 'ERRO'
  END AS resultado;

SELECT
  'DEPOIS_ids' AS conferencia,
  COUNT(*) AS ids_diferentes,
  CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERRO' END AS resultado
FROM (
  SELECT id FROM (
    SELECT id FROM clientes_backup_pre_avulso_varejo EXCEPT SELECT id FROM clientes
  )
  UNION ALL
  SELECT id FROM (
    SELECT id FROM clientes EXCEPT SELECT id FROM clientes_backup_pre_avulso_varejo
  )
);

SELECT
  'DEPOIS_tipos' AS conferencia,
  COUNT(*) AS quantidade,
  SUM(CASE WHEN tipo_cliente = 'cadastrado' THEN 1 ELSE 0 END) AS cadastrados,
  CASE
    WHEN COUNT(*) = 115
      AND SUM(CASE WHEN tipo_cliente = 'cadastrado' THEN 1 ELSE 0 END) = 115
    THEN 'OK' ELSE 'ERRO'
  END AS resultado
FROM clientes;

SELECT
  'DEPOIS_sequence' AS conferencia,
  s.seq AS sequencia_final,
  a.clientes_seq_historica AS sequencia_historica,
  (SELECT MAX(id) FROM clientes) AS maior_id,
  CASE
    WHEN s.seq >= a.clientes_seq_historica
      AND s.seq >= (SELECT MAX(id) FROM clientes)
    THEN 'OK' ELSE 'ERRO'
  END AS resultado
FROM sqlite_sequence s
CROSS JOIN migracao_cliente_avulso_varejo_auditoria a
WHERE s.name = 'clientes' AND a.id = 1;

PRAGMA table_info('clientes');
PRAGMA foreign_key_check;
PRAGMA quick_check;

-- Esperado: todas as conferências OK, documento com notnull=0,
-- foreign_key_check sem linhas e quick_check com uma linha "ok".
