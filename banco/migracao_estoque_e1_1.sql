-- Gestao Vovo Maria
-- Sprint E1.1 - Estrutura inicial de Estoque Operacional e Carga do Vendedor
--
-- OBJETIVO
-- Criar exclusivamente as estruturas novas do modulo de estoque:
--   1. locais de estoque;
--   2. operacoes auditaveis;
--   3. movimentacoes por produto e local;
--   4. cargas diarias dos vendedores;
--   5. itens e conferencia das cargas;
--   6. ocorrencias operacionais do fechamento.
--
-- IMPORTANTE
-- - Esta migration NAO altera produtos, visitas, visita_itens, vendedores ou
--   qualquer outra estrutura do modulo Comercial.
-- - Esta migration NAO cria dados iniciais e NAO reconstrui vendas historicas.
-- - O saldo inicial devera ser registrado posteriormente por uma operacao de
--   inventario confirmada, depois da contagem fisica.
-- - O saldo de um produto em um local sera sempre calculado por:
--       SUM(quantidade * efeito)
-- - Movimentacoes confirmadas nao devem ser editadas nem apagadas. Correcoes
--   futuras deverao gerar operacoes de estorno ou ajuste.
-- - As referencias internas entre as novas tabelas usam FOREIGN KEYs. As
--   referencias para tabelas comerciais permanecem logicas e serao validadas
--   pela API, evitando acoplar o estoque ao ciclo de exclusao do Comercial.
-- - Os tipos de operacao e de local permanecem TEXT para permitir expansao do
--   modulo sem reconstruir tabelas. Os valores oficiais devem ser controlados
--   pela API e documentados abaixo.
--
-- VALORES INICIAIS ESPERADOS
-- estoque_locais.tipo:
--   CENTRAL | CARGA_VENDEDOR
-- estoque_operacoes.tipo:
--   INVENTARIO_INICIAL | ENTRADA | TRANSFERENCIA_CARGA | SAIDA_VENDA |
--   RETORNO_CARGA | AJUSTE_ENTRADA | AJUSTE_SAIDA | INVENTARIO_AJUSTE |
--   ESTORNO | ENTRADA_PRODUCAO
-- estoque_operacoes.origem_tipo:
--   INVENTARIO | CARGA | VENDA | AJUSTE | PRODUCAO

-- --------------------------------------------------------------------------
-- 1. LOCAIS DE ESTOQUE
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estoque_locais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL
    CHECK (LENGTH(TRIM(nome)) > 0),
  tipo TEXT NOT NULL
    CHECK (LENGTH(TRIM(tipo)) > 0),
  vendedor_id INTEGER
    CHECK (vendedor_id IS NULL OR vendedor_id > 0),
  ativo INTEGER NOT NULL DEFAULT 1
    CHECK (ativo IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Todo local do tipo CARGA_VENDEDOR deve pertencer a um vendedor.
  CHECK (tipo <> 'CARGA_VENDEDOR' OR vendedor_id IS NOT NULL)
);

-- Permite somente um Estoque Central ativo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_locais_central_ativo
  ON estoque_locais(tipo)
  WHERE tipo = 'CENTRAL' AND ativo = 1;

-- Permite somente um local de carga por vendedor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_locais_carga_vendedor
  ON estoque_locais(vendedor_id)
  WHERE tipo = 'CARGA_VENDEDOR';

CREATE INDEX IF NOT EXISTS idx_estoque_locais_tipo_ativo
  ON estoque_locais(tipo, ativo);

CREATE INDEX IF NOT EXISTS idx_estoque_locais_vendedor
  ON estoque_locais(vendedor_id);

-- --------------------------------------------------------------------------
-- 2. CABECALHO AUDITAVEL DAS OPERACOES
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estoque_operacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL
    CHECK (LENGTH(TRIM(tipo)) > 0),
  status TEXT NOT NULL DEFAULT 'CONFIRMADA'
    CHECK (status IN ('CONFIRMADA', 'ESTORNADA')),
  data_operacao TEXT NOT NULL
    CHECK (LENGTH(data_operacao) = 10),
  origem_tipo TEXT
    CHECK (origem_tipo IS NULL OR LENGTH(TRIM(origem_tipo)) > 0),
  origem_id INTEGER
    CHECK (origem_id IS NULL OR origem_id > 0),
  chave_idempotencia TEXT NOT NULL
    CHECK (LENGTH(TRIM(chave_idempotencia)) > 0),
  operacao_estornada_id INTEGER
    CHECK (operacao_estornada_id IS NULL OR operacao_estornada_id > 0),
  usuario_id INTEGER
    CHECK (usuario_id IS NULL OR usuario_id > 0),
  observacao TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (chave_idempotencia),
  CHECK (operacao_estornada_id IS NULL OR operacao_estornada_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_estoque_operacoes_data_tipo
  ON estoque_operacoes(data_operacao, tipo);

CREATE INDEX IF NOT EXISTS idx_estoque_operacoes_origem
  ON estoque_operacoes(origem_tipo, origem_id);

CREATE INDEX IF NOT EXISTS idx_estoque_operacoes_estornada
  ON estoque_operacoes(operacao_estornada_id);

CREATE INDEX IF NOT EXISTS idx_estoque_operacoes_usuario
  ON estoque_operacoes(usuario_id);

-- Uma operacao original pode receber no maximo um estorno direto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_operacoes_estorno_unico
  ON estoque_operacoes(operacao_estornada_id)
  WHERE operacao_estornada_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- 3. CARGAS DIARIAS DOS VENDEDORES
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estoque_cargas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_carga TEXT NOT NULL
    CHECK (LENGTH(data_carga) = 10),
  vendedor_id INTEGER NOT NULL
    CHECK (vendedor_id > 0),
  local_carga_id INTEGER NOT NULL
    CHECK (local_carga_id > 0),
  status TEXT NOT NULL DEFAULT 'ABERTA'
    CHECK (status IN ('ABERTA', 'FECHADA', 'CANCELADA')),
  aberta_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  aberta_por INTEGER NOT NULL
    CHECK (aberta_por > 0),
  fechada_em DATETIME,
  fechada_por INTEGER
    CHECK (fechada_por IS NULL OR fechada_por > 0),
  cancelada_em DATETIME,
  cancelada_por INTEGER
    CHECK (cancelada_por IS NULL OR cancelada_por > 0),
  motivo_cancelamento TEXT,
  observacoes_abertura TEXT,
  observacoes_fechamento TEXT,

  -- Resumo operacional coletado no fechamento da rota.
  clientes_nao_visitados INTEGER NOT NULL DEFAULT 0
    CHECK (clientes_nao_visitados >= 0),
  fardos_nao_atendidos REAL NOT NULL DEFAULT 0
    CHECK (fardos_nao_atendidos >= 0),
  motivo_principal TEXT
    CHECK (
      motivo_principal IS NULL OR motivo_principal IN (
        'FALTA_TEMPO',
        'FALTA_PRODUTO',
        'PROBLEMA_MECANICO',
        'OUTRO'
      )
    ),
  percepcao_rota TEXT
    CHECK (
      percepcao_rota IS NULL OR percepcao_rota IN (
        'NORMAL',
        'APERTADA',
        'MUITO_APERTADA'
      )
    ),
  observacao_rota TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Coerencia completa dos estados operacionais da carga:
  -- ABERTA nao possui fechamento nem cancelamento;
  -- FECHADA possui fechamento e nao possui cancelamento;
  -- CANCELADA possui auditoria de cancelamento e nao equivale a fechamento.
  CHECK (
    (
      status = 'ABERTA'
      AND fechada_em IS NULL
      AND fechada_por IS NULL
      AND cancelada_em IS NULL
      AND cancelada_por IS NULL
      AND motivo_cancelamento IS NULL
    )
    OR (
      status = 'FECHADA'
      AND fechada_em IS NOT NULL
      AND fechada_por IS NOT NULL
      AND cancelada_em IS NULL
      AND cancelada_por IS NULL
      AND motivo_cancelamento IS NULL
    )
    OR (
      status = 'CANCELADA'
      AND fechada_em IS NULL
      AND fechada_por IS NULL
      AND cancelada_em IS NOT NULL
      AND cancelada_por IS NOT NULL
      AND motivo_cancelamento IS NOT NULL
      AND LENGTH(TRIM(motivo_cancelamento)) > 0
    )
  ),

  FOREIGN KEY (local_carga_id)
    REFERENCES estoque_locais(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

-- Impede duas cargas abertas simultaneamente para o mesmo vendedor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_cargas_aberta_vendedor
  ON estoque_cargas(vendedor_id)
  WHERE status = 'ABERTA';

-- Impede mais de uma carga valida do vendedor na mesma data. Uma carga
-- cancelada nao bloqueia a criacao de uma nova carga para a data.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_cargas_vendedor_data_valida
  ON estoque_cargas(vendedor_id, data_carga)
  WHERE status <> 'CANCELADA';

CREATE INDEX IF NOT EXISTS idx_estoque_cargas_data_status
  ON estoque_cargas(data_carga, status);

CREATE INDEX IF NOT EXISTS idx_estoque_cargas_local
  ON estoque_cargas(local_carga_id);

-- Historico completo do vendedor, incluindo cargas canceladas.
CREATE INDEX IF NOT EXISTS idx_estoque_cargas_vendedor_data
  ON estoque_cargas(vendedor_id, data_carga);

-- --------------------------------------------------------------------------
-- 4. ITENS E CONFERENCIA DAS CARGAS
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estoque_carga_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carga_id INTEGER NOT NULL
    CHECK (carga_id > 0),
  produto_id INTEGER NOT NULL
    CHECK (produto_id > 0),
  quantidade_carregada REAL NOT NULL
    CHECK (quantidade_carregada > 0),
  quantidade_retornada REAL
    CHECK (quantidade_retornada IS NULL OR quantidade_retornada >= 0),

  -- Fotografias documentais preenchidas somente no fechamento. O livro de
  -- movimentacoes continua sendo a fonte oficial para calculo de saldo.
  quantidade_vendida_fechamento REAL
    CHECK (
      quantidade_vendida_fechamento IS NULL
      OR quantidade_vendida_fechamento >= 0
    ),
  saldo_esperado_fechamento REAL,
  diferenca_fechamento REAL,
  observacao TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (carga_id, produto_id),

  FOREIGN KEY (carga_id)
    REFERENCES estoque_cargas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_estoque_carga_itens_produto
  ON estoque_carga_itens(produto_id);

-- --------------------------------------------------------------------------
-- 5. MOVIMENTACOES POR LOCAL E PRODUTO
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estoque_movimentacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operacao_id INTEGER NOT NULL
    CHECK (operacao_id > 0),
  local_id INTEGER NOT NULL
    CHECK (local_id > 0),
  produto_id INTEGER NOT NULL
    CHECK (produto_id > 0),
  carga_id INTEGER
    CHECK (carga_id IS NULL OR carga_id > 0),
  carga_item_id INTEGER
    CHECK (carga_item_id IS NULL OR carga_item_id > 0),
  visita_id INTEGER
    CHECK (visita_id IS NULL OR visita_id > 0),
  visita_item_id INTEGER
    CHECK (visita_item_id IS NULL OR visita_item_id > 0),
  quantidade REAL NOT NULL
    CHECK (quantidade > 0),
  efeito INTEGER NOT NULL
    CHECK (efeito IN (-1, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- IDs de detalhe nunca podem existir sem seus respectivos cabecalhos.
  CHECK (visita_item_id IS NULL OR visita_id IS NOT NULL),
  CHECK (carga_item_id IS NULL OR carga_id IS NOT NULL),

  FOREIGN KEY (operacao_id)
    REFERENCES estoque_operacoes(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  FOREIGN KEY (local_id)
    REFERENCES estoque_locais(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  FOREIGN KEY (carga_id)
    REFERENCES estoque_cargas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  FOREIGN KEY (carga_item_id)
    REFERENCES estoque_carga_itens(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_estoque_movimentacoes_operacao
  ON estoque_movimentacoes(operacao_id);

CREATE INDEX IF NOT EXISTS idx_estoque_movimentacoes_saldo
  ON estoque_movimentacoes(local_id, produto_id);

CREATE INDEX IF NOT EXISTS idx_estoque_movimentacoes_produto_data
  ON estoque_movimentacoes(produto_id, created_at);

CREATE INDEX IF NOT EXISTS idx_estoque_movimentacoes_carga
  ON estoque_movimentacoes(carga_id, produto_id);

CREATE INDEX IF NOT EXISTS idx_estoque_movimentacoes_carga_item
  ON estoque_movimentacoes(carga_item_id);

CREATE INDEX IF NOT EXISTS idx_estoque_movimentacoes_visita
  ON estoque_movimentacoes(visita_id);

-- Protecao principal contra baixa duplicada de um item de venda. Estornos
-- usam efeito positivo e, portanto, nao conflitam com a saida original.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_movimentacoes_saida_visita_item
  ON estoque_movimentacoes(visita_item_id)
  WHERE visita_item_id IS NOT NULL AND efeito = -1;

-- Evita duplicar a mesma combinacao de produto, local e efeito dentro de uma
-- unica operacao. Transferencias continuam aceitando uma linha por local.
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_movimentacoes_operacao_linha
  ON estoque_movimentacoes(operacao_id, local_id, produto_id, efeito);

-- --------------------------------------------------------------------------
-- 6. OCORRENCIAS OPERACIONAIS DA ROTA E DO FECHAMENTO
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS estoque_carga_ocorrencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  carga_id INTEGER NOT NULL
    CHECK (carga_id > 0),
  tipo TEXT NOT NULL
    CHECK (
      tipo IN (
        'CLIENTE_NAO_VISITADO',
        'PEDIDO_NAO_ATENDIDO',
        'PRODUTO_FALTOU_ROTA'
      )
    ),
  produto_id INTEGER
    CHECK (produto_id IS NULL OR produto_id > 0),
  cliente_id INTEGER
    CHECK (cliente_id IS NULL OR cliente_id > 0),
  cliente_avulso_id INTEGER
    CHECK (cliente_avulso_id IS NULL OR cliente_avulso_id > 0),
  quantidade REAL
    CHECK (quantidade IS NULL OR quantidade > 0),
  motivo TEXT
    CHECK (
      motivo IS NULL OR motivo IN (
        'FALTA_TEMPO',
        'FALTA_PRODUTO',
        'PROBLEMA_MECANICO',
        'OUTRO'
      )
    ),
  descricao TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Uma ocorrencia nao pode apontar simultaneamente para cliente cadastrado e
  -- cliente avulso.
  CHECK (cliente_id IS NULL OR cliente_avulso_id IS NULL),

  FOREIGN KEY (carga_id)
    REFERENCES estoque_cargas(id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_estoque_carga_ocorrencias_carga
  ON estoque_carga_ocorrencias(carga_id, tipo);

CREATE INDEX IF NOT EXISTS idx_estoque_carga_ocorrencias_produto
  ON estoque_carga_ocorrencias(produto_id);

-- --------------------------------------------------------------------------
-- FIM DA MIGRATION E1.1
--
-- Esta migration cria somente estrutura. Depois de revisada e executada em
-- etapa futura, ainda serao necessarios procedimentos separados e autorizados
-- para:
--   1. cadastrar o Estoque Central;
--   2. cadastrar um local de carga para cada vendedor;
--   3. registrar o inventario/saldo inicial confirmado;
--   4. integrar novas vendas sem reprocessar automaticamente o historico.
-- --------------------------------------------------------------------------
