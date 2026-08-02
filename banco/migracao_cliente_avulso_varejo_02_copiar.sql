-- ETAPA 2 - Copiar clientes e preservar o AUTOINCREMENT sem escrever em sqlite_sequence.

INSERT INTO clientes_migracao_tmp (
  id, vendedor_id, tipo_pessoa, documento, cnpj, cpf,
  razao_social, nome_estabelecimento, nome_fantasia,
  ie, situacao_ie, responsavel_empresa, responsavel_compra,
  telefone, whatsapp, instagram, email, contato_emergencia,
  cep, endereco, cidade, estado, concorrentes, observacoes_gerais,
  status_comercial, status_cliente, ultima_visita, tipo_cliente,
  created_at, updated_at
)
SELECT
  id, vendedor_id, tipo_pessoa, documento, cnpj, cpf,
  razao_social, nome_estabelecimento, nome_fantasia,
  ie, situacao_ie, responsavel_empresa, responsavel_compra,
  telefone, whatsapp, instagram, email, contato_emergencia,
  cep, endereco, cidade, estado, concorrentes, observacoes_gerais,
  status_comercial, status_cliente, ultima_visita, 'cadastrado',
  created_at, updated_at
FROM clientes;

-- Se a sequência histórica for maior que MAX(id), insere e remove um marcador.
-- O AUTOINCREMENT atualiza sua própria sequência; sqlite_sequence é apenas lida.
INSERT INTO clientes_migracao_tmp (id, tipo_cliente)
SELECT clientes_seq_historica, 'cadastrado'
FROM migracao_cliente_avulso_varejo_auditoria
WHERE id = 1
  AND clientes_seq_historica > COALESCE((SELECT MAX(id) FROM clientes), 0);

DELETE FROM clientes_migracao_tmp
WHERE id > COALESCE((SELECT MAX(id) FROM clientes), 0);

SELECT
  'COPIA_quantidade' AS conferencia,
  (SELECT COUNT(*) FROM clientes) AS origem,
  (SELECT COUNT(*) FROM clientes_migracao_tmp) AS copia,
  CASE
    WHEN (SELECT COUNT(*) FROM clientes) = 115
      AND (SELECT COUNT(*) FROM clientes_migracao_tmp) = 115
    THEN 'OK' ELSE 'ERRO'
  END AS resultado;

SELECT
  'COPIA_ids' AS conferencia,
  COUNT(*) AS ids_diferentes,
  CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERRO' END AS resultado
FROM (
  SELECT id FROM (
    SELECT id FROM clientes EXCEPT SELECT id FROM clientes_migracao_tmp
  )
  UNION ALL
  SELECT id FROM (
    SELECT id FROM clientes_migracao_tmp EXCEPT SELECT id FROM clientes
  )
);

SELECT
  'COPIA_linhas' AS conferencia,
  COUNT(*) AS linhas_diferentes,
  CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'ERRO' END AS resultado
FROM (
  SELECT * FROM (
    SELECT id, vendedor_id, tipo_pessoa, documento, cnpj, cpf, razao_social,
      nome_estabelecimento, nome_fantasia, ie, situacao_ie,
      responsavel_empresa, responsavel_compra, telefone, whatsapp, instagram,
      email, contato_emergencia, cep, endereco, cidade, estado, concorrentes,
      observacoes_gerais, status_comercial, status_cliente, ultima_visita,
      created_at, updated_at FROM clientes
    EXCEPT
    SELECT id, vendedor_id, tipo_pessoa, documento, cnpj, cpf, razao_social,
      nome_estabelecimento, nome_fantasia, ie, situacao_ie,
      responsavel_empresa, responsavel_compra, telefone, whatsapp, instagram,
      email, contato_emergencia, cep, endereco, cidade, estado, concorrentes,
      observacoes_gerais, status_comercial, status_cliente, ultima_visita,
      created_at, updated_at FROM clientes_migracao_tmp
  )
  UNION ALL
  SELECT * FROM (
    SELECT id, vendedor_id, tipo_pessoa, documento, cnpj, cpf, razao_social,
      nome_estabelecimento, nome_fantasia, ie, situacao_ie,
      responsavel_empresa, responsavel_compra, telefone, whatsapp, instagram,
      email, contato_emergencia, cep, endereco, cidade, estado, concorrentes,
      observacoes_gerais, status_comercial, status_cliente, ultima_visita,
      created_at, updated_at FROM clientes_migracao_tmp
    EXCEPT
    SELECT id, vendedor_id, tipo_pessoa, documento, cnpj, cpf, razao_social,
      nome_estabelecimento, nome_fantasia, ie, situacao_ie,
      responsavel_empresa, responsavel_compra, telefone, whatsapp, instagram,
      email, contato_emergencia, cep, endereco, cidade, estado, concorrentes,
      observacoes_gerais, status_comercial, status_cliente, ultima_visita,
      created_at, updated_at FROM clientes
  )
);

SELECT name, seq
FROM sqlite_sequence
WHERE name IN ('clientes', 'clientes_migracao_tmp')
ORDER BY name;

-- Só prossiga quando quantidade=115, ids_diferentes=0 e linhas_diferentes=0.
