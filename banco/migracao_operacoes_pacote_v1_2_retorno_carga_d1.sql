-- Gestao Vovo Maria - Operacoes por Pacote V1.2 - Retorno de carga
-- Migration incremental: preserva V1 e V1.1; nao reclassifica historico.
-- Preflight estrito: aborta em estrutura ausente ou aplicacao parcial.

PRAGMA foreign_keys=OFF;


CREATE TABLE IF NOT EXISTS gestao_migracoes_pacote_v1_2 (
  nome TEXT PRIMARY KEY,
  aplicada_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Preflight operacional: a ausencia das tabelas esperadas, a existencia de
-- nomes parciais ou a reaplicacao do marcador causam falha estrutural antes
-- de qualquer copia valida ser confirmada.
INSERT INTO gestao_migracoes_pacote_v1_2(nome) VALUES('migracao_operacoes_pacote_v1_2_retorno_carga');

DROP TRIGGER IF EXISTS trg_estoque_pacote_operacao_inserir;
DROP TRIGGER IF EXISTS trg_estoque_pacote_movimento_inserir;
DROP TRIGGER IF EXISTS trg_estoque_pacote_movimento_atualizar;
DROP TRIGGER IF EXISTS trg_estoque_pacote_movimento_excluir;
DROP TRIGGER IF EXISTS trg_estoque_pacote_confirmar;
DROP TRIGGER IF EXISTS trg_estoque_pacote_estorno_confirmado;
DROP TRIGGER IF EXISTS trg_estoque_pacote_operacao_atualizar;
DROP TRIGGER IF EXISTS trg_estoque_pacote_operacao_excluir;
DROP INDEX IF EXISTS uq_estoque_pacote_estorno_unico;
DROP INDEX IF EXISTS uq_estoque_pacote_abertura_unica;
DROP INDEX IF EXISTS idx_estoque_pacote_operacoes_carga;
DROP INDEX IF EXISTS idx_estoque_pacote_operacoes_local;
DROP INDEX IF EXISTS idx_estoque_pacote_operacoes_visita;
DROP INDEX IF EXISTS idx_estoque_pacote_mov_saldo;
DROP INDEX IF EXISTS idx_estoque_pacote_mov_saldo_compat;
DROP INDEX IF EXISTS idx_estoque_pacote_mov_carga;

ALTER TABLE estoque_pacote_operacoes RENAME TO estoque_pacote_operacoes_v1_2_parcial;
ALTER TABLE estoque_pacote_movimentacoes RENAME TO estoque_pacote_movimentacoes_v1_2_parcial;

CREATE TABLE estoque_pacote_operacoes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 tipo TEXT NOT NULL CHECK(tipo IN('ABERTURA_FARDO','TROCA','DEGUSTACAO',
  'BONIFICACAO_PACOTE','CONFIRMACAO_DESCARTE','ESTORNO','RETORNO_CARGA_PACOTE')),
 status TEXT NOT NULL DEFAULT 'PREPARANDO'
  CHECK(status IN('PREPARANDO','CONFIRMADA','ESTORNADA')),
 carga_id INTEGER NOT NULL CHECK(carga_id>0),
 local_carga_id INTEGER NOT NULL CHECK(local_carga_id>0),
 vendedor_id INTEGER NOT NULL CHECK(vendedor_id>0),
 produto_id INTEGER NOT NULL CHECK(produto_id>0),
 quantidade_pacotes INTEGER NOT NULL CHECK(typeof(quantidade_pacotes)='integer' AND quantidade_pacotes>0),
 pacotes_por_fardo_snapshot INTEGER CHECK(pacotes_por_fardo_snapshot IS NULL OR (typeof(pacotes_por_fardo_snapshot)='integer' AND pacotes_por_fardo_snapshot>0)),
 estoque_operacao_fardo_id INTEGER CHECK(estoque_operacao_fardo_id IS NULL OR estoque_operacao_fardo_id>0),
 visita_id INTEGER CHECK(visita_id IS NULL OR visita_id>0),
 cliente_id INTEGER CHECK(cliente_id IS NULL OR cliente_id>0),
 cliente_avulso_id INTEGER CHECK(cliente_avulso_id IS NULL OR cliente_avulso_id>0),
 motivo TEXT CHECK(motivo IS NULL OR length(trim(motivo)) BETWEEN 1 AND 120),
 observacao TEXT CHECK(observacao IS NULL OR length(trim(observacao)) BETWEEN 1 AND 500),
 chave_idempotencia TEXT NOT NULL UNIQUE CHECK(length(trim(chave_idempotencia)) BETWEEN 1 AND 180),
 idempotencia_hash TEXT NOT NULL CHECK(length(trim(idempotencia_hash)) BETWEEN 1 AND 128),
 operacao_estornada_id INTEGER CHECK(operacao_estornada_id IS NULL OR operacao_estornada_id>0),
 usuario_id INTEGER NOT NULL CHECK(usuario_id>0),
 data_operacao TEXT NOT NULL CHECK(length(data_operacao)=10 AND data_operacao GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 confirmado_em DATETIME,
 estornada_em DATETIME,
 CHECK((tipo='ABERTURA_FARDO' AND pacotes_por_fardo_snapshot IS NOT NULL AND quantidade_pacotes=pacotes_por_fardo_snapshot AND estoque_operacao_fardo_id IS NOT NULL)
  OR(tipo<>'ABERTURA_FARDO' AND pacotes_por_fardo_snapshot IS NULL AND estoque_operacao_fardo_id IS NULL)),
 CHECK((tipo IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND visita_id IS NOT NULL AND((cliente_id IS NOT NULL)<>(cliente_avulso_id IS NOT NULL)))
  OR(tipo NOT IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND visita_id IS NULL AND cliente_id IS NULL AND cliente_avulso_id IS NULL)),
 CHECK(tipo<>'TROCA' OR motivo IS NOT NULL),
 CHECK((tipo='ESTORNO' AND operacao_estornada_id IS NOT NULL) OR(tipo<>'ESTORNO' AND operacao_estornada_id IS NULL)),
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
INSERT INTO estoque_pacote_operacoes SELECT * FROM estoque_pacote_operacoes_v1_2_parcial;

CREATE TABLE estoque_pacote_movimentacoes(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 operacao_id INTEGER NOT NULL CHECK(operacao_id>0),
 carga_id INTEGER NOT NULL CHECK(carga_id>0),
 local_carga_id INTEGER NOT NULL CHECK(local_carga_id>0),
 local_id INTEGER CHECK(local_id IS NULL OR local_id>0),
 produto_id INTEGER NOT NULL CHECK(produto_id>0),
 bucket TEXT NOT NULL CHECK(bucket IN('FRACIONADO_NOVO','RETORNO_TROCA','DESCARTE_PENDENTE')),
 quantidade_pacotes INTEGER NOT NULL CHECK(typeof(quantidade_pacotes)='integer' AND quantidade_pacotes>0),
 efeito INTEGER NOT NULL CHECK(efeito IN(-1,1)),
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(operacao_id,produto_id,bucket,efeito),
 FOREIGN KEY(operacao_id) REFERENCES estoque_pacote_operacoes(id) ON DELETE RESTRICT,
 FOREIGN KEY(carga_id) REFERENCES estoque_cargas(id) ON DELETE RESTRICT,
 FOREIGN KEY(local_carga_id) REFERENCES estoque_locais(id) ON DELETE RESTRICT,
 FOREIGN KEY(local_id) REFERENCES estoque_locais(id) ON DELETE RESTRICT,
 FOREIGN KEY(produto_id) REFERENCES produtos(id) ON DELETE RESTRICT
);
INSERT INTO estoque_pacote_movimentacoes SELECT * FROM estoque_pacote_movimentacoes_v1_2_parcial;
DROP TABLE estoque_pacote_movimentacoes_v1_2_parcial;
DROP TABLE estoque_pacote_operacoes_v1_2_parcial;

CREATE UNIQUE INDEX uq_estoque_pacote_estorno_unico ON estoque_pacote_operacoes(operacao_estornada_id) WHERE operacao_estornada_id IS NOT NULL;
CREATE UNIQUE INDEX uq_estoque_pacote_abertura_unica ON estoque_pacote_operacoes(estoque_operacao_fardo_id) WHERE estoque_operacao_fardo_id IS NOT NULL;
CREATE INDEX idx_estoque_pacote_operacoes_carga ON estoque_pacote_operacoes(carga_id,data_operacao,tipo,status);
CREATE INDEX idx_estoque_pacote_operacoes_local ON estoque_pacote_operacoes(local_carga_id,vendedor_id,data_operacao);
CREATE INDEX idx_estoque_pacote_operacoes_visita ON estoque_pacote_operacoes(visita_id) WHERE visita_id IS NOT NULL;
CREATE INDEX idx_estoque_pacote_mov_saldo ON estoque_pacote_movimentacoes(local_id,produto_id,bucket);
CREATE INDEX idx_estoque_pacote_mov_saldo_compat ON estoque_pacote_movimentacoes(local_carga_id,produto_id,bucket);
CREATE INDEX idx_estoque_pacote_mov_carga ON estoque_pacote_movimentacoes(carga_id,produto_id);

CREATE TRIGGER trg_estoque_pacote_operacao_inserir BEFORE INSERT ON estoque_pacote_operacoes BEGIN
 SELECT CASE WHEN NEW.status<>'PREPARANDO' THEN RAISE(ABORT,'operacao deve nascer PREPARANDO') END;
END;
CREATE TRIGGER trg_estoque_pacote_movimento_inserir BEFORE INSERT ON estoque_pacote_movimentacoes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o WHERE o.id=NEW.operacao_id AND o.status='PREPARANDO' AND o.carga_id=NEW.carga_id AND o.local_carga_id=NEW.local_carga_id AND o.produto_id=NEW.produto_id) THEN RAISE(ABORT,'movimento incoerente ou operacao nao PREPARANDO') END;
 SELECT CASE WHEN NEW.local_id IS NOT NULL AND NEW.local_id<=0 THEN RAISE(ABORT,'local fisico invalido') END;
END;
CREATE TRIGGER trg_estoque_pacote_movimento_atualizar BEFORE UPDATE ON estoque_pacote_movimentacoes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o WHERE o.id=OLD.operacao_id AND o.status='PREPARANDO') THEN RAISE(ABORT,'movimento confirmado e imutavel') END;
 SELECT CASE WHEN NEW.operacao_id<>OLD.operacao_id OR NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o WHERE o.id=NEW.operacao_id AND o.status='PREPARANDO' AND o.carga_id=NEW.carga_id AND o.local_carga_id=NEW.local_carga_id AND o.produto_id=NEW.produto_id) THEN RAISE(ABORT,'movimento atualizado incoerente') END;
END;
CREATE TRIGGER trg_estoque_pacote_movimento_excluir BEFORE DELETE ON estoque_pacote_movimentacoes BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o WHERE o.id=OLD.operacao_id AND o.status='PREPARANDO') THEN RAISE(ABORT,'movimento confirmado nao pode ser excluido') END;
END;

CREATE TRIGGER trg_estoque_pacote_confirmar BEFORE UPDATE OF status ON estoque_pacote_operacoes WHEN OLD.status='PREPARANDO' AND NEW.status='CONFIRMADA' BEGIN
 SELECT CASE WHEN NEW.confirmado_em IS NULL THEN RAISE(ABORT,'confirmado_em obrigatorio') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM estoque_cargas c WHERE c.id=NEW.carga_id AND c.vendedor_id=NEW.vendedor_id AND c.local_carga_id=NEW.local_carga_id AND ((NEW.tipo='CONFIRMACAO_DESCARTE' AND c.status IN('ABERTA','FECHADA')) OR (NEW.tipo<>'CONFIRMACAO_DESCARTE' AND c.status='ABERTA'))) THEN RAISE(ABORT,'carga local vendedor ou status incoerente') END;
 SELECT CASE WHEN NEW.tipo IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND NOT EXISTS(SELECT 1 FROM visitas v WHERE v.id=NEW.visita_id AND v.vendedor_id=NEW.vendedor_id AND coalesce(v.cliente_id,0)=coalesce(NEW.cliente_id,0) AND coalesce(v.cliente_avulso_id,0)=coalesce(NEW.cliente_avulso_id,0)) THEN RAISE(ABORT,'visita vendedor ou cliente incoerente') END;
 SELECT CASE WHEN NEW.tipo IN('TROCA','DEGUSTACAO','BONIFICACAO_PACOTE') AND NOT EXISTS(SELECT 1 FROM visitas v WHERE v.id=NEW.visita_id AND v.status_registro='ATIVA') THEN RAISE(ABORT,'visita nao esta ativa para operacao comercial') END;
 SELECT CASE WHEN NEW.tipo='CONFIRMACAO_DESCARTE' AND NOT EXISTS(SELECT 1 FROM vendedores u WHERE u.id=NEW.usuario_id AND u.status='ativo' AND u.role IN('admin','operacao')) THEN RAISE(ABORT,'descarte exige admin ou operacao') END;
 SELECT CASE WHEN NEW.tipo='ABERTURA_FARDO' AND ((SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1 OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id AND m.bucket='FRACIONADO_NOVO' AND m.efeito=1 AND m.quantidade_pacotes=NEW.quantidade_pacotes AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id) OR NOT EXISTS(SELECT 1 FROM estoque_operacoes eo WHERE eo.id=NEW.estoque_operacao_fardo_id AND eo.tipo='ABERTURA_FARDO' AND eo.status='CONFIRMADA' AND eo.origem_tipo='CARGA' AND eo.origem_id=NEW.carga_id AND (SELECT count(*) FROM estoque_movimentacoes em WHERE em.operacao_id=eo.id)=1 AND EXISTS(SELECT 1 FROM estoque_movimentacoes em WHERE em.operacao_id=eo.id AND em.carga_id=NEW.carga_id AND em.local_id=NEW.local_carga_id AND em.produto_id=NEW.produto_id AND em.quantidade=1 AND em.efeito=-1))) THEN RAISE(ABORT,'abertura incompleta ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='TROCA' AND ((SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>2 OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id AND m.bucket='FRACIONADO_NOVO' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id) OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id AND m.bucket='RETORNO_TROCA' AND m.efeito=1 AND m.quantidade_pacotes=NEW.quantidade_pacotes AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id)) THEN RAISE(ABORT,'troca incompleta ou incoerente') END;
 SELECT CASE WHEN NEW.tipo IN('DEGUSTACAO','BONIFICACAO_PACOTE') AND ((SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1 OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id AND m.bucket='FRACIONADO_NOVO' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id)) THEN RAISE(ABORT,'consumo incompleto ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='CONFIRMACAO_DESCARTE' AND ((SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1 OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id AND m.bucket='DESCARTE_PENDENTE' AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id)) THEN RAISE(ABORT,'descarte incompleto ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='RETORNO_CARGA_PACOTE' AND ((SELECT count(*) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>2 OR (SELECT count(DISTINCT m.bucket) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id)<>1 OR EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id AND m.bucket='DESCARTE_PENDENTE') OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m JOIN estoque_locais l ON l.id=coalesce(m.local_id,m.local_carga_id) WHERE m.operacao_id=NEW.id AND m.carga_id=NEW.carga_id AND m.produto_id=NEW.produto_id AND m.bucket IN('FRACIONADO_NOVO','RETORNO_TROCA') AND m.efeito=-1 AND m.quantidade_pacotes=NEW.quantidade_pacotes AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id) OR NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes m JOIN estoque_locais l ON l.id=coalesce(m.local_id,m.local_carga_id) WHERE m.operacao_id=NEW.id AND m.carga_id=NEW.carga_id AND m.produto_id=NEW.produto_id AND m.bucket IN('FRACIONADO_NOVO','RETORNO_TROCA') AND m.efeito=1 AND m.quantidade_pacotes=NEW.quantidade_pacotes AND l.tipo='CENTRAL')) THEN RAISE(ABORT,'retorno de pacote incompleto ou incoerente') END;
 SELECT CASE WHEN NEW.tipo='ESTORNO' AND NOT EXISTS(SELECT 1 FROM estoque_pacote_operacoes o WHERE o.id=NEW.operacao_estornada_id AND o.status='CONFIRMADA' AND o.tipo<>'ESTORNO' AND o.carga_id=NEW.carga_id AND o.local_carga_id=NEW.local_carga_id AND o.vendedor_id=NEW.vendedor_id AND o.produto_id=NEW.produto_id AND o.quantidade_pacotes=NEW.quantidade_pacotes AND (SELECT count(*) FROM estoque_pacote_movimentacoes mo WHERE mo.operacao_id=o.id)=(SELECT count(*) FROM estoque_pacote_movimentacoes me WHERE me.operacao_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes mo WHERE mo.operacao_id=o.id AND NOT EXISTS(SELECT 1 FROM estoque_pacote_movimentacoes me WHERE me.operacao_id=NEW.id AND me.carga_id=mo.carga_id AND me.local_carga_id=mo.local_carga_id AND coalesce(me.local_id,me.local_carga_id)=coalesce(mo.local_id,mo.local_carga_id) AND me.produto_id=mo.produto_id AND me.bucket=mo.bucket AND me.quantidade_pacotes=mo.quantidade_pacotes AND me.efeito=-mo.efeito))) THEN RAISE(ABORT,'estorno nao e inverso integral') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT 'FRACIONADO_NOVO' bucket UNION ALL SELECT 'RETORNO_TROCA' UNION ALL SELECT 'DESCARTE_PENDENTE') b WHERE coalesce((SELECT sum(m.quantidade_pacotes*m.efeito) FROM estoque_pacote_movimentacoes m JOIN estoque_pacote_operacoes o ON o.id=m.operacao_id WHERE o.status IN('CONFIRMADA','ESTORNADA') AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id AND m.produto_id=NEW.produto_id AND m.bucket=b.bucket),0)+coalesce((SELECT sum(m.quantidade_pacotes*m.efeito) FROM estoque_pacote_movimentacoes m WHERE m.operacao_id=NEW.id AND coalesce(m.local_id,m.local_carga_id)=NEW.local_carga_id AND m.bucket=b.bucket),0)<0) THEN RAISE(ABORT,'saldo de pacotes insuficiente') END;
END;
CREATE TRIGGER trg_estoque_pacote_estorno_confirmado AFTER UPDATE OF status ON estoque_pacote_operacoes WHEN OLD.status='PREPARANDO' AND NEW.status='CONFIRMADA' AND NEW.tipo='ESTORNO' BEGIN
 UPDATE estoque_pacote_operacoes SET status='ESTORNADA',estornada_em=NEW.confirmado_em WHERE id=NEW.operacao_estornada_id AND status='CONFIRMADA';
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'original nao estornada') END;
END;
CREATE TRIGGER trg_estoque_pacote_operacao_atualizar BEFORE UPDATE ON estoque_pacote_operacoes WHEN OLD.status<>'PREPARANDO' BEGIN
 SELECT CASE WHEN NOT(OLD.status='CONFIRMADA' AND NEW.status='ESTORNADA' AND NEW.estornada_em IS NOT NULL AND OLD.id=NEW.id AND OLD.tipo=NEW.tipo AND OLD.carga_id=NEW.carga_id AND OLD.local_carga_id=NEW.local_carga_id AND OLD.vendedor_id=NEW.vendedor_id AND OLD.produto_id=NEW.produto_id AND OLD.quantidade_pacotes=NEW.quantidade_pacotes AND EXISTS(SELECT 1 FROM estoque_pacote_operacoes e WHERE e.tipo='ESTORNO' AND e.status='CONFIRMADA' AND e.operacao_estornada_id=OLD.id)) THEN RAISE(ABORT,'operacao confirmada e imutavel') END;
END;
CREATE TRIGGER trg_estoque_pacote_operacao_excluir BEFORE DELETE ON estoque_pacote_operacoes BEGIN
 SELECT CASE WHEN OLD.status<>'PREPARANDO' THEN RAISE(ABORT,'operacao confirmada nao pode ser excluida') END;
END;

PRAGMA foreign_keys=ON;
