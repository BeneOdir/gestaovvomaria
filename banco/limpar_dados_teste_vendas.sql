-- Gestão Vovó Maria - limpeza seletiva de vendas/visitas de teste
--
-- SEGURANÇA:
-- 1. Este arquivo não apaga nada enquanto a tabela temporária abaixo estiver vazia.
-- 2. Antes de executar, inclua SOMENTE IDs de visitas confirmadas como teste.
-- 3. Não use intervalo de datas ou vendedor sem conferir cada registro, pois esses
--    critérios também podem alcançar vendas reais.
-- 4. O script não altera schema permanente, índices ou sqlite_sequence.

-- Conferência global ANTES da limpeza (solicitada).
SELECT COUNT(*) FROM visitas;
SELECT COUNT(*) FROM visita_itens;

-- Tabela temporária restrita à conexão desta execução.
CREATE TEMP TABLE IF NOT EXISTS visitas_teste_alvo (
  visita_id INTEGER PRIMARY KEY
);

DELETE FROM visitas_teste_alvo;

-- INSIRA AQUI somente os IDs previamente conferidos como dados de teste.
-- Exemplo de preenchimento (mantenha comentado até confirmar os IDs):
-- INSERT INTO visitas_teste_alvo (visita_id) VALUES (101), (102), (103);

-- Conferência dos registros selecionados. Revise este resultado antes de liberar
-- os dois DELETEs abaixo em uma cópia operacional do arquivo.
SELECT
  v.id,
  v.data_visita,
  v.vendedor_id,
  v.cliente_id,
  v.cliente_avulso_id,
  v.comprou,
  v.valor_total,
  v.observacoes,
  v.created_at
FROM visitas v
INNER JOIN visitas_teste_alvo a ON a.visita_id = v.id
ORDER BY v.id;

SELECT COUNT(*) AS visitas_selecionadas
FROM visitas v
INNER JOIN visitas_teste_alvo a ON a.visita_id = v.id;

SELECT COUNT(*) AS itens_selecionados
FROM visita_itens vi
INNER JOIN visitas_teste_alvo a ON a.visita_id = vi.visita_id;

-- Ordem obrigatória: primeiro a tabela filha, depois a tabela principal.
DELETE FROM visita_itens
WHERE visita_id IN (SELECT visita_id FROM visitas_teste_alvo);

DELETE FROM visitas
WHERE id IN (SELECT visita_id FROM visitas_teste_alvo);

-- Conferência global DEPOIS da limpeza (solicitada).
SELECT COUNT(*) FROM visitas;
SELECT COUNT(*) FROM visita_itens;

-- Deve retornar zero para ambos os tipos de registro selecionado.
SELECT COUNT(*) AS visitas_alvo_restantes
FROM visitas
WHERE id IN (SELECT visita_id FROM visitas_teste_alvo);

SELECT COUNT(*) AS itens_alvo_restantes
FROM visita_itens
WHERE visita_id IN (SELECT visita_id FROM visitas_teste_alvo);

DROP TABLE visitas_teste_alvo;
