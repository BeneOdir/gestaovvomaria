-- Limpeza geral dos dados de teste
-- Mantém clientes, produtos, vendedores e usuários

-- Conferência antes
SELECT COUNT(*) AS visitas_antes FROM visitas;
SELECT COUNT(*) AS itens_antes FROM visita_itens;

-- Primeiro apaga a tabela filha
DELETE FROM visita_itens;

-- Depois a tabela principal
DELETE FROM visitas;

-- Conferência depois
SELECT COUNT(*) AS visitas_depois FROM visitas;
SELECT COUNT(*) AS itens_depois FROM visita_itens;