-- Gestão Vovó Maria - pagamentos combinados por visita.
-- Migração local: não remove nem altera os campos legados de visitas.

CREATE TABLE IF NOT EXISTS visita_pagamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visita_id INTEGER NOT NULL,
  forma_pagamento TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visita_pagamentos_visita_id
  ON visita_pagamentos(visita_id);

