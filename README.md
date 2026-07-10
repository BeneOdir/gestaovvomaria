Gestão Vovó Maria - V1.3 provisória de uso diário do vendedor

Objetivo: permitir que o vendedor já use no dia a dia para registrar visitas/vendas e gerar relatório simples no fim do dia.

Arquivos:
- worker_vendas_v1_3.js -> cole no Worker da API, substituindo o código atual.
- migracao_vendas_visitas_v1_3.sql -> execute no Console do D1.
- visita.html -> publique no frontend junto com clientes.html e login.html.
- relatorio-dia.html -> publique no frontend.

Ordem:
1) Execute migracao_vendas_visitas_v1_3.sql no D1.
2) Cole worker_vendas_v1_3.js no Worker gestaovvomaria-api e implante.
3) Teste /api/health.
4) Publique visita.html e relatorio-dia.html no mesmo local do frontend.
5) Acesse visita.html após login.

Produtos iniciais cadastrados:
- Peta Palito 100g
- Peta Palito 180g
- Peta Argola 180g
- Biscoito Argola 90g
- Peta Temperada Cebola
- Peta Temperada Pimenta
- Peta Temperada Ervas Finas
- Pingo Cebola
- Pingo Pimenta
- Pingo Alho/Ervas
