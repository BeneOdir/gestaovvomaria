import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Compara a variante D1 da Migration 1B (sem BEGIN IMMEDIATE/COMMIT) contra a
// migration original ja validada, garantindo transformacao estrutural identica.
const ORIGINAL = './banco/migracao_operacoes_pacote_v1_2_retorno_carga.sql';
const VARIANTE_D1 = './banco/migracao_operacoes_pacote_v1_2_retorno_carga_d1.sql';

// Fixture minima e isolada: aplica so o necessario para exercer a migration 1B
// sobre um estado pos-1A com exatamente 6 operacoes / 6 movimentacoes, igual ao remoto.
function fixturePos1A(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    PRAGMA foreign_keys=OFF;
    CREATE TABLE estoque_cargas(id INTEGER PRIMARY KEY,vendedor_id INTEGER,local_carga_id INTEGER,status TEXT);
    CREATE TABLE estoque_locais(id INTEGER PRIMARY KEY,nome TEXT,tipo TEXT);
    CREATE TABLE produtos(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE vendedores(id INTEGER PRIMARY KEY,nome TEXT,role TEXT,status TEXT);
    CREATE TABLE visitas(id INTEGER PRIMARY KEY,vendedor_id INTEGER,cliente_id INTEGER,cliente_avulso_id INTEGER,status_registro TEXT);
    CREATE TABLE clientes(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE clientes_avulsos(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE estoque_operacoes(id INTEGER PRIMARY KEY,tipo TEXT,status TEXT,origem_tipo TEXT,origem_id INTEGER);
    CREATE TABLE estoque_movimentacoes(id INTEGER PRIMARY KEY,operacao_id INTEGER,local_id INTEGER,produto_id INTEGER,carga_id INTEGER,quantidade INTEGER,efeito INTEGER);
    INSERT INTO estoque_locais VALUES(1,'CENTRAL','CENTRAL'),(2,'CARGA','CARGA_VENDEDOR');
    INSERT INTO produtos VALUES(1,'Produto 1'),(12,'Produto 12');
    INSERT INTO vendedores VALUES(1,'Admin','admin','ativo'),(2,'Vendedor','vendedor','ativo');
    INSERT INTO estoque_cargas VALUES(1,2,2,'ABERTA');
    -- Schema pos-1A: tipo sem RETORNO_CARGA_PACOTE; movimentacoes com local_id e RETORNO_TROCA.
    CREATE TABLE estoque_pacote_operacoes(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK(tipo IN('ABERTURA_FARDO','TROCA','DEGUSTACAO','BONIFICACAO_PACOTE','CONFIRMACAO_DESCARTE','ESTORNO')),
      status TEXT NOT NULL DEFAULT 'PREPARANDO' CHECK(status IN('PREPARANDO','CONFIRMADA','ESTORNADA')),
      carga_id INTEGER NOT NULL, local_carga_id INTEGER NOT NULL, vendedor_id INTEGER NOT NULL, produto_id INTEGER NOT NULL,
      quantidade_pacotes INTEGER NOT NULL, pacotes_por_fardo_snapshot INTEGER, estoque_operacao_fardo_id INTEGER,
      visita_id INTEGER, cliente_id INTEGER, cliente_avulso_id INTEGER, motivo TEXT, observacao TEXT,
      chave_idempotencia TEXT NOT NULL UNIQUE, idempotencia_hash TEXT NOT NULL, operacao_estornada_id INTEGER,
      usuario_id INTEGER NOT NULL, data_operacao TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      confirmado_em DATETIME, estornada_em DATETIME
    );
    CREATE TABLE estoque_pacote_movimentacoes(
      id INTEGER PRIMARY KEY AUTOINCREMENT, operacao_id INTEGER NOT NULL, carga_id INTEGER NOT NULL,
      local_carga_id INTEGER NOT NULL, local_id INTEGER, produto_id INTEGER NOT NULL,
      bucket TEXT NOT NULL CHECK(bucket IN('FRACIONADO_NOVO','RETORNO_TROCA','DESCARTE_PENDENTE')),
      quantidade_pacotes INTEGER NOT NULL, efeito INTEGER NOT NULL CHECK(efeito IN(-1,1)),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const dados = [
    [1, 1, 1, 'FRACIONADO_NOVO', 15, 1, '2026-09-08 13:15:07'],
    [2, 12, 2, 'FRACIONADO_NOVO', 15, 1, '2026-09-15 13:42:23'],
    [3, 12, 3, 'FRACIONADO_NOVO', 15, 1, '2026-09-15 19:59:42'],
    [4, 1, 4, 'FRACIONADO_NOVO', 15, -1, '2026-09-18 21:16:08'],
    [5, 12, 5, 'FRACIONADO_NOVO', 15, -1, '2026-09-18 21:20:34'],
    [6, 12, 6, 'FRACIONADO_NOVO', 15, -1, '2026-09-18 21:21:57'],
  ];
  for (const [id, produtoId, opId, bucket, qtd, efeito, criadoEm] of dados) {
    db.exec(`
      INSERT INTO estoque_operacoes(id,tipo,status,origem_tipo,origem_id) VALUES(${opId},'ABERTURA_FARDO','CONFIRMADA','CARGA',1);
      INSERT INTO estoque_pacote_operacoes(id,tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,pacotes_por_fardo_snapshot,estoque_operacao_fardo_id,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao,confirmado_em,created_at)
        VALUES(${opId},'ABERTURA_FARDO','CONFIRMADA',1,2,2,${produtoId},15,15,${opId},'seed-${opId}','hash-${opId}',2,'2026-09-19','${criadoEm}','${criadoEm}');
      INSERT INTO estoque_pacote_movimentacoes(id,operacao_id,carga_id,local_carga_id,local_id,produto_id,bucket,quantidade_pacotes,efeito,created_at)
        VALUES(${id},${opId},1,2,NULL,${produtoId},'${bucket}',${qtd},${efeito},'${criadoEm}');
    `);
  }
  return db;
}

function schemaSnapshot(db) {
  return db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name IN('estoque_pacote_operacoes','estoque_pacote_movimentacoes','gestao_migracoes_pacote_v1_2') OR name LIKE 'idx_estoque_pacote%' OR name LIKE 'uq_estoque_pacote%' OR name LIKE 'trg_estoque_pacote%' ORDER BY type,name").all()
    .map(row => ({ type: row.type, name: row.name, sql: row.sql }));
}
function dataSnapshot(db) {
  return {
    operacoes: db.prepare('SELECT * FROM estoque_pacote_operacoes ORDER BY id').all(),
    movimentacoes: db.prepare('SELECT * FROM estoque_pacote_movimentacoes ORDER BY id').all(),
  };
}

test('Variante D1 produz schema identico ao da migration 1B original', t => {
  const dbOriginal = fixturePos1A(t);
  dbOriginal.exec(fs.readFileSync(new URL(ORIGINAL, `file://${process.cwd()}/`), 'utf8'));
  const dbVariante = fixturePos1A(t);
  dbVariante.exec(fs.readFileSync(new URL(VARIANTE_D1, `file://${process.cwd()}/`), 'utf8'));

  assert.deepEqual(schemaSnapshot(dbVariante), schemaSnapshot(dbOriginal));
  assert.deepEqual(dataSnapshot(dbVariante), dataSnapshot(dbOriginal));
});

test('Variante D1 preserva os 6 registros, local_id, RETORNO_TROCA e permite RETORNO_CARGA_PACOTE', t => {
  const db = fixturePos1A(t);
  db.exec(fs.readFileSync(new URL(VARIANTE_D1, `file://${process.cwd()}/`), 'utf8'));

  assert.equal(db.prepare('SELECT COUNT(*) n FROM estoque_pacote_operacoes').get().n, 6);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM estoque_pacote_movimentacoes').get().n, 6);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='estoque_pacote_operacoes'").get().sql.includes('RETORNO_CARGA_PACOTE'), true);
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name='estoque_pacote_movimentacoes'").get().sql.includes('RETORNO_TROCA'), true);
  assert.equal(db.prepare("PRAGMA table_info(estoque_pacote_movimentacoes)").all().some(c => c.name === 'local_id'), true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM estoque_pacote_operacoes WHERE tipo='RETORNO_CARGA_PACOTE'").get().n, 0, 'nenhuma operacao operacional deve ser inventada pela migration');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM gestao_migracoes_pacote_v1_2 WHERE nome='migracao_operacoes_pacote_v1_2_retorno_carga'").get().n, 1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  const historico = db.prepare('SELECT id,operacao_id,local_id FROM estoque_pacote_movimentacoes ORDER BY id').all();
  assert.deepEqual(historico.map(r => r.local_id), [null, null, null, null, null, null]);
  assert.deepEqual(historico.map(r => r.id), [1, 2, 3, 4, 5, 6]);
});

test('Reaplicacao da variante D1 falha no marcador antes de qualquer alteracao destrutiva', t => {
  const db = fixturePos1A(t);
  db.exec(fs.readFileSync(new URL(VARIANTE_D1, `file://${process.cwd()}/`), 'utf8'));
  const antes = dataSnapshot(db);
  assert.throws(() => db.exec(fs.readFileSync(new URL(VARIANTE_D1, `file://${process.cwd()}/`), 'utf8')));
  assert.deepEqual(dataSnapshot(db), antes, 'reaplicacao deve falhar sem alterar dados existentes');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
});
