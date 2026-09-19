import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const source = fs.readFileSync(new URL('./worker/worker.js', import.meta.url), 'utf8');
const names = ['abrirFardoPacote', 'operacaoComercialPacote', 'estornarOperacaoPacote', 'saldoPacotes'];
const api = await import(`data:text/javascript;base64,${Buffer.from(source + `\nexport { ${names.join(',')} };`).toString('base64')}`);

const vendedor = { role: 'vendedor', vendedorId: 2 };
const admin = { role: 'admin', vendedorId: 1 };

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE vendedores(id INTEGER PRIMARY KEY,nome TEXT,role TEXT,status TEXT);
    CREATE TABLE produtos(id INTEGER PRIMARY KEY,nome TEXT,ativo TEXT);
    CREATE TABLE producao_parametros_produto(
      id INTEGER PRIMARY KEY AUTOINCREMENT, produto_id INTEGER, pacotes_por_fardo INTEGER,
      valor_por_pacote REAL, ativo INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE clientes(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE clientes_avulsos(id INTEGER PRIMARY KEY,nome TEXT);
    CREATE TABLE visitas(
      id INTEGER PRIMARY KEY,vendedor_id INTEGER,cliente_id INTEGER,cliente_avulso_id INTEGER,
      status_registro TEXT
    );
    INSERT INTO vendedores VALUES
      (1,'Admin','admin','ativo'),(2,'Vendedor','vendedor','ativo');
    INSERT INTO produtos VALUES(1,'Produto teste','ativo');
    INSERT INTO producao_parametros_produto(produto_id,pacotes_por_fardo,valor_por_pacote,ativo,created_at,updated_at)
      VALUES(1,8,1.5,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);
    INSERT INTO clientes VALUES(1,'Cliente teste');
    INSERT INTO visitas VALUES(1,2,1,NULL,'ATIVA');
  `);
  for (const file of ['migracao_estoque_e1_1.sql', 'migracao_operacoes_pacote_v1.sql', 'migracao_operacoes_pacote_v1_1_local_bucket.sql']) {
    db.exec(fs.readFileSync(new URL(`./banco/${file}`, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO estoque_locais(nome,tipo,vendedor_id) VALUES
      ('ESTOQUE CENTRAL','CENTRAL',NULL),('CARGA - Vendedor','CARGA_VENDEDOR',2);
    INSERT INTO estoque_cargas(data_carga,vendedor_id,local_carga_id,status,aberta_por)
      VALUES('2026-09-19',2,2,'ABERTA',1);
    INSERT INTO estoque_carga_itens(carga_id,produto_id,quantidade_carregada)
      VALUES(1,1,1);
    INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id)
      VALUES('TRANSFERENCIA_CARGA','CONFIRMADA','2026-09-19','CARGA',1,'TRANSFERENCIA:1',1);
    INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,carga_item_id,quantidade,efeito)
      VALUES(1,1,1,1,1,1,-1),(1,2,1,1,1,1,1);
  `);

  function execute(sql, args) {
    const stmt = db.prepare(sql);
    const columns = stmt.columns();
    if (columns.length) return { success: true, results: stmt.all(...args), meta: {} };
    const result = stmt.run(...args);
    return { success: true, results: [], meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
  }
  const env = {
    db,
    DB: {
      prepare(sql) {
        return {
          sql, args: [],
          bind(...args) { this.args = args; return this; },
          async first() { return execute(sql, this.args).results[0] ?? null; },
          async all() { return execute(sql, this.args); },
          async run() { return execute(sql, this.args); },
        };
      },
      async batch(statements) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const results = statements.map(statement => execute(statement.sql, statement.args));
          db.exec('COMMIT');
          return results;
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
    },
  };
  return env;
}

function request(body) {
  return new Request('http://local.invalid', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(env, name, body, user, ids = []) {
  const response = await api[name](request(body), env, user, ...ids);
  return { status: response.status, body: await response.json() };
}

function saldos(env) {
  return env.db.prepare(`
    SELECT COALESCE(local_id,local_carga_id) local_id,bucket,
      SUM(quantidade_pacotes*efeito) saldo
    FROM estoque_pacote_movimentacoes
    WHERE produto_id=1
    GROUP BY COALESCE(local_id,local_carga_id),bucket
    ORDER BY local_id,bucket
  `).all();
}

async function saldoDaApi(env) {
  const response = await api.saldoPacotes(
    new Request('http://local.invalid/api/estoque/saldos-pacote'), env, admin, false,
  );
  return { status: response.status, body: await response.json() };
}

async function abrir(env) {
  return call(env, 'abrirFardoPacote', {
    chave_idempotencia: 'abertura-1', data_operacao: '2026-09-19', observacao: 'abertura local',
  }, vendedor, [1]);
}

async function trocar(env, chave = 'troca-1') {
  return call(env, 'operacaoComercialPacote', {
    produto_id: 1, quantidade_pacotes: 1, motivo: 'QUALIDADE',
    chave_idempotencia: chave, data_operacao: '2026-09-19', observacao: 'troca local',
  }, vendedor, [1, 'TROCA']);
}

test('A: abertura de fardo existente continua funcionando e grava local_id', async t => {
  const env = fixture(t);
  const resultado = await abrir(env);
  assert.equal(resultado.status, 201, JSON.stringify(resultado.body));
  const movimento = env.db.prepare("SELECT * FROM estoque_pacote_movimentacoes WHERE bucket='FRACIONADO_NOVO'").get();
  assert.equal(movimento.local_id, 2);
  assert.equal(movimento.local_carga_id, 2);
  assert.equal(movimento.quantidade_pacotes, 8);
});

test('B/C/E: nova troca segrega RETORNO_TROCA e preserva vínculos', async t => {
  const env = fixture(t);
  await abrir(env);
  const resultado = await trocar(env);
  assert.equal(resultado.status, 201, JSON.stringify(resultado.body));
  const operacao = env.db.prepare('SELECT * FROM estoque_pacote_operacoes WHERE tipo=\'TROCA\'').get();
  assert.equal(operacao.carga_id, 1);
  assert.equal(operacao.local_carga_id, 2);
  assert.equal(operacao.vendedor_id, 2);
  assert.equal(operacao.produto_id, 1);
  assert.equal(operacao.visita_id, 1);
  assert.equal(operacao.cliente_id, 1);
  assert.equal(env.db.prepare("SELECT COUNT(*) n FROM estoque_pacote_movimentacoes WHERE operacao_id=? AND bucket='DESCARTE_PENDENTE'").get(operacao.id).n, 0);
  assert.equal(env.db.prepare("SELECT COUNT(*) n FROM estoque_pacote_movimentacoes WHERE operacao_id=? AND bucket='RETORNO_TROCA' AND local_id=2 AND efeito=1").get(operacao.id).n, 1);
});

test('D: saldo de pacote não fica negativo', async t => {
  const env = fixture(t);
  const resultado = await trocar(env);
  assert.equal(resultado.status, 409);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM estoque_pacote_operacoes').get().n, 0);
});

test('F/G: estorno integral restaura exatamente os dois buckets e é idempotente', async t => {
  const env = fixture(t);
  await abrir(env);
  const troca = await trocar(env);
  const operacaoId = troca.body.operacao.id;
  const estorno = await call(env, 'estornarOperacaoPacote', {
    chave_idempotencia: 'estorno-1', data_operacao: '2026-09-19', observacao: 'estorno local',
  }, admin, [operacaoId]);
  assert.equal(estorno.status, 201, JSON.stringify(estorno.body));
  const repeticao = await call(env, 'estornarOperacaoPacote', {
    chave_idempotencia: 'estorno-1', data_operacao: '2026-09-19', observacao: 'estorno local',
  }, admin, [operacaoId]);
  assert.equal(repeticao.status, 200);
  assert.deepEqual(saldos(env).map(item => ({ local_id: item.local_id, bucket: item.bucket, saldo: item.saldo })), [
    { local_id: 2, bucket: 'FRACIONADO_NOVO', saldo: 8 },
    { local_id: 2, bucket: 'RETORNO_TROCA', saldo: 0 },
  ]);
});

test('H: movimento histórico sem local_id usa local_carga_id no fallback', async t => {
  const env = fixture(t);
  env.db.exec(`
    INSERT INTO estoque_operacoes(tipo,status,data_operacao,origem_tipo,origem_id,chave_idempotencia,usuario_id)
      VALUES('ABERTURA_FARDO','CONFIRMADA','2026-09-19','CARGA',1,'historico-fardo',2);
    INSERT INTO estoque_movimentacoes(operacao_id,local_id,produto_id,carga_id,carga_item_id,quantidade,efeito)
      VALUES(2,2,1,1,1,1,-1);
    INSERT INTO estoque_pacote_operacoes(tipo,status,carga_id,local_carga_id,vendedor_id,produto_id,quantidade_pacotes,pacotes_por_fardo_snapshot,estoque_operacao_fardo_id,observacao,chave_idempotencia,idempotencia_hash,usuario_id,data_operacao)
    VALUES('ABERTURA_FARDO','PREPARANDO',1,2,2,1,2,2,2,'historico','historico-1','hash',2,'2026-09-19');
    INSERT INTO estoque_pacote_movimentacoes(operacao_id,carga_id,local_carga_id,produto_id,bucket,quantidade_pacotes,efeito)
    VALUES(1,1,2,1,'FRACIONADO_NOVO',2,1);
    UPDATE estoque_pacote_operacoes SET status='CONFIRMADA',confirmado_em=CURRENT_TIMESTAMP WHERE id=1;
  `);
  const resultado = await saldoDaApi(env);
  assert.equal(resultado.status, 200);
  assert.equal(resultado.body.saldos[0].local_id, 2);
  assert.equal(resultado.body.saldos[0].saldo, 2);
});

test('I/J: saldoPacotes expõe localização nova e separa retorno de troca', async t => {
  const env = fixture(t);
  await abrir(env);
  await trocar(env);
  const resultado = await saldoDaApi(env);
  assert.equal(resultado.status, 200);
  assert.deepEqual(resultado.body.saldos.map(item => [item.local_id, item.bucket, item.saldo]), [
    [2, 'FRACIONADO_NOVO', 7],
    [2, 'RETORNO_TROCA', 1],
  ]);
});
