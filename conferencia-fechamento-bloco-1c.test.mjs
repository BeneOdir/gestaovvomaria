import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = fs.readFileSync(new URL('./worker/worker.js', import.meta.url), 'utf8');
const names = ['calcularSaldosConferenciaCarga', 'obterConferenciaFechamentoCarga', 'fecharCargaVendedor', 'registrarComplementoCarga'];
const api = await import(`data:text/javascript;base64,${Buffer.from(source + `\nexport { ${names.join(',')} };`).toString('base64')}`);
const admin = { role: 'admin', vendedorId: 1, nome: 'Admin' };

function execute(db, sql, args) {
  const stmt = db.prepare(sql);
  if (stmt.columns().length) return { success: true, results: stmt.all(...args), meta: {} };
  const result = stmt.run(...args);
  return { success: true, results: [], meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
}

function fixture(t) {
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
    INSERT INTO produtos VALUES(1,'Fardos','ativo'),(2,'Pacotes bons','ativo'),(3,'Retorno troca','ativo'),(4,'Descarte','ativo');
    INSERT INTO producao_parametros_produto(produto_id,pacotes_por_fardo,valor_por_pacote,ativo) VALUES(1,8,1.5,1),(2,8,1.5,1),(3,8,1.5,1),(4,8,1.5,1);
    INSERT INTO clientes VALUES(1,'Cliente');
    INSERT INTO visitas VALUES(1,2,1,NULL,'ATIVA','ROTA');
  `);
  for (const file of ['migracao_estoque_e1_1.sql','migracao_operacoes_pacote_v1.sql','migracao_operacoes_pacote_v1_1_local_bucket.sql','migracao_operacoes_pacote_v1_2_retorno_carga.sql']) {
    db.exec(fs.readFileSync(new URL(`./banco/${file}`, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO estoque_locais(nome,tipo,vendedor_id) VALUES('CENTRAL','CENTRAL',NULL),('CARGA','CARGA_VENDEDOR',2);
    INSERT INTO estoque_cargas(data_carga,vendedor_id,local_carga_id,status,aberta_por) VALUES('2026-09-19',2,2,'ABERTA',1);
    INSERT INTO estoque_carga_itens(carga_id,produto_id,quantidade_carregada) VALUES(1,1,2);
    INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id) VALUES('INVENTARIO_INICIAL','CONFIRMADA','2026-09-19','INVENTARIO',NULL,'inventory-1',1);
    INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,quantidade,efeito) VALUES(1,1,1,20,1);
    INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id) VALUES('TRANSFERENCIA_CARGA','CONFIRMADA','2026-09-19','CARGA',1,'transfer-1',1);
    INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,carga_item_id,quantidade,efeito) VALUES(2,1,1,1,1,2,-1),(2,2,1,1,1,2,1);
  `);
  const env = { db, DB: {
    prepare(sql) { return { sql, args: [], bind(...args) { this.args=args; return this; }, async first() { return execute(db,sql,this.args).results[0] ?? null; }, async all() { return execute(db,sql,this.args); }, async run() { return execute(db,sql,this.args); } }; },
    async batch(statements) { db.exec('BEGIN IMMEDIATE'); try { const result=statements.map(s=>execute(db,s.sql,s.args)); db.exec('COMMIT'); return result; } catch(error) { db.exec('ROLLBACK'); throw error; } },
  }};
  return env;
}

function seedPackage(env, produtoId, bucket, quantidade, efeito = 1) {
  const id = env.db.prepare('SELECT COALESCE(MAX(id),0)+1 id FROM estoque_pacote_operacoes').get().id;
  env.db.exec('DROP TRIGGER IF EXISTS trg_estoque_pacote_confirmar');
  env.db.exec(`
    INSERT INTO estoque_pacote_operacoes(tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,observacao,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao)
    VALUES('CONFIRMACAO_DESCARTE','PREPARANDO',1,2,2,${produtoId},${Math.abs(quantidade)},'fixture','seed-${id}','hash-${id}',1,'2026-09-19');
    INSERT INTO estoque_pacote_movimentacoes(operacao_id,carga_id,local_carga_id,local_id,produto_id,bucket,quantidade_pacotes,efeito)
    VALUES(${id},1,2,2,${produtoId},'${bucket}',${Math.abs(quantidade)},${efeito});
    UPDATE estoque_pacote_operacoes SET status='CONFIRMADA',confirmado_em=CURRENT_TIMESTAMP WHERE id=${id};
  `);
}
function get(env, cargaId = 1) { return api.obterConferenciaFechamentoCarga(new Request(`http://local/api/estoque/cargas/${cargaId}/conferencia-fechamento`), env, admin, cargaId); }
function closeRequest(itens, key = 'close-1') { return new Request('http://local/api/estoque/cargas/1/fechamento', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ itens, observacao:'fechamento', confirmacao_fisica:true, confirmacao_texto:'FECHAR CARGA', chave_idempotencia:key }) }); }

 test('GET retorna fotografia combinada, produtos exclusivos e alerta de descarte', async t => {
  const env=fixture(t); seedPackage(env,2,'FRACIONADO_NOVO',8); seedPackage(env,3,'RETORNO_TROCA',1); seedPackage(env,4,'DESCARTE_PENDENTE',2);
  const antes=env.db.prepare('SELECT COUNT(*) n FROM estoque_pacote_movimentacoes').get().n;
  const response=await get(env); const body=await response.json();
  assert.equal(response.status,200); assert.equal(body.status,'ABERTA'); assert.equal(body.local_id,2); assert.equal(body.bloqueado,true);
  assert.deepEqual(body.produtos.map(item=>[item.produto_id,item.fardos_sistema,item.pacotes_bons_sistema,item.retorno_troca_sistema,item.descarte_pendente]),[[1,2,0,0,0],[2,0,8,0,0],[3,0,0,1,0],[4,0,0,0,2]]);
  assert.equal(body.alertas[0].tipo,'DESCARTE_PENDENTE');
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM estoque_pacote_movimentacoes').get().n,antes);
 });

test('GET rejeita inexistente e carga fechada', async t => {
  const env=fixture(t); const inexistente=await get(env,99); assert.equal(inexistente.status,404);
  env.db.exec("UPDATE estoque_cargas SET status='FECHADA',fechada_em=CURRENT_TIMESTAMP,fechada_por=1 WHERE id=1");
  const fechada=await get(env); assert.equal(fechada.status,409);
});

test('GET preserva saldo negativo sem mascarar', async t => {
  const env=fixture(t); env.db.exec('INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,quantidade,efeito) VALUES(1,2,1,1,3,-1)');
  const body=await (await get(env)).json(); assert.equal(body.produtos[0].fardos_sistema,-1);
});

test('GET e POST usam o mesmo helper e POST aceita fotografia conciliada', async t => {
  const env=fixture(t); seedPackage(env,2,'FRACIONADO_NOVO',8);
  const fotografia=await (await get(env)).json();
  const itens=fotografia.produtos.map(item=>({produto_id:item.produto_id,quantidade_fisica:item.fardos_sistema,quantidade_pacotes_bons:item.pacotes_bons_sistema,quantidade_retorno_troca:item.retorno_troca_sistema}));
  const response=await api.fecharCargaVendedor(closeRequest(itens),env,admin,1); assert.equal(response.status,201,JSON.stringify(await response.json()));
  assert.equal(env.db.prepare("SELECT status FROM estoque_cargas WHERE id=1").get().status,'FECHADA');
});

test('Divergência continua bloqueando e complemento segue permitido', async t => {
  const env=fixture(t); const antes=env.db.prepare('SELECT COUNT(*) n FROM estoque_cargas').get().n;
  const response=await api.fecharCargaVendedor(closeRequest([{produto_id:1,quantidade_fisica:1}]),env,admin,1); assert.equal(response.status,409); assert.equal(env.db.prepare('SELECT COUNT(*) n FROM estoque_cargas').get().n,antes);
  const complemento=await api.registrarComplementoCarga(new Request('http://local/api/estoque/cargas/1/complementos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chave_idempotencia:'comp-1',observacao:'ok',confirmacao_auditoria:true,itens:[{produto_id:1,quantidade:1}]})}),env,admin,1);
  assert.equal(complemento.status,201,JSON.stringify(await complemento.json()));
});

test('A fotografia nao usa a protecao LOCAL ZERO', () => {
  const inicio=source.indexOf('async function calcularSaldosConferenciaCarga'); const fim=source.indexOf('async function obterConferenciaFechamentoCarga'); const trecho=source.slice(inicio,fim);
  assert.equal(trecho.includes('residuosLocalCarga'),false);
  const fechamentoInicio=source.indexOf('async function fecharCargaVendedor');
  const fechamentoFim=source.indexOf('const MOTIVOS_TROCA_PACOTE');
  assert.equal(source.slice(fechamentoInicio,fechamentoFim).includes('calcularSaldosConferenciaCarga'),true);
});
