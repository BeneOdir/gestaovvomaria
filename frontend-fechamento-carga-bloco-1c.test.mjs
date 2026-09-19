import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Extrai as funções puras de frontend/cargas.html (sem DOM) para validar a lógica
// de conferência/fechamento do Bloco 1C, sem introduzir framework/dependência nova.
const html = fs.readFileSync(new URL('./frontend/cargas.html', import.meta.url), 'utf8');
function extrairFuncao(nome) {
  const inicio = html.indexOf(`function ${nome}(`);
  assert.ok(inicio >= 0, `função ${nome} não encontrada em cargas.html`);
  let i = html.indexOf('{', inicio), profundidade = 0, fim = -1;
  for (; i < html.length; i++) {
    if (html[i] === '{') profundidade++;
    else if (html[i] === '}') { profundidade--; if (profundidade === 0) { fim = i + 1; break; } }
  }
  assert.ok(fim > 0, `corpo de ${nome} não encontrado`);
  return html.slice(inicio, fim);
}

const fonte = `${extrairFuncao('computarItemFechamento')}\n${extrairFuncao('computarFechamentoCarga')}\nreturn { computarItemFechamento, computarFechamentoCarga };`;
const { computarItemFechamento, computarFechamentoCarga } = new Function(fonte)();

function produto(over = {}) {
  return { produto_id: 1, produto_nome: 'Produto', fardos_sistema: 0, pacotes_bons_sistema: 0, retorno_troca_sistema: 0, descarte_pendente: 0, ...over };
}

test('produto somente-pacote (zero fardos) é aceito e concilia com pacotes bons', () => {
  const p = produto({ produto_id: 2, fardos_sistema: 0, pacotes_bons_sistema: 5, retorno_troca_sistema: 0 });
  const item = computarItemFechamento(p, { fardos: '0', pacotesBons: '5', retornoTroca: '0' });
  assert.equal(item.valido, true);
  assert.equal(item.conciliado, true);
  assert.deepEqual(item.payload, { produto_id: 2, quantidade_fisica: 0, quantidade_pacotes_bons: 5, quantidade_retorno_troca: 0 });
});

test('produto somente-descarte (tudo zero, descarte pendente) aparece e concilia nas 3 quantidades físicas', () => {
  const p = produto({ produto_id: 4, fardos_sistema: 0, pacotes_bons_sistema: 0, retorno_troca_sistema: 0, descarte_pendente: 3 });
  const item = computarItemFechamento(p, { fardos: '0', pacotesBons: '0', retornoTroca: '0' });
  assert.equal(item.valido, true);
  assert.equal(item.conciliado, true);
  assert.equal('quantidade_descarte' in item.payload, false);
  assert.deepEqual(Object.keys(item.payload).sort(), ['produto_id', 'quantidade_fisica', 'quantidade_pacotes_bons', 'quantidade_retorno_troca'].sort());
});

test('as três quantidades físicas são independentes entre si', () => {
  const p = produto({ produto_id: 5, fardos_sistema: 2, pacotes_bons_sistema: 3, retorno_troca_sistema: 1 });
  const item = computarItemFechamento(p, { fardos: '2', pacotesBons: '999', retornoTroca: '1' });
  assert.equal(item.diferencaFardos, 0);
  assert.equal(item.diferencaPacotesBons, 996);
  assert.equal(item.diferencaRetornoTroca, 0);
  assert.equal(item.conciliado, false, 'divergência em um campo não deve ser mascarada pelos outros dois');
});

test('valores inválidos (vazio, negativo, não inteiro) tornam o item inválido', () => {
  const p = produto({ produto_id: 6, fardos_sistema: 1 });
  assert.equal(computarItemFechamento(p, { fardos: '', pacotesBons: '0', retornoTroca: '0' }).valido, false);
  assert.equal(computarItemFechamento(p, { fardos: '-1', pacotesBons: '0', retornoTroca: '0' }).valido, false);
  assert.equal(computarItemFechamento(p, { fardos: '1.5', pacotesBons: '0', retornoTroca: '0' }).valido, false);
});

test('computarFechamentoCarga monta payload sem DESCARTE_PENDENTE para toda a fotografia', () => {
  const produtos = [
    produto({ produto_id: 1, fardos_sistema: 2 }),
    produto({ produto_id: 2, pacotes_bons_sistema: 8 }),
    produto({ produto_id: 3, retorno_troca_sistema: 1 }),
    produto({ produto_id: 4, descarte_pendente: 2 }),
  ];
  const entradas = {
    1: { fardos: '2', pacotesBons: '0', retornoTroca: '0' },
    2: { fardos: '0', pacotesBons: '8', retornoTroca: '0' },
    3: { fardos: '0', pacotesBons: '0', retornoTroca: '1' },
    4: { fardos: '0', pacotesBons: '0', retornoTroca: '0' },
  };
  const { valido, payload } = computarFechamentoCarga(produtos, entradas);
  assert.equal(valido, true);
  assert.equal(payload.length, 4);
  payload.forEach(item => assert.deepEqual(Object.keys(item).sort(), ['produto_id', 'quantidade_fisica', 'quantidade_pacotes_bons', 'quantidade_retorno_troca'].sort()));
  assert.equal(payload.some(item => 'descarte_pendente' in item || 'quantidade_descarte' in item), false);
});

test('divergência em qualquer produto impede a conciliação geral (não fecha à força)', () => {
  const produtos = [produto({ produto_id: 1, fardos_sistema: 2 }), produto({ produto_id: 2, pacotes_bons_sistema: 8 })];
  const entradas = { 1: { fardos: '2', pacotesBons: '0', retornoTroca: '0' }, 2: { fardos: '0', pacotesBons: '7', retornoTroca: '0' } };
  const { valido } = computarFechamentoCarga(produtos, entradas);
  assert.equal(valido, false);
});
