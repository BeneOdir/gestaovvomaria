-- Gestão Vovó Maria - Migração Vendas/Visitas V1.3
-- Execute no Console do D1 após já ter clientes e vendedores.

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT UNIQUE NOT NULL,
  categoria TEXT,
  unidade TEXT DEFAULT 'fardo',
  preco_padrao REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO produtos (nome, categoria, unidade, preco_padrao, ativo) VALUES
('Peta Palito 100g', 'Peta tradicional', 'fardo', 70.00, 1),
('Peta Palito 180g', 'Peta tradicional', 'fardo', 0, 1),
('Peta Argola 180g', 'Peta tradicional', 'fardo', 0, 1),
('Biscoito Argola 90g', 'Biscoito', 'fardo', 0, 1),
('Peta Temperada Cebola', 'Temperados', 'fardo', 0, 1),
('Peta Temperada Pimenta', 'Temperados', 'fardo', 0, 1),
('Peta Temperada Ervas Finas', 'Temperados', 'fardo', 0, 1),
('Pingo Cebola', 'Pingos temperados', 'fardo', 0, 1),
('Pingo Pimenta', 'Pingos temperados', 'fardo', 0, 1),
('Pingo Alho/Ervas', 'Pingos temperados', 'fardo', 0, 1);

CREATE TABLE IF NOT EXISTS visitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendedor_id INTEGER NOT NULL,
  cliente_id INTEGER NOT NULL,
  data_visita TEXT NOT NULL,
  comprou TEXT DEFAULT 'nao',
  valor_total REAL DEFAULT 0,
  observacoes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visita_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visita_id INTEGER NOT NULL,
  produto_id INTEGER,
  produto_nome TEXT NOT NULL,
  quantidade REAL DEFAULT 0,
  preco_unitario REAL DEFAULT 0,
  subtotal REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_visitas_data ON visitas(data_visita);
CREATE INDEX IF NOT EXISTS idx_visitas_cliente ON visitas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_visitas_vendedor ON visitas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_visita_itens_visita ON visita_itens(visita_id);
