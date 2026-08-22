-- Gestao Vovo Maria - Operacoes por Pacote V1
-- Migration aditiva, ainda nao publicada e NAO REEXECUTAVEL.
-- Aplicacao futura: wrangler d1 execute --file, sem BEGIN/COMMIT no arquivo.
-- Nao cria redistribuicao, devolucao, venda, pagamento ou comissao e nao
-- altera dados de Producao Oficial ou Producao Teste.
--
-- PREFLIGHT SOMENTE LEITURA (executar separadamente):
-- PRAGMA table_info('produtos');
-- PRAGMA table_info('visitas');
-- PRAGMA table_info('clientes');
-- PRAGMA table_info('clientes_avulsos');
-- PRAGMA table_info('vendedores');
-- PRAGMA table_info('estoque_locais');
-- PRAGMA table_info('estoque_cargas');
-- PRAGMA table_info('estoque_operacoes');
-- PRAGMA table_info('estoque_movimentacoes');
-- PRAGMA table_info('producao_parametros_produto');
-- SELECT produto_id, COUNT(*) FROM producao_parametros_produto
--  WHERE ativo=1 GROUP BY produto_id HAVING COUNT(*)>1;
-- SELECT * FROM producao_parametros_produto WHERE ativo=1 AND
--  (typeof(pacotes_por_fardo)<>'integer' OR pacotes_por_fardo<=0);
-- SELECT p.id,p.nome FROM produtos p WHERE p.ativo='ativo' AND NOT EXISTS
--  (SELECT 1 FROM producao_parametros_produto pp WHERE pp.produto_id=p.id
--   AND pp.ativo=1 AND typeof(pp.pacotes_por_fardo)='integer'
--   AND pp.pacotes_por_fardo>0);
-- SELECT name,type,sql FROM sqlite_master WHERE name IN
--  ('estoque_pacote_operacoes','estoque_pacote_movimentacoes',
--   'bonificacao_fardo_solicitacoes')
--  OR name LIKE 'trg_estoque_pacote_%' OR name LIKE 'trg_bonificacao_fardo_%';
-- PRAGMA foreign_key_check;
-- PRAGMA quick_check;
-- Confirmar tabelas/colunas exigidas, integridade e ausencia previa da coluna,
-- tabelas, indices e triggers desta migration. Nao adicionar BEGIN/COMMIT.

PRAGMA foreign_keys=ON;

ALTER TABLE produtos ADD COLUMN pacotes_por_fardo INTEGER NULL
 CHECK(pacotes_por_fardo IS NULL OR
  (typeof(pacotes_por_fardo)='integer' AND pacotes_por_fardo>0));

-- Legado duplicado: vence deterministicamente updated_at/created_at mais
-- recente e, no empate, id maior. Invalidos sao ignorados; NULL e preservado.
UPDATE produtos SET pacotes_por_fardo=(
 SELECT pp.pacotes_por_fardo FROM producao_parametros_produto pp
 WHERE pp.produto_id=produtos.id AND pp.ativo=1
  AND typeof(pp.pacotes_por_fardo)='integer' AND pp.pacotes_por_fardo>0
 ORDER BY COALESCE(pp.updated_at,pp.created_at,'') DESC,pp.id DESC LIMIT 1
) WHERE pacotes_por_fardo IS NULL AND EXISTS(
 SELECT 1 FROM producao_parametros_produto pp
 WHERE pp.produto_id=produtos.id AND pp.ativo=1
  AND typeof(pp.pacotes_por_fardo)='integer' AND pp.pacotes_por_fardo>0);

CREATE TABLE estoque_pacote_operacoes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 tipo TEXT NOT NULL CHECK(tipo IN('ABERTURA_FARDO','TROCA','DEGUSTACAO',
  'BONIFICACAO_PACOTE','CONFIRMACAO_DESCARTE','ESTORNO')),
 status TEXT NOT NULL DEFAULT 'PREPARANDO'
  CHECK(status IN('PREPARANDO','CONFIRMADA','ESTORNADA')),
 carga_id INTEGER NOT NULL CHECK(carga_id>0),
 local_carga_id INTEGER NOT NULL CHECK(local_carga_id>0),
 vendedor_id INTEGER NOT NULL CHECK(vendedor_id>0),
 produto_id INTEGER NOT NULL CHECK(produto_id>0),
 quantidade_pacotes INTEGER NOT NULL CHECK(
  typeof(quantidade_pacotes)='integer' AND quantidade_pacotes>0),
 pacotes_por_fardo_snapshot INTEGER CHECK(pacotes_por_fardo_snapshot IS NULL OR
  (typeof(pacotes_por_fardo_snapshot)='integer' AND pacotes_por_fardo_snapshot>0)),
 estoque_operacao_fardo_id INTEGER CHECK(
  estoque_operacao_fardo_id IS NULL OR estoque_operacao_fardo_id>0),
 visita_id INTEGER CHECK(visita_id IS NULL OR visita_id>0),
 cliente_id INTEGER CHECK(cliente_id IS NULL OR cliente_id>0),
 cliente_avulso_id INTEGER CHECK(cliente_avulso_id IS NULL OR cliente_avulso_id>0),
 motivo TEXT CHECK(motivo IS NULL OR length(trim(motivo)) BETWEEN 1 AND 120),
 observacao TEXT CHECK(observacao IS NULL OR length(trim(observacao)) BETWEEN 1 AND 500),
 chave_idempotencia TEXT NOT NULL UNIQUE
  CHECK(length(trim(chave_idempotencia)) BETWEEN 1 AND 180),
 idempotencia_hash TEXT NOT NULL CHECK(length(trim(idempotencia_hash)) BETWEEN 1 AND 128),
 operacao_estornada_id INTEGER CHECK(operacao_estornada_id IS NULL OR operacao_estornada_id>0),
 usuario_id INTEGER NOT NULL CHECK(usuario_id>0),
 data_operacao TEXT NOT NULL CHECK(length(data_operacao)=10 AND
  data_operacao GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 confirmado_em DATETIME,
 estornada_em DATETIME,
 CHECK((tipo='ABERTURA_FARDO' AND pacotes_por_fardo_snapshot IS NOT NULL
   AND quantidade_pacotes=pacotes_por_fardo_snapshot AND estoque_operacao_fardo_id IS NOT NULL)
  OR(tipo<>'ABERTURA_FARDO' AND pacotes_por_fardo_snapshot IS NULL
   AND estoque_operacao_fardo_id IS NULL)),
 CHECK((tipo IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND visita_id IS NOT NULL
   AND((cliente_id IS NOT NULL)<>(cliente_avulso_id IS NOT NULL)))
  OR(tipo NOT IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND visita_id IS NULL
   AND cliente_id IS NULL AND cliente_avulso_id IS NULL)),
 CHECK(tipo<>'TROCA' OR motivo IS NOT NULL),
 CHECK((tipo='ESTORNO' AND operacao_estornada_id IS NOT NULL)
  OR(tipo<>'ESTORNO' AND operacao_estornada_id IS NULL)),
 CHECK(operacao_estornada_id IS NULL OR operacao_estornada_id<>id),
 CHECK((status='PREPARANDO' AND confirmado_em IS NULL AND estornada_em IS NULL)
  OR(status='CONFIRMADA' AND confirmado_em IS NOT NULL AND estornada_em IS NULL)
  OR(status='ESTORNADA' AND confirmado_em IS NOT NULL AND estornada_em IS NOT NULL)),
 FOREIGN KEY(carga_id) REFERENCES estoque_cargas(id) ON DELETE RESTRICT,
 FOREIGN KEY(local_carga_id) REFERENCES estoque_locais(id) ON DELETE RESTRICT,
 FOREIGN KEY(vendedor_id) REFERENCES vendedores(id) ON DELETE RESTRICT,
 FOREIGN KEY(produto_id) REFERENCES produtos(id) ON DELETE RESTRICT,
 FOREIGN KEY(estoque_operacao_fardo_id) REFERENCES estoque_operacoes(id) ON DELETE RESTRICT,
 FOREIGN KEY(visita_id) REFERENCES visitas(id) ON DELETE RESTRICT,
 FOREIGN KEY(cliente_id) REFERENCES clientes(id) ON DELETE RESTRICT,
 FOREIGN KEY(cliente_avulso_id) REFERENCES clientes_avulsos(id) ON DELETE RESTRICT,
 FOREIGN KEY(operacao_estornada_id) REFERENCES estoque_pacote_operacoes(id) ON DELETE RESTRICT,
 FOREIGN KEY(usuario_id) REFERENCES vendedores(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX uq_estoque_pacote_estorno_unico ON estoque_pacote_operacoes(operacao_estornada_id)
 WHERE operacao_estornada_id IS NOT NULL;
CREATE UNIQUE INDEX uq_estoque_pacote_abertura_unica ON estoque_pacote_operacoes(estoque_operacao_fardo_id)
 WHERE estoque_operacao_fardo_id IS NOT NULL;
CREATE INDEX idx_estoque_pacote_operacoes_carga ON estoque_pacote_operacoes(carga_id,data_operacao,tipo,status);
CREATE INDEX idx_estoque_pacote_operacoes_local ON estoque_pacote_operacoes(local_carga_id,vendedor_id,data_operacao);
CREATE INDEX idx_estoque_pacote_operacoes_visita ON estoque_pacote_operacoes(visita_id) WHERE visita_id IS NOT NULL;

CREATE TABLE estoque_pacote_movimentacoes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 operacao_id INTEGER NOT NULL CHECK(operacao_id>0),
 carga_id INTEGER NOT NULL CHECK(carga_id>0),
 local_carga_id INTEGER NOT NULL CHECK(local_carga_id>0),
 produto_id INTEGER NOT NULL CHECK(produto_id>0),
 bucket TEXT NOT NULL CHECK(bucket IN('FRACIONADO_NOVO','DESCARTE_PENDENTE')),
 quantidade_pacotes INTEGER NOT NULL CHECK(
  typeof(quantidade_pacotes)='integer' AND quantidade_pacotes>0),
 efeito INTEGER NOT NULL CHECK(efeito IN(-1,1)),
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(operacao_id,produto_id,bucket,efeito),
 FOREIGN KEY(operacao_id) REFERENCES estoque_pacote_operacoes(id) ON DELETE RESTRICT,
 FOREIGN KEY(carga_id) REFERENCES estoque_cargas(id) ON DELETE RESTRICT,
 FOREIGN KEY(local_carga_id) REFERENCES estoque_locais(id) ON DELETE RESTRICT,
 FOREIGN KEY(produto_id) REFERENCES produtos(id) ON DELETE RESTRICT
);
CREATE INDEX idx_estoque_pacote_mov_saldo ON estoque_pacote_movimentacoes(local_carga_id,produto_id,bucket);
CREATE INDEX idx_estoque_pacote_mov_carga ON estoque_pacote_movimentacoes(carga_id,produto_id);

CREATE TRIGGER trg_estoque_pacote_operacao_inserir BEFORE INSERT ON estoque_pacote_operacoes BEGIN
 SELECT CASE WHEN NEW.status<>'PREPARANDO' THEN RAISE(ABORT,'operacao deve nascer PREPARANDO') END;
END;
CREATE TRIGGER trg_estoque_pacote_movimento_inserir BEFORE INSERT ON estoque_pacote_movimentacoes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o
  WHERE o.id=NEW.operacao_id AND o.status='PREPARANDO' AND o.carga_id=NEW.carga_id
   AND o.local_carga_id=NEW.local_carga_id AND o.produto_id=NEW.produto_id)
  THEN RAISE(ABORT,'movimento incoerente ou operacao nao PREPARANDO') END;
END;
CREATE TRIGGER trg_estoque_pacote_movimento_atualizar BEFORE UPDATE ON estoque_pacote_movimentacoes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o
  WHERE o.id=OLD.operacao_id AND o.status='PREPARANDO')
  THEN RAISE(ABORT,'movimento confirmado e imutavel') END;
 SELECT CASE WHEN NEW.operacao_id<>OLD.operacao_id OR NOT EXISTS(
  SELECT 1 FROM estoque_pacote_operacoes o WHERE o.id=NEW.operacao_id
   AND o.status='PREPARANDO' AND o.carga_id=NEW.carga_id
   AND o.local_carga_id=NEW.local_carga_id AND o.produto_id=NEW.produto_id)
  THEN RAISE(ABORT,'movimento atualizado incoerente') END;
END;
CREATE TRIGGER trg_estoque_pacote_movimento_excluir BEFORE DELETE ON estoque_pacote_movimentacoes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o
  WHERE o.id=OLD.operacao_id AND o.status='PREPARANDO')
  THEN RAISE(ABORT,'movimento confirmado nao pode ser excluido') END;
END;

CREATE TRIGGER trg_estoque_pacote_confirmar BEFORE UPDATE OF status ON estoque_pacote_operacoes
WHEN OLD.status='PREPARANDO' AND NEW.status='CONFIRMADA' BEGIN
 SELECT CASE WHEN NEW.confirmado_em IS NULL THEN RAISE(ABORT,'confirmado_em obrigatorio') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_cargas c WHERE c.id=NEW.carga_id
  AND c.vendedor_id=NEW.vendedor_id AND c.local_carga_id=NEW.local_carga_id
  AND((NEW.tipo='CONFIRMACAO_DESCARTE' AND c.status IN('ABERTA','FECHADA'))
   OR(NEW.tipo<>'CONFIRMACAO_DESCARTE' AND c.status='ABERTA')))
  THEN RAISE(ABORT,'carga local vendedor ou status incoerente') END;
 SELECT CASE WHEN NEW.tipo IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND NOT EXISTS(
  SELECT 1 FROM visitas v WHERE v.id=NEW.visita_id AND v.vendedor_id=NEW.vendedor_id
   AND coalesce(v.cliente_id,0)=coalesce(NEW.cliente_id,0)
   AND coalesce(v.cliente_avulso_id,0)=coalesce(NEW.cliente_avulso_id,0))
  THEN RAISE(ABORT,'visita vendedor ou cliente incoerente') END;
 SELECT CASE WHEN NEW.tipo IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND NOT EXISTS(
  SELECT 1 FROM visitas v WHERE v.id=NEW.visita_id AND v.status_registro='ATIVA')
  THEN RAISE(ABORT,'visita nao esta ativa para operacao comercial') END;
 SELECT CASE WHEN NEW.tipo='CONFIRMACAO_DESCARTE' AND NOT EXISTS(
  SELECT 1 FROM vendedores u WHERE u.id=NEW.usuario_id AND u.status='ativo'
   AND u.role IN('admin','operacao')) THEN RAISE(ABORT,'descarte exige admin ou operacao') END;
 SELECT CASE WHEN NEW.tipo='ABERTURA_FARDO' AND(
  (SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='FRACIONADO_NOVO' AND m.efeito=1 AND m.quantidade_pacotes=NEW.quantidade_pacotes)
  OR NOT EXISTS(SELECT 1 FROM estoque_operacoes eo WHERE eo.id=NEW.estoque_operacao_fardo_id
   AND eo.tipo='ABERTURA_FARDO' AND eo.status='CONFIRMADA'
   AND eo.origem_tipo='CARGA' AND eo.origem_id=NEW.carga_id
   AND(SELECT count(*) FROM estoque_movimentacoes em WHERE em.operacao_id=eo.id)=1
   AND EXISTS(SELECT 1 FROM estoque_movimentacoes em WHERE em.operacao_id=eo.id
    AND em.carga_id=NEW.carga_id AND em.local_id=NEW.local_carga_id
    AND em.produto_id=NEW.produto_id AND em.quantidade=1 AND em.efeito=-1)))
  THEN RAISE(ABORT,'abertura incompleta ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='TROCA' AND(
  (SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>2
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='FRACIONADO_NOVO' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes)
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='DESCARTE_PENDENTE' AND m.efeito=1 AND m.quantidade_pacotes=NEW.quantidade_pacotes))
  THEN RAISE(ABORT,'troca incompleta ou incoerente') END;
 SELECT CASE WHEN NEW.tipo IN('DEGUSTACAO','BONIFICACAO_PACOTE') AND(
  (SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='FRACIONADO_NOVO' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes))
  THEN RAISE(ABORT,'consumo incompleto ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='CONFIRMACAO_DESCARTE' AND(
  (SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='DESCARTE_PENDENTE' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes))
  THEN RAISE(ABORT,'descarte incompleto ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='ESTORNO' AND NOT EXISTS(
  SELECT 1 FROM estoque_pacote_operacoes o WHERE o.id=NEW.operacao_estornada_id
   AND o.status='CONFIRMADA' AND o.tipo<>'ESTORNO' AND o.carga_id=NEW.carga_id
   AND o.local_carga_id=NEW.local_carga_id AND o.vendedor_id=NEW.vendedor_id
   AND o.produto_id=NEW.produto_id AND o.quantidade_pacotes=NEW.quantidade_pacotes
   AND(SELECT count(*) FROM estoque_pacote_movimentacoes mo WHERE mo.operacao_id=o.id)
    =(SELECT count(*) FROM estoque_pacote_movimentacoes me WHERE me.operacao_id=NEW.id)
   AND NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes mo WHERE mo.operacao_id=o.id
    AND NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes me WHERE me.operacao_id=NEW.id
     AND me.carga_id=mo.carga_id AND me.local_carga_id=mo.local_carga_id
     AND me.produto_id=mo.produto_id AND me.bucket=mo.bucket
     AND me.quantidade_pacotes=mo.quantidade_pacotes AND me.efeito=-mo.efeito)))
  THEN RAISE(ABORT,'estorno nao e inverso integral') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM(
  SELECT 'FRACIONADO_NOVO' bucket UNION ALL SELECT 'DESCARTE_PENDENTE') b WHERE
  coalesce((SELECT sum(m.quantidade_pacotes*m.efeito) FROM estoque_pacote_movimentacoes m
   JOIN estoque_pacote_operacoes o ON o.id=m.operacao_id
   WHERE o.status IN('CONFIRMADA','ESTORNADA')
   AND m.local_carga_id=NEW.local_carga_id AND m.produto_id=NEW.produto_id AND m.bucket=b.bucket),0)
  +coalesce((SELECT sum(m.quantidade_pacotes*m.efeito) FROM estoque_pacote_movimentacoes m
   WHERE m.operacao_id=NEW.id AND m.bucket=b.bucket),0)<0)
  THEN RAISE(ABORT,'saldo de pacotes insuficiente') END;
END;

CREATE TRIGGER trg_estoque_pacote_estorno_confirmado AFTER UPDATE OF status ON estoque_pacote_operacoes
WHEN OLD.status='PREPARANDO' AND NEW.status='CONFIRMADA' AND NEW.tipo='ESTORNO' BEGIN
 UPDATE estoque_pacote_operacoes SET status='ESTORNADA',estornada_em=NEW.confirmado_em
  WHERE id=NEW.operacao_estornada_id AND status='CONFIRMADA';
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'original nao estornada') END;
END;
CREATE TRIGGER trg_estoque_pacote_operacao_atualizar BEFORE UPDATE ON estoque_pacote_operacoes
WHEN OLD.status<>'PREPARANDO' BEGIN
 SELECT CASE WHEN NOT(OLD.status='CONFIRMADA' AND NEW.status='ESTORNADA'
  AND NEW.estornada_em IS NOT NULL AND OLD.id=NEW.id AND OLD.tipo=NEW.tipo
  AND OLD.carga_id=NEW.carga_id AND OLD.local_carga_id=NEW.local_carga_id
  AND OLD.vendedor_id=NEW.vendedor_id AND OLD.produto_id=NEW.produto_id
  AND OLD.quantidade_pacotes=NEW.quantidade_pacotes AND EXISTS(
   SELECT 1 FROM estoque_pacote_operacoes e WHERE e.tipo='ESTORNO'
    AND e.status='CONFIRMADA' AND e.operacao_estornada_id=OLD.id))
  THEN RAISE(ABORT,'operacao confirmada e imutavel') END;
END;
CREATE TRIGGER trg_estoque_pacote_operacao_excluir BEFORE DELETE ON estoque_pacote_operacoes BEGIN
 SELECT CASE WHEN OLD.status<>'PREPARANDO' THEN RAISE(ABORT,'operacao confirmada nao pode ser excluida') END;
END;

CREATE TABLE bonificacao_fardo_solicitacoes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 status TEXT NOT NULL DEFAULT 'PENDENTE' CHECK(status IN('PENDENTE','APROVADA','REJEITADA','ENTREGUE','CANCELADA')),
 carga_id INTEGER NOT NULL CHECK(carga_id>0),local_carga_id INTEGER NOT NULL CHECK(local_carga_id>0),
 visita_id INTEGER NOT NULL CHECK(visita_id>0),cliente_id INTEGER CHECK(cliente_id IS NULL OR cliente_id>0),
 cliente_avulso_id INTEGER CHECK(cliente_avulso_id IS NULL OR cliente_avulso_id>0),
 produto_id INTEGER NOT NULL CHECK(produto_id>0),
 quantidade_fardos INTEGER NOT NULL CHECK(typeof(quantidade_fardos)='integer' AND quantidade_fardos>0),
 vendedor_id INTEGER NOT NULL CHECK(vendedor_id>0),solicitado_por INTEGER NOT NULL CHECK(solicitado_por>0),
 motivo TEXT NOT NULL CHECK(length(trim(motivo)) BETWEEN 1 AND 500),
 chave_idempotencia TEXT NOT NULL UNIQUE CHECK(length(trim(chave_idempotencia)) BETWEEN 1 AND 180),
 idempotencia_hash TEXT NOT NULL CHECK(length(trim(idempotencia_hash)) BETWEEN 1 AND 128),
 solicitada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 decidido_por INTEGER CHECK(decidido_por IS NULL OR decidido_por>0),decidida_em DATETIME,
 motivo_decisao TEXT CHECK(motivo_decisao IS NULL OR length(trim(motivo_decisao)) BETWEEN 1 AND 500),
 chave_decisao TEXT CHECK(chave_decisao IS NULL OR length(trim(chave_decisao)) BETWEEN 1 AND 180),
 idempotencia_hash_decisao TEXT CHECK(idempotencia_hash_decisao IS NULL OR length(trim(idempotencia_hash_decisao)) BETWEEN 1 AND 128),
 entregue_por INTEGER CHECK(entregue_por IS NULL OR entregue_por>0),entregue_em DATETIME,
 chave_entrega TEXT CHECK(chave_entrega IS NULL OR length(trim(chave_entrega)) BETWEEN 1 AND 180),
 idempotencia_hash_entrega TEXT CHECK(idempotencia_hash_entrega IS NULL OR length(trim(idempotencia_hash_entrega)) BETWEEN 1 AND 128),
 estoque_operacao_fardo_id INTEGER CHECK(estoque_operacao_fardo_id IS NULL OR estoque_operacao_fardo_id>0),
 cancelada_por INTEGER CHECK(cancelada_por IS NULL OR cancelada_por>0),cancelada_em DATETIME,
 chave_cancelamento TEXT CHECK(chave_cancelamento IS NULL OR length(trim(chave_cancelamento)) BETWEEN 1 AND 180),
 idempotencia_hash_cancelamento TEXT CHECK(idempotencia_hash_cancelamento IS NULL OR length(trim(idempotencia_hash_cancelamento)) BETWEEN 1 AND 128),
 motivo_cancelamento TEXT CHECK(motivo_cancelamento IS NULL OR length(trim(motivo_cancelamento)) BETWEEN 1 AND 500),
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(estoque_operacao_fardo_id),CHECK((cliente_id IS NOT NULL)<>(cliente_avulso_id IS NOT NULL)),
 CHECK((status='PENDENTE' AND decidido_por IS NULL AND decidida_em IS NULL AND motivo_decisao IS NULL
   AND chave_decisao IS NULL AND idempotencia_hash_decisao IS NULL AND entregue_por IS NULL
   AND entregue_em IS NULL AND chave_entrega IS NULL AND idempotencia_hash_entrega IS NULL
   AND estoque_operacao_fardo_id IS NULL AND cancelada_por IS NULL AND cancelada_em IS NULL
   AND chave_cancelamento IS NULL AND idempotencia_hash_cancelamento IS NULL AND motivo_cancelamento IS NULL)
  OR(status='APROVADA' AND decidido_por IS NOT NULL AND decidida_em IS NOT NULL AND chave_decisao IS NOT NULL
   AND idempotencia_hash_decisao IS NOT NULL AND entregue_por IS NULL AND entregue_em IS NULL
   AND chave_entrega IS NULL AND idempotencia_hash_entrega IS NULL AND estoque_operacao_fardo_id IS NULL
   AND cancelada_por IS NULL AND cancelada_em IS NULL AND chave_cancelamento IS NULL
   AND idempotencia_hash_cancelamento IS NULL AND motivo_cancelamento IS NULL)
  OR(status='REJEITADA' AND decidido_por IS NOT NULL AND decidida_em IS NOT NULL AND motivo_decisao IS NOT NULL
   AND chave_decisao IS NOT NULL AND idempotencia_hash_decisao IS NOT NULL AND entregue_por IS NULL
   AND entregue_em IS NULL AND chave_entrega IS NULL AND idempotencia_hash_entrega IS NULL
   AND estoque_operacao_fardo_id IS NULL AND cancelada_por IS NULL AND cancelada_em IS NULL
   AND chave_cancelamento IS NULL AND idempotencia_hash_cancelamento IS NULL AND motivo_cancelamento IS NULL)
  OR(status='ENTREGUE' AND decidido_por IS NOT NULL AND decidida_em IS NOT NULL AND chave_decisao IS NOT NULL
   AND idempotencia_hash_decisao IS NOT NULL AND entregue_por IS NOT NULL AND entregue_em IS NOT NULL
   AND chave_entrega IS NOT NULL AND idempotencia_hash_entrega IS NOT NULL AND estoque_operacao_fardo_id IS NOT NULL
   AND cancelada_por IS NULL AND cancelada_em IS NULL AND chave_cancelamento IS NULL
   AND idempotencia_hash_cancelamento IS NULL AND motivo_cancelamento IS NULL)
  OR(status='CANCELADA' AND decidido_por IS NULL AND decidida_em IS NULL AND motivo_decisao IS NULL
   AND chave_decisao IS NULL AND idempotencia_hash_decisao IS NULL AND entregue_por IS NULL
   AND entregue_em IS NULL AND chave_entrega IS NULL AND idempotencia_hash_entrega IS NULL
   AND estoque_operacao_fardo_id IS NULL AND cancelada_por IS NOT NULL AND cancelada_em IS NOT NULL
   AND chave_cancelamento IS NOT NULL AND idempotencia_hash_cancelamento IS NOT NULL
   AND motivo_cancelamento IS NOT NULL)),
 FOREIGN KEY(carga_id) REFERENCES estoque_cargas(id),FOREIGN KEY(local_carga_id) REFERENCES estoque_locais(id),
 FOREIGN KEY(visita_id) REFERENCES visitas(id),FOREIGN KEY(cliente_id) REFERENCES clientes(id),
 FOREIGN KEY(cliente_avulso_id) REFERENCES clientes_avulsos(id),FOREIGN KEY(produto_id) REFERENCES produtos(id),
 FOREIGN KEY(vendedor_id) REFERENCES vendedores(id),FOREIGN KEY(solicitado_por) REFERENCES vendedores(id),
 FOREIGN KEY(decidido_por) REFERENCES vendedores(id),FOREIGN KEY(entregue_por) REFERENCES vendedores(id),
 FOREIGN KEY(cancelada_por) REFERENCES vendedores(id),FOREIGN KEY(estoque_operacao_fardo_id) REFERENCES estoque_operacoes(id)
);
CREATE UNIQUE INDEX uq_bonificacao_fardo_decisao ON bonificacao_fardo_solicitacoes(chave_decisao) WHERE chave_decisao IS NOT NULL;
CREATE UNIQUE INDEX uq_bonificacao_fardo_entrega ON bonificacao_fardo_solicitacoes(chave_entrega) WHERE chave_entrega IS NOT NULL;
CREATE UNIQUE INDEX uq_bonificacao_fardo_cancelamento ON bonificacao_fardo_solicitacoes(chave_cancelamento) WHERE chave_cancelamento IS NOT NULL;
CREATE INDEX idx_bonificacao_fardo_status ON bonificacao_fardo_solicitacoes(status,solicitada_em);
CREATE INDEX idx_bonificacao_fardo_vendedor ON bonificacao_fardo_solicitacoes(vendedor_id,status,solicitada_em);
CREATE INDEX idx_bonificacao_fardo_carga ON bonificacao_fardo_solicitacoes(carga_id,produto_id,status);
CREATE INDEX idx_bonificacao_fardo_visita ON bonificacao_fardo_solicitacoes(visita_id);

CREATE TRIGGER trg_bonificacao_fardo_inserir BEFORE INSERT ON bonificacao_fardo_solicitacoes BEGIN
 SELECT CASE WHEN NEW.status<>'PENDENTE' OR NEW.solicitado_por<>NEW.vendedor_id
  OR NOT EXISTS(SELECT 1 FROM vendedores u WHERE u.id=NEW.solicitado_por AND u.role='vendedor' AND u.status='ativo')
  OR NOT EXISTS(SELECT 1 FROM estoque_cargas c WHERE c.id=NEW.carga_id AND c.status='ABERTA'
   AND c.vendedor_id=NEW.vendedor_id AND c.local_carga_id=NEW.local_carga_id)
  OR NOT EXISTS(SELECT 1 FROM visitas v WHERE v.id=NEW.visita_id AND v.vendedor_id=NEW.vendedor_id
   AND coalesce(v.cliente_id,0)=coalesce(NEW.cliente_id,0)
   AND coalesce(v.cliente_avulso_id,0)=coalesce(NEW.cliente_avulso_id,0))
  THEN RAISE(ABORT,'solicitacao incoerente') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM visitas v
  WHERE v.id=NEW.visita_id AND v.status_registro='ATIVA')
  THEN RAISE(ABORT,'visita nao esta ativa para solicitacao de bonificacao') END;
END;
CREATE TRIGGER trg_bonificacao_fardo_atualizar BEFORE UPDATE ON bonificacao_fardo_solicitacoes BEGIN
 SELECT CASE WHEN NEW.carga_id<>OLD.carga_id OR NEW.local_carga_id<>OLD.local_carga_id
  OR NEW.visita_id<>OLD.visita_id OR coalesce(NEW.cliente_id,0)<>coalesce(OLD.cliente_id,0)
  OR coalesce(NEW.cliente_avulso_id,0)<>coalesce(OLD.cliente_avulso_id,0)
  OR NEW.produto_id<>OLD.produto_id OR NEW.quantidade_fardos<>OLD.quantidade_fardos
  OR NEW.vendedor_id<>OLD.vendedor_id OR NEW.solicitado_por<>OLD.solicitado_por
  OR NEW.motivo<>OLD.motivo OR NEW.chave_idempotencia<>OLD.chave_idempotencia
  OR NEW.idempotencia_hash<>OLD.idempotencia_hash OR NEW.solicitada_em<>OLD.solicitada_em
  OR(OLD.status='APROVADA' AND(
   NEW.decidido_por<>OLD.decidido_por OR NEW.decidida_em<>OLD.decidida_em
   OR coalesce(NEW.motivo_decisao,'')<>coalesce(OLD.motivo_decisao,'')
   OR NEW.chave_decisao<>OLD.chave_decisao
   OR NEW.idempotencia_hash_decisao<>OLD.idempotencia_hash_decisao))
  THEN RAISE(ABORT,'dados imutaveis') END;
 SELECT CASE WHEN NOT((OLD.status='PENDENTE' AND NEW.status IN('APROVADA','REJEITADA','CANCELADA'))
  OR(OLD.status='APROVADA' AND NEW.status='ENTREGUE')) THEN RAISE(ABORT,'transicao invalida') END;
 SELECT CASE WHEN NEW.status IN('APROVADA','REJEITADA') AND(NOT EXISTS(
  SELECT 1 FROM vendedores u WHERE u.id=NEW.decidido_por AND u.role='admin' AND u.status='ativo')
  OR NEW.decidida_em<NEW.solicitada_em) THEN RAISE(ABORT,'decisao invalida') END;
 SELECT CASE WHEN NEW.status IN('APROVADA','ENTREGUE') AND NOT EXISTS(
  SELECT 1 FROM visitas v WHERE v.id=NEW.visita_id AND v.status_registro='ATIVA')
  THEN RAISE(ABORT,'visita nao esta ativa para progressao da bonificacao') END;
 SELECT CASE WHEN NEW.status='ENTREGUE' AND(NEW.entregue_por<>NEW.vendedor_id
  OR NEW.entregue_em<OLD.decidida_em OR NOT EXISTS(SELECT 1 FROM estoque_cargas c
   WHERE c.id=NEW.carga_id AND c.status='ABERTA' AND c.vendedor_id=NEW.vendedor_id
   AND c.local_carga_id=NEW.local_carga_id) OR NOT EXISTS(SELECT 1 FROM estoque_operacoes eo
   WHERE eo.id=NEW.estoque_operacao_fardo_id AND eo.tipo='BONIFICACAO_FARDO'
   AND eo.status='CONFIRMADA' AND eo.origem_tipo='CARGA' AND eo.origem_id=NEW.carga_id
   AND(SELECT count(*) FROM estoque_movimentacoes em WHERE em.operacao_id=eo.id)=1
   AND EXISTS(SELECT 1 FROM estoque_movimentacoes em WHERE em.operacao_id=eo.id
    AND em.carga_id=NEW.carga_id AND em.local_id=NEW.local_carga_id
    AND em.produto_id=NEW.produto_id AND em.quantidade=NEW.quantidade_fardos AND em.efeito=-1))
  OR(SELECT coalesce(sum(em.quantidade*em.efeito),0) FROM estoque_movimentacoes em
   WHERE em.local_id=NEW.local_carga_id AND em.produto_id=NEW.produto_id)<0)
  THEN RAISE(ABORT,'entrega incoerente ou sem saldo') END;
END;
CREATE TRIGGER trg_bonificacao_fardo_excluir BEFORE DELETE ON bonificacao_fardo_solicitacoes BEGIN
 SELECT RAISE(ABORT,'solicitacao nao pode ser excluida');
END;

-- POS-FLIGHT: repetir PRAGMA foreign_key_check/quick_check e consultar
-- sqlite_master para todos os indices e triggers prefixados acima.
