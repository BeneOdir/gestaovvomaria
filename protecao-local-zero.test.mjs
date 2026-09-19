import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = fs.readFileSync(new URL('./worker/worker.js', import.meta.url), 'utf8');
const api = await import(`data:text/javascript;base64,${Buffer.from(source + '\nexport { registrarCargaVendedor, registrarComplementoCarga };').toString('base64')}`);
const admin = { role: 'admin', vendedorId: 1, nome: 'Admin' };

function fixture(t, { local = false } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE vendedores(id INTEGER PRIMARY KEY,nome TEXT,role TEXT,status TEXT);
    CREATE TABLE produtos(id INTEGER PRIMARY KEY,nome TEXT,ativo TEXT);
    CREATE TABLE producao_parametros_produto(id INTEGER PRIMARY KEY AUTOINCREMENT,produto_id INTEGER,pacotes_por_fardo INTEGER,valor_por_pacote REAL,ativo INTEGER DEFAULT 1,created_at TEXT,updated_at TEXT);
    CREATE TABLE clientes(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE clientes_avulsos(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE visitas(id INTEGER PRIMARY KEY,vendedor_id INTEGER,cliente_id INTEGER,cliente_avulso_id INTEGER,status_registro TEXT,canal_venda TEXT);
    INSERT INTO vendedores VALUES(1,'Admin','admin','ativo'),(2,'Vendedor','vendedor','ativo');
    INSERT INTO produtos VALUES(1,'Produto 1','ativo');
    INSERT INTO producao_parametros_produto(produto_id,pacotes_por_fardo,valor_por_pacote,ativo) VALUES(1,8,1.5,1);
  `);
  for (const file of ['migracao_estoque_e1_1.sql', 'migracao_operacoes_pacote_v1.sql', 'migracao_operacoes_pacote_v1_1_local_bucket.sql', 'migracao_operacoes_pacote_v1_2_retorno_carga.sql']) {
    db.exec(fs.readFileSync(new URL(`./banco/${file}`, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO estoque_locais(nome,tipo,vendedor_id) VALUES('CENTRAL','CENTRAL',NULL);
    INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id) VALUES('INVENTARIO_INICIAL','CONFIRMADA','2026-09-19','INVENTARIO',NULL,'INV-1',1);
    INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,quantidade,efeito) VALUES(1,1,1,20,1);
  `);
  if (local) db.exec("INSERT INTO estoque_locais(nome,tipo,vendedor_id) VALUES('CARGA - Vendedor','CARGA_VENDEDOR',2)");
  const env = { db, DB: {
    prepare(sql) { return { sql, args: [], bind(...args) { this.args = args; return this; }, async first() { return execute(db, sql, this.args).results[0] ?? null; }, async all() { return execute(db, sql, this.args); }, async run() { return execute(db, sql, this.args); } }; },
    async batch(statements) { db.exec('BEGIN IMMEDIATE'); try { const result = statements.map(statement => execute(db, statement.sql, statement.args)); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
  }};
  return env;
}

function execute(db, sql, args) {
  const stmt = db.prepare(sql);
  if (stmt.columns().length) return { success: true, results: stmt.all(...args), meta: {} };
  const result = stmt.run(...args);
  return { success: true, results: [], meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
}

function request(body) {
  return new Request('http://local.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function cargaBody(key = 'carga-1', data = '2026-09-19') {
  return { vendedor_id: 2, data_carga: data, observacao: 'teste', confirmacao_auditoria: true, chave_idempotencia: key, itens: [{ produto_id: 1, quantidade: 1 }] };
}
async function abrir(env, key = 'carga-1', data = '2026-09-19') {
  const response = await api.registrarCargaVendedor(request(cargaBody(key, data)), env, admin);
  return { status: response.status, body: await response.json() };
}
function localId(env) { return Number(env.db.prepare("SELECT id FROM estoque_locais WHERE tipo='CARGA_VENDEDOR' AND vendedor_id=2").get()?.id || 0); }
function cargaCount(env) { return Number(env.db.prepare('SELECT COUNT(*) n FROM estoque_cargas').get().n); }
function operacaoCount(env) { return Number(env.db.prepare('SELECT COUNT(*) n FROM estoque_operacoes').get().n); }
function movimentoCount(env) { return Number(env.db.prepare('SELECT COUNT(*) n FROM estoque_movimentacoes').get().n); }

function seedFardo(env, quantidade) {
  const id = localId(env);
  env.db.exec(`INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,quantidade,efeito) VALUES(1,${id},1,NULL,${Math.abs(quantidade)},${Math.sign(quantidade)})`);
}
function seedPacote(env, bucket, quantidade) {
  const id = localId(env);
  env.db.exec('DROP TRIGGER trg_estoque_pacote_confirmar');
  env.db.exec(`
    INSERT INTO estoque_pacote_operacoes(tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,observacao,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao)
    VALUES('CONFIRMACAO_DESCARTE','PREPARANDO',1,${id},2,1,${Math.abs(quantidade)},'fixture','seed-${bucket}-${quantidade}','hash-${bucket}-${quantidade}',1,'2026-09-19');
    INSERT INTO estoque_pacote_movimentacoes(operacao_id,carga_id,local_carga_id,local_id,produto_id,bucket,quantidade_pacotes,efeito)
    VALUES((SELECT max(id) FROM estoque_pacote_operacoes),1,${id},${id},1,'${bucket}',${Math.abs(quantidade)},${Math.sign(quantidade)});
    UPDATE estoque_pacote_operacoes SET status='CONFIRMADA',confirmado_em=CURRENT_TIMESTAMP WHERE id=(SELECT max(id) FROM estoque_pacote_operacoes);
  `);
}

for (const [nome, preparador] of [
  ['fardo positivo', env => seedFardo(env, 1)],
  ['fardo negativo', env => seedFardo(env, -1)],
  ['FRACIONADO_NOVO', env => seedPacote(env, 'FRACIONADO_NOVO', 1)],
  ['RETORNO_TROCA', env => seedPacote(env, 'RETORNO_TROCA', 1)],
  ['DESCARTE_PENDENTE', env => seedPacote(env, 'DESCARTE_PENDENTE', 1)],
  ['pacote negativo', env => seedPacote(env, 'FRACIONADO_NOVO', -1)],
]) {
  test(`bloqueia nova carga com ${nome}`, async t => {
    const env = fixture(t, { local: true });
    preparador(env);
    const antes = [cargaCount(env), operacaoCount(env), movimentoCount(env)];
    const resultado = await abrir(env, `bloqueio-${nome}`);
    assert.equal(resultado.status, 409);
    assert.equal(cargaCount(env), antes[0]);
    assert.equal(operacaoCount(env), antes[1]);
    assert.equal(movimentoCount(env), antes[2]);
    assert.equal(resultado.body.local_id, localId(env));
    assert.equal(resultado.body.residuos.length > 0, true);
  });
}

test('vendedor sem local anterior abre nova carga', async t => {
  const env = fixture(t);
  const resultado = await abrir(env);
  assert.equal(resultado.status, 201, JSON.stringify(resultado.body));
  assert.equal(resultado.body.carga.local_carga_id, localId(env));
});

test('local existente totalmente zerado permite nova carga', async t => {
  const env = fixture(t, { local: true });
  const resultado = await abrir(env);
  assert.equal(resultado.status, 201, JSON.stringify(resultado.body));
});

test('ciclo consecutivo usa o mesmo local após fechamento zerado', async t => {
  const env = fixture(t);
  const primeira = await abrir(env, 'carga-a');
  assert.equal(primeira.status, 201);
  env.db.exec(`
    INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id)
      VALUES('RETORNO_CARGA','CONFIRMADA','2026-09-19','CARGA',1,'RETORNO-A',1);
    INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,quantidade,efeito)
      VALUES(2,2,1,1,1,-1),(2,1,1,1,1,1);
    UPDATE estoque_cargas SET status='FECHADA',fechada_em=CURRENT_TIMESTAMP,fechada_por=1 WHERE id=1;
  `);
  const segunda = await abrir(env, 'carga-b', '2026-09-20');
  assert.equal(segunda.status, 201, JSON.stringify(segunda.body));
  assert.equal(segunda.body.carga.local_carga_id, primeira.body.carga.local_carga_id);
});

test('complemento de carga aberta continua permitido com saldo no local', async t => {
  const env = fixture(t);
  const primeira = await abrir(env, 'carga-aberta');
  assert.equal(primeira.status, 201);
  const resposta = await api.registrarComplementoCarga(request({
    chave_idempotencia: 'complemento-1', observacao: 'complemento', confirmacao_auditoria: true,
    itens: [{ produto_id: 1, quantidade: 1 }],
  }), env, admin, Number(primeira.body.carga.id));
  assert.equal(resposta.status, 201, JSON.stringify(await resposta.json()));
});
