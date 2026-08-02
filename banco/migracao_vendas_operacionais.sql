-- Gestão Vovó Maria - campos mínimos para venda, cliente avulso e caixa simples.
-- Aplicar uma única vez, de forma controlada, antes de publicar o Worker desta entrega.

ALTER TABLE visitas ADD COLUMN cliente_avulso_id INTEGER;
ALTER TABLE visitas ADD COLUMN forma_pagamento TEXT NOT NULL DEFAULT 'não informado';
ALTER TABLE visitas ADD COLUMN valor_recebido REAL NOT NULL DEFAULT 0;
ALTER TABLE visitas ADD COLUMN desconto REAL NOT NULL DEFAULT 0;
ALTER TABLE visitas ADD COLUMN situacao_pagamento TEXT NOT NULL DEFAULT 'pendente';

CREATE INDEX IF NOT EXISTS idx_visitas_cliente_avulso
  ON visitas(cliente_avulso_id);

CREATE INDEX IF NOT EXISTS idx_visitas_periodo_vendedor
  ON visitas(data_visita, vendedor_id);
