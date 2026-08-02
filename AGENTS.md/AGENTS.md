# AGENTS.md

## Projeto

Gestão Vovó Maria

Sistema de gestão comercial da Vovó Maria Pães e Biscoitos.

Objetivo de longo prazo:
Evoluir de um CRM comercial para um ERP completo.

---

## Tecnologias

- Frontend HTML + JavaScript
- Cloudflare Workers
- Cloudflare D1
- GitHub
- VS Code
- Wrangler

---

## Fluxo de trabalho

Antes de alterar qualquer arquivo:

1. Ler este AGENTS.md.
2. Analisar os arquivos envolvidos.
3. Explicar o plano.
4. Alterar somente os arquivos autorizados.
5. Informar quais arquivos foram alterados.
6. Sugerir testes.
7. Nunca fazer commit automaticamente.
8. Nunca fazer deploy automaticamente.

---

## Regras do projeto

Preservar funcionalidades existentes.

Não remover funcionalidades sem autorização.

Não alterar banco de dados sem autorização.

Não alterar autenticação sem autorização.

Não alterar worker.js sem autorização.

---

## Estilo de desenvolvimento

Mudanças pequenas.

Um passo por vez.

Primeiro analisar.

Depois implementar.

Depois testar.

Depois Git Commit.

---

## Público

Sistema utilizado por vendedores em campo.

Prioridades:

- simplicidade
- rapidez
- fontes grandes
- poucos cliques
- telas limpas

---

## Regras comerciais

### Registros de teste

Um registro de visita/venda é considerado de teste quando o campo `observacoes`
contém a palavra inteira `TESTE`, ignorando maiúsculas e minúsculas.

Exemplos reconhecidos: `TESTE`, `teste`, `Teste` e `Treinamento - TESTE`.
Palavras que apenas contêm essa sequência como parte de outra palavra não são
consideradas registros de teste.

Relatórios, faturamento, comissões, rankings, produtos vendidos e indicadores
oficiais devem excluir esses registros automaticamente. Consultas específicas
de teste devem usar exclusivamente esses registros e preservar os filtros de
permissão por vendedor.

Cliente Avulso ≠ Venda Varejo.

Toda venda deve entrar no relatório.

O relatório diário deve permitir conferência do caixa.

Separar:

- vendas
- recebimentos
- contas a receber
- devoluções
- trocas
- bonificações
- perdas

---

## Sempre informar

Arquivos alterados.

Resumo das alterações.

Testes recomendados.

Possíveis riscos.

---

## Infraestrutura oficial — Gestão Vovó Maria

- Repositório GitHub: `BeneOdir/gestaovvomaria`
- Frontend Cloudflare Pages: `https://gestaovvomaria.pages.dev`
- Worker/API: `gestaovomaria-api`
- URL oficial da API: `https://gestaovomaria-api.odir-bene12.workers.dev`
- Banco D1: `gestaovovomaria-db`
- Database ID: `2f0bf025-6686-410c-a6d7-a720668d8ff2`
- Binding: `DB`

### Regras de infraestrutura

1. Não criar outro Worker, Pages, banco ou repositório com nome semelhante.
2. Todo frontend deve chamar somente a URL oficial da API.
3. Todo deploy do Worker deve partir do `wrangler.jsonc` oficial.
4. Antes de qualquer alteração no Cloudflare, conferir nome, URL e ID completos.
5. Recursos antigos não devem ser utilizados nem excluídos sem auditoria específica.
6. Não alterar nomes oficiais apenas para padronização visual.
7. A diferença entre os nomes dos recursos é conhecida e aceita:
   - GitHub/Pages: `gestaovvomaria`
   - Worker/API: `gestaovomaria-api`
   - Banco D1: `gestaovovomaria-db`
