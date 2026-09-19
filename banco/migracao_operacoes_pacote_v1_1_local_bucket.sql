-- Gestao Vovo Maria - Operacoes por Pacote V1.1 - Local fisico e retorno de troca
-- Migration incremental. Nao altera migrations historicas nem reinterpreta registros legados.
-- Movimentos anteriores recebem local_id NULL e usam local_carga_id como fallback
-- historico nas consultas. Movimentos novos devem informar local_id.

PRAGMA foreign_keys=ON;

DROP TRIGGER IF EXISTS trg_estoque_pacote_operacao_inserir;
DROP TRIGGER IF EXISTS trg_estoque_pacote_movimento_inserir;
DROP TRIGGER IF EXISTS trg_estoque_pacote_movimento_atualizar;
DROP TRIGGER IF EXISTS trg_estoque_pacote_movimento_excluir;
DROP TRIGGER IF EXISTS trg_estoque_pacote_confirmar;
DROP TRIGGER IF EXISTS trg_estoque_pacote_estorno_confirmado;
DROP TRIGGER IF EXISTS trg_estoque_pacote_operacao_atualizar;
DROP TRIGGER IF EXISTS trg_estoque_pacote_operacao_excluir;

DROP INDEX IF EXISTS idx_estoque_pacote_mov_saldo;
DROP INDEX IF EXISTS idx_estoque_pacote_mov_carga;

ALTER TABLE estoque_pacote_movimentacoes RENAME TO estoque_pacote_movimentacoes_legado;

CREATE TABLE estoque_pacote_movimentacoes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 operacao_id INTEGER NOT NULL CHECK(operacao_id>0),
 carga_id INTEGER NOT NULL CHECK(carga_id>0),
 local_carga_id INTEGER NOT NULL CHECK(local_carga_id>0),
 local_id INTEGER CHECK(local_id IS NULL OR local_id>0),
 produto_id INTEGER NOT NULL CHECK(produto_id>0),
 bucket TEXT NOT NULL CHECK(bucket IN('FRACIONADO_NOVO','RETORNO_TROCA','DESCARTE_PENDENTE')),
 quantidade_pacotes INTEGER NOT NULL CHECK(
  typeof(quantidade_pacotes)='integer' AND quantidade_pacotes>0),
 efeito INTEGER NOT NULL CHECK(efeito IN(-1,1)),
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(operacao_id,produto_id,bucket,efeito),
 FOREIGN KEY(operacao_id) REFERENCES estoque_pacote_operacoes(id) ON DELETE RESTRICT,
 FOREIGN KEY(carga_id) REFERENCES estoque_cargas(id) ON DELETE RESTRICT,
 FOREIGN KEY(local_carga_id) REFERENCES estoque_locais(id) ON DELETE RESTRICT,
 FOREIGN KEY(local_id) REFERENCES estoque_locais(id) ON DELETE RESTRICT,
 FOREIGN KEY(produto_id) REFERENCES produtos(id) ON DELETE RESTRICT
);

INSERT INTO estoque_pacote_movimentacoes(
 id,operacao_id,carga_id,local_carga_id,local_id,produto_id,bucket,quantidade_pacotes,efeito,created_at
)
SELECT id,operacao_id,carga_id,local_carga_id,NULL,produto_id,bucket,quantidade_pacotes,efeito,created_at
FROM estoque_pacote_movimentacoes_legado;

DROP TABLE estoque_pacote_movimentacoes_legado;

CREATE INDEX idx_estoque_pacote_mov_saldo
 ON estoque_pacote_movimentacoes(local_id,produto_id,bucket);
CREATE INDEX idx_estoque_pacote_mov_saldo_compat
 ON estoque_pacote_movimentacoes(local_carga_id,produto_id,bucket);
CREATE INDEX idx_estoque_pacote_mov_carga
 ON estoque_pacote_movimentacoes(carga_id,produto_id);

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
   AND m.bucket='FRACIONADO_NOVO' AND m.efeito=1 AND m.quantidade_pacotes=NEW.quantidade_pacotes
   AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id)
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
   AND m.bucket='FRACIONADO_NOVO' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes
   AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id)
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='RETORNO_TROCA' AND m.efeito=1 AND m.quantidade_pacotes=NEW.quantidade_pacotes
   AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id))
  THEN RAISE(ABORT,'troca incompleta ou incoerente') END;
 SELECT CASE WHEN NEW.tipo IN('DEGUSTACAO','BONIFICACAO_PACOTE') AND(
  (SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='FRACIONADO_NOVO' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes
   AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id))
  THEN RAISE(ABORT,'consumo incompleto ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='CONFIRMACAO_DESCARTE' AND(
  (SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1
  OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id
   AND m.bucket='DESCARTE_PENDENTE' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes
   AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id))
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
     AND coalesce(me.local_id,me.local_carga_id)=coalesce(mo.local_id,mo.local_carga_id)
     AND me.produto_id=mo.produto_id AND me.bucket=mo.bucket
     AND me.quantidade_pacotes=mo.quantidade_pacotes AND me.efeito=-mo.efeito)))
  THEN RAISE(ABORT,'estorno nao e inverso integral') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM(
  SELECT 'FRACIONADO_NOVO' bucket UNION ALL SELECT 'RETORNO_TROCA' UNION ALL SELECT 'DESCARTE_PENDENTE') b WHERE
  coalesce((SELECT sum(m.quantidade_pacotes*m.efeito) FROM estoque_pacote_movimentacoes m
   JOIN estoque_pacote_operacoes o ON o.id=m.operacao_id
   WHERE o.status IN('CONFIRMADA','ESTORNADA')
   AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id
   AND m.produto_id=NEW.produto_id AND m.bucket=b.bucket),0)
  +coalesce((SELECT sum(m.quantidade_pacotes*m.efeito) FROM estoque_pacote_movimentacoes m
   WHERE m.operacao_id=NEW.id AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id
   AND m.bucket=b.bucket),0)<0)
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

-- POS-FLIGHT: validar foreign_key_check/quick_check e os triggers acima.
