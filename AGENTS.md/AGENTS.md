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

### Evidência confirmada de produção — 28/08/2026

Verificação visual realizada no painel Cloudflare confirmou:

- Worker de produção: `gestaovomaria-api`.
- Versão ativa observada: `9eb3d4d8`.
- Tráfego observado: `100%`.
- Binding D1: `DB`.
- Banco D1 efetivamente vinculado: `gestaovovomaria-db`.
- Database ID confirmado: `2f0bf025-6686-410c-a6d7-a720668d8ff2`.
- O endpoint da versão ativa respondeu `status: ok` e `banco: conectado`.
- O banco conectado apresentou as tabelas `estoque_pacote_operacoes`,
  `estoque_pacote_movimentacoes` e `bonificacao_fardo_solicitacoes`.

Consequentemente, a estrutura de operações por pacote está presente no banco
efetivamente utilizado pelo Worker de produção. Qualquer indicação anterior de
que a migration de operações por pacote ainda não estava aplicada em produção
deve ser considerada superada por esta evidência de 28/08/2026.

### D1 adicional pendente de auditoria

Existe na conta outro banco D1 chamado `gestaovovomaria_db`, com Database ID
`5143b476-9d2f-4163-b880-a525a64352e5`. Ele não foi identificado como binding do
Worker de produção atual. Sua origem permanece pendente de auditoria e esse recurso
não deve ser alterado, migrado, renomeado ou excluído sem investigação específica.

### Intervenção 1 — página Clientes — VALIDADA E APROVADA em 28/08/2026

A reorganização visual e navegacional da página Clientes foi validada em uso
local e aprovada com o seguinte escopo:

- Separação da tela em `Localizar clientes` e `Cadastrar cliente`.
- `Localizar clientes` definida como área inicial.
- Formulário de cadastro preservado e acessível sob demanda.
- A lista completa de clientes não é mais exibida automaticamente.
- Os resultados aparecem somente depois de uma pesquisa.
- `Limpar busca` retorna a tela ao estado sem resultados.
- Buscas validadas em uso local.
- Cadastro de cliente validado e funcionando.
- Cards e ações `Ver dados do cliente` e `Registrar visita/venda` preservados.
- Nenhum Worker, D1, migration ou regra de negócio foi alterado.

A funcionalidade `Editar cadastro de cliente`, anteriormente pendente, foi
tratada e validada na Intervenção 2 descrita a seguir.

### Encerramento das intervenções de Clientes — VALIDADO E APROVADO em 28/08/2026

As intervenções de reorganização, localização e correção cadastral da página
Clientes foram validadas no ambiente local com o seguinte resultado:

- Separação da tela entre `Localizar clientes` e `Cadastrar cliente` preservada.
- A lista completa de clientes não é exibida automaticamente.
- A busca pelo campo principal é executada automaticamente a partir de 3 caracteres.
- Com 0, 1 ou 2 caracteres, nenhum resultado é exibido.
- Ao reduzir novamente o texto para menos de 3 caracteres, os resultados
  desaparecem da tela.
- O botão `Pesquisar` foi preservado para aplicação dos filtros existentes.
- A escolha de origem `Local`/`Nuvem` foi preservada.
- A visualização dos dados do cliente foi preservada.
- A edição/correção de cliente formal por usuário ADMIN foi validada em laboratório.
- O salvamento por `PUT /api/clientes/:id` foi validado contra o D1 local.
- A correção preservou o mesmo `id` do cliente.
- A persistência dos dados corrigidos foi confirmada por nova consulta da aplicação
  e por `SELECT --local`, incluindo avanço do campo `updated_at`.

Durante a validação técnica, foi removida de `buscarClienteFormalPorId()`, em
`worker/worker.js`, a coluna inexistente `tipo_cliente` do `SELECT`. A coluna não
faz parte do schema-base de `clientes`, não é necessária para identificar o cliente
formal e não é utilizada pelo fluxo de atualização. Os demais campos retornados,
o marcador `'cliente' AS tipo_origem`, a restrição de edição para ADMIN e a
proteção de concorrência por `updated_at` foram preservados.

Esta aprovação registra o comportamento validado em laboratório local. Não
representa deploy nem publicação da Intervenção 2 em produção.

### Reorganização visual da Produção V1.1 — VALIDADA E APROVADA em 28/08/2026

A reorganização visual e navegacional da página Produção V1.1 foi validada e
aprovada localmente com o seguinte escopo:

- Foram criadas as áreas `Operar produção`, `Consultar lotes` e `Parâmetros`.
- `Operar produção` permanece como área inicial da página.
- As operações, validações, proteções e regras de produção existentes foram
  integralmente preservadas.
- A consulta do histórico e o detalhe dos lotes foram validados.
- O lote aberto, suas seleções e seus dados permaneceram íntegros durante a
  alternância entre as áreas.
- A área `Parâmetros` permanece restrita ao perfil ADMIN, incluindo as
  restrições já existentes para o ambiente TESTE.

Esta validação foi realizada somente no ambiente local e não representa deploy
nem publicação da reorganização da Produção V1.1 em produção.

### Reorganização visual do Estoque Central — VALIDADA E APROVADA em 28/08/2026

A reorganização visual e navegacional do Estoque Central foi validada e aprovada
no ambiente local/laboratório com o seguinte resultado:

- `frontend/estoque.html` foi reorganizado nas áreas `Saldo e operações`,
  `Movimentações` e `Pendências sem baixa`.
- `Saldo e operações` permanece como área inicial.
- As operações `Entrada`, `Ajuste` e `Inventário inicial`, bem como o saldo e a
  inicialização do Estoque Central, foram preservadas.
- O histórico e seus filtros ficaram reunidos em `Movimentações`.
- As vendas `SEM_BAIXA` e sua ação de conciliação ficaram reunidas em
  `Pendências sem baixa`.
- A abertura dos três modos do modal — `Entrada`, `Ajuste` e `Inventário inicial`
  — foi validada no celular, sem executar nem confirmar movimentações.
- A alternância entre as três áreas foi validada em computador e celular.
- Não foram observados erros funcionais no console durante a validação.
- O refinamento responsivo da navegação foi executado, validado e aprovado em
  28/08/2026, no ambiente local/laboratório.
- Em telas de até 460 px, a navegação passou para duas colunas: `Saldo e operações`
  e `Movimentações` ficam lado a lado, enquanto `Pendências sem baixa` ocupa toda a
  segunda linha.
- A validação foi realizada no viewport 393 × 843, no qual as três opções ficaram
  integralmente visíveis, sem corte e sem rolagem horizontal da navegação.
- A alternância entre as áreas permaneceu funcionando e as tabelas mantiveram seu
  comportamento próprio de rolagem horizontal.
- Nenhuma regra ou funcionalidade do Estoque Central foi modificada pelo
  refinamento.
- O erro `favicon.ico 404` observado durante o teste é externo à funcionalidade
  validada e não bloqueou a aprovação.

Esta intervenção não alterou Worker, D1, migrations, endpoints, payloads nem
regras de estoque. A aprovação refere-se exclusivamente ao ambiente
local/laboratório e não representa deploy nem publicação em produção.

### Reorganização visual de Relatórios — VALIDADA E APROVADA em 28/08/2026

A reorganização visual da área de resultados de Relatórios foi validada e
aprovada no ambiente local/laboratório com o seguinte resultado:

- `frontend/relatorio-dia.html` foi reorganizado nas áreas `Resumo`, `Produtos`,
  `Clientes`, `Vendas` e `Canceladas`.
- Apenas uma área fica visível por vez.
- `Resumo` é a área inicial e volta a ser selecionada após nova geração ou
  recarregamento do relatório.
- A alternância entre as áreas não gera nova chamada de API nem reconstrói o
  relatório.
- As funcionalidades existentes de `Vendas`, incluindo `Ver ticket` e
  `Gerenciar`, foram preservadas.
- A validação foi concluída em desktop e no celular com viewport 393 × 843.
- No celular, a navegação fica em duas colunas, com `Canceladas` ocupando toda a
  última linha.
- Não foram identificados erros funcionais no console durante a validação.
- A impressão continua contemplando o relatório completo, independentemente da
  área visível na tela.
- O possível redimensionamento ou compactação do comprovante de compra não foi
  aprovado, não integra esta intervenção e permanece somente para avaliação
  futura.

Esta aprovação refere-se exclusivamente ao ambiente local/laboratório e ainda
não representa deploy nem publicação da reorganização de Relatórios em produção.
