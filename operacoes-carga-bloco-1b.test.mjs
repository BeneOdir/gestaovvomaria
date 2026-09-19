import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = fs.readFileSync(new URL('./worker/worker.js', import.meta.url), 'utf8');
const names = ['fecharCargaVendedor', 'operacaoComercialPacote'];
const api = await import(`data:text/javascript;base64,${Buffer.from(source + `\nexport { ${names.join(',')} };`).toString('base64')}`);
const admin = { role: 'admin', vendedorId: 1, nome: 'Admin' };

function fixture(t, { pacote = false, troca = false, descarte = false, migrationCheck = false } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE vendedores(id INTEGER PRIMARY KEY,nome TEXT,role TEXT,status TEXT);
    CREATE TABLE produtos(id INTEGER PRIMARY KEY,nome TEXT,ativo TEXT);
    CREATE TABLE producao_parametros_produto(id INTEGER PRIMARY KEY AUTOINCREMENT,produto_id INTEGER,pacotes_por_fardo INTEGER,valor_por_pacote REAL,ativo INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT);
    CREATE TABLE clientes(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE clientes_avulsos(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE visitas(id INTEGER PRIMARY KEY,vendedor_id INTEGER,cliente_id INTEGER,cliente_avulso_id INTEGER,status_registro TEXT);
    INSERT INTO vendedores VALUES(1,'Admin','admin','ativo'),(2,'Vendedor','vendedor','ativo');
    INSERT INTO produtos VALUES(1,'Produto 1','ativo');
    INSERT INTO producao_parametros_produto(produto_id,pacotes_por_fardo,valor_por_pacote,ativo) VALUES(1,8,1.5,1);
    INSERT INTO clientes VALUES(1,'Cliente');
    INSERT INTO visitas VALUES(1,2,1,NULL,'ATIVA');
  `);
  for (const file of ['migracao_estoque_e1_1.sql', 'migracao_operacoes_pacote_v1.sql', 'migracao_operacoes_pacote_v1_1_local_bucket.sql']) {
    db.exec(fs.readFileSync(new URL(`./banco/${file}`, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO estoque_locais(nome,tipo,vendedor_id) VALUES('CENTRAL','CENTRAL',NULL),('CARGA','CARGA_VENDEDOR',2);
    INSERT INTO estoque_cargas(data_carga,vendedor_id,local_carga_id,status,aberta_por) VALUES('2026-09-19',2,2,'ABERTA',1);
    INSERT INTO estoque_carga_itens(carga_id,produto_id,quantidade_carregada) VALUES(1,1,1);
    INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id) VALUES('TRANSFERENCIA_CARGA','CONFIRMADA','2026-09-19','CARGA',1,'TRANSF-1',1);
    INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,carga_item_id,quantidade,efeito) VALUES(1,1,1,1,1,1,-1),(1,2,1,1,1,1,1);
  `);
  if (migrationCheck) {
    db.exec(`
      INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id) VALUES('ABERTURA_FARDO','CONFIRMADA','2026-09-19','CARGA',1,'LEGACY-FARDO',2);
      INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,carga_item_id,quantidade,efeito) VALUES(2,2,1,1,1,1,-1);
      INSERT INTO estoque_pacote_operacoes(tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,pacotes_por_fardo_snapshot,estoque_operacao_fardo_id,observacao,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao) VALUES('ABERTURA_FARDO','PREPARANDO',1,2,2,1,8,8,2,'legacy','LEGACY-PACOTE','legacy-hash',2,'2026-09-19');
      INSERT INTO estoque_pacote_movimentacoes(operacao_id,carga_id,local_carga_id,produto_id,bucket,quantidade_pacotes,efeito) VALUES(1,1,2,1,'FRACIONADO_NOVO',8,1);
      UPDATE estoque_pacote_operacoes SET status='CONFIRMADA',confirmado_em=CURRENT_TIMESTAMP WHERE id=1;
    `);
  }
  db.exec(fs.readFileSync(new URL('./banco/migracao_operacoes_pacote_v1_2_retorno_carga.sql', import.meta.url), 'utf8'));
  const env = { db };
  env.DB = {
    prepare(sql) { return { sql, args: [], bind(...args) { this.args = args; return this; }, async first() { return execute(db, sql, this.args).results[0] ?? null; }, async all() { return execute(db, sql, this.args); }, async run() { return execute(db, sql, this.args); } }; },
    async batch(statements) { db.exec('BEGIN IMMEDIATE'); try { const result = statements.map(statement => execute(db, statement.sql, statement.args)); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  };

  if (pacote) seedOpening(env);
  if (descarte) seedDiscard(env);
  return env;

  function seedOpening() {
    db.exec(`
      INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id) VALUES('ABERTURA_FARDO','CONFIRMADA','2026-09-19','CARGA',1,'FARDO-1',2);
      INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,carga_item_id,quantidade,efeito) VALUES(2,2,1,1,1,1,-1);
      INSERT INTO estoque_pacote_operacoes(tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,pacotes_por_fardo_snapshot,estoque_operacao_fardo_id,observacao,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao) VALUES('ABERTURA_FARDO','PREPARANDO',1,2,2,1,8,8,2,'abertura','PACOTE:ABERTURA_FARDO:seed','hash',2,'2026-09-19');
      INSERT INTO estoque_pacote_movimentacoes(operacao_id,carga_id,local_carga_id,local_id,produto_id,bucket,quantidade_pacotes,efeito) VALUES(1,1,2,2,1,'FRACIONADO_NOVO',8,1);
      UPDATE estoque_pacote_operacoes SET status='CONFIRMADA',confirmado_em=CURRENT_TIMESTAMP WHERE id=1;
    `);
  }
  function seedDiscard() {
    db.exec('DROP TRIGGER trg_estoque_pacote_confirmar');
    db.exec(`
      INSERT INTO estoque_pacote_operacoes(tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,observacao,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao) VALUES('CONFIRMACAO_DESCARTE','PREPARANDO',1,2,2,1,1,'descarte','discard-seed','hash-discard',1,'2026-09-19');
      INSERT INTO estoque_pacote_movimentacoes(operacao_id,carga_id,local_carga_id,local_id,produto_id,bucket,quantidade_pacotes,efeito) VALUES(2,1,2,2,1,'DESCARTE_PENDENTE',1,1);
      UPDATE estoque_pacote_operacoes SET status='CONFIRMADA',confirmado_em=CURRENT_TIMESTAMP WHERE id=2;
    `);
  }
}

async function seedTrade(env, key = 'trade-seed') {
  return api.operacaoComercialPacote(new Request('http://local.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produto_id: 1, quantidade_pacotes: 1, motivo: 'QUALIDADE', chave_idempotencia: key, data_operacao: '2026-09-19', observacao: 'troca' }) }), env, { role: 'vendedor', vendedorId: 2 }, 1, 'TROCA');
}

function execute(db, sql, args) {
  const stmt = db.prepare(sql);
  if (stmt.columns().length) return { success: true, results: stmt.all(...args), meta: {} };
  const result = stmt.run(...args);
  return { success: true, results: [], meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
}

function bindExecutor(env) {
  const db = env.db;
  void db;
}

function request(items, key = 'close-1') {
  return new Request('http://local.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itens: items, observacao: 'fechamento', confirmacao_fisica: true, confirmacao_texto: 'FECHAR CARGA', chave_idempotencia: key }) });
}

async function close(env, items, key = 'close-1') {
  bindExecutor(env);
  const response = await api.fecharCargaVendedor(request(items, key), env, admin, 1);
  return { status: response.status, body: await response.json() };
}

function saldoFardo(env, localId) { return Number(env.db.prepare('SELECT COALESCE(SUM(quantidade*efeito),0) n FROM estoque_movimentacoes WHERE local_id=? AND produto_id=1').get(localId).n); }
function saldoPacote(env, localId, bucket) { return Number(env.db.prepare("SELECT COALESCE(SUM(m.quantidade_pacotes*m.efeito),0) n FROM estoque_pacote_movimentacoes m JOIN estoque_pacote_operacoes o ON o.id=m.operacao_id WHERE COALESCE(m.local_id,m.local_carga_id)=? AND m.produto_id=1 AND m.bucket=? AND o.status IN('CONFIRMADA','ESTORNADA')").get(localId, bucket).n); }

// O adapter usa o banco fechado sobre o escopo da fixture.
test('Migration V1.2 preserva estrutura, legado e integridade', t => {
  const env = fixture(t, { migrationCheck: true });
  bindExecutor(env);
  assert.equal(env.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='estoque_pacote_operacoes'").get().n, 1);
  assert.equal(env.db.prepare("SELECT sql FROM sqlite_master WHERE name='estoque_pacote_operacoes'").get().sql.includes('RETORNO_CARGA_PACOTE'), true);
  assert.equal(env.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.equal(env.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  const legado = env.db.prepare("SELECT id,carga_id,produto_id,quantidade_pacotes,local_id FROM estoque_pacote_movimentacoes WHERE operacao_id=1").get();
  assert.deepEqual({ id: legado.id, carga_id: legado.carga_id, produto_id: legado.produto_id, quantidade_pacotes: legado.quantidade_pacotes, local_id: legado.local_id }, { id: 1, carga_id: 1, produto_id: 1, quantidade_pacotes: 8, local_id: null });
});

test('Fechamento somente com fardos preserva fluxo e atomicidade', async t => {
  const env = fixture(t);
  const result = await close(env, [{ produto_id: 1, quantidade_fisica: 1 }]);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(saldoFardo(env, 2), 0); assert.equal(saldoFardo(env, 1), 0);
  assert.equal(env.db.prepare("SELECT status FROM estoque_cargas WHERE id=1").get().status, 'FECHADA');
});

test('Fechamento transfere pacote bom mantendo bucket e carga_id', async t => {
  const env = fixture(t, { pacote: true });
  const result = await close(env, [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 8, quantidade_retorno_troca: 0 }]);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(saldoPacote(env, 2, 'FRACIONADO_NOVO'), 0); assert.equal(saldoPacote(env, 1, 'FRACIONADO_NOVO'), 8);
  const movimentos = env.db.prepare("SELECT local_id,carga_id,bucket,quantidade_pacotes,efeito FROM estoque_pacote_movimentacoes WHERE operacao_id=(SELECT id FROM estoque_pacote_operacoes WHERE tipo='RETORNO_CARGA_PACOTE') ORDER BY efeito").all();
  assert.deepEqual(movimentos.map(row => [row.local_id, row.carga_id, row.bucket, row.quantidade_pacotes, row.efeito]), [[2, 1, 'FRACIONADO_NOVO', 8, -1], [1, 1, 'FRACIONADO_NOVO', 8, 1]]);
});

test('Fechamento transfere retorno de troca sem virar descarte', async t => {
  const env = fixture(t, { pacote: true });
  await seedTrade(env);
  const result = await close(env, [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 7, quantidade_retorno_troca: 1 }]);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(saldoPacote(env, 2, 'RETORNO_TROCA'), 0); assert.equal(saldoPacote(env, 1, 'RETORNO_TROCA'), 1);
  assert.equal(saldoPacote(env, 1, 'DESCARTE_PENDENTE'), 0);
});

test('Fechamento combinado zera fardos, pacotes bons e trocas', async t => {
  const env = fixture(t, { pacote: true }); await seedTrade(env);
  const result = await close(env, [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 7, quantidade_retorno_troca: 1 }]);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(saldoFardo(env, 2), 0); assert.equal(saldoPacote(env, 2, 'FRACIONADO_NOVO'), 0); assert.equal(saldoPacote(env, 2, 'RETORNO_TROCA'), 0);
});

test('Divergência de fardo, pacote bom ou troca bloqueia sem escrita', async t => {
  for (const configuracao of [{ pacote: true, itens: [{ produto_id: 1, quantidade_fisica: 1, quantidade_pacotes_bons: 7 }] }, { pacote: true, troca: true, itens: [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 8, quantidade_retorno_troca: 0 }] }, { pacote: true, itens: [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 7, quantidade_retorno_troca: 1 }] }]) {
    const env = fixture(t, configuracao); if (configuracao.troca) await seedTrade(env); const before = env.db.prepare('SELECT COUNT(*) n FROM estoque_operacoes').get().n;
    const result = await close(env, configuracao.itens); assert.equal(result.status, 409); assert.equal(env.db.prepare("SELECT status FROM estoque_cargas WHERE id=1").get().status, 'ABERTA'); assert.equal(env.db.prepare('SELECT COUNT(*) n FROM estoque_operacoes').get().n, before);
  }
});

test('DESCARTE_PENDENTE bloqueia fechamento integralmente', async t => {
  const env = fixture(t, { pacote: true, descarte: true });
  const result = await close(env, [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 8, quantidade_retorno_troca: 0 }]);
  assert.equal(result.status, 409); assert.match(result.body.error, /DESCARTE_PENDENTE/); assert.equal(env.db.prepare("SELECT status FROM estoque_cargas WHERE id=1").get().status, 'ABERTA');
});

test('Repetição idempotente não duplica retorno', async t => {
  const env = fixture(t, { pacote: true });
  const first = await close(env, [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 8 }], 'same');
  const operations = env.db.prepare("SELECT COUNT(*) n FROM estoque_pacote_operacoes WHERE tipo='RETORNO_CARGA_PACOTE'").get().n;
  const second = await close(env, [{ produto_id: 1, quantidade_fisica: 0, quantidade_pacotes_bons: 8 }], 'same');
  assert.equal(first.status, 201); assert.equal(second.status, 200); assert.equal(env.db.prepare("SELECT COUNT(*) n FROM estoque_pacote_operacoes WHERE tipo='RETORNO_CARGA_PACOTE'").get().n, operations);
});

test('Tipo de retorno rejeita DESCARTE_PENDENTE', t => {
  const env = fixture(t);
  assert.throws(() => env.db.exec(`INSERT INTO estoque_pacote_operacoes(tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,observacao,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao) VALUES('RETORNO_CARGA_PACOTE','PREPARANDO',1,2,2,1,1,'x','reject-1','hash',2,'2026-09-19'); INSERT INTO estoque_pacote_movimentacoes(operacao_id,carga_id,local_carga_id,local_id,produto_id,bucket,quantidade_pacotes,efeito) VALUES(3,1,2,2,1,'DESCARTE_PENDENTE',1,-1); UPDATE estoque_pacote_operacoes SET status='CONFIRMADA',confirmado_em=CURRENT_TIMESTAMP WHERE id=3;`));
});
