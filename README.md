# Dairysistem — gestão de rebanho leiteiro (um sistema por fazenda)

Um código só, uma cópia por fazenda, cada uma com **banco de dados próprio** (isolamento total).
O que muda entre fazendas está em `farms/<fazenda>/farm.config.json` (nome, logotipo, endereço, usuários iniciais).
Nenhum nome de fazenda fica no código.

**Estado atual (piloto):** qualidade do leite + dashboards, relatório de controle leiteiro por vaca (CCS mês a mês, LAC/DEL,
situação sadia/curada/nova infecção/crônica), resultados do tanque, animais (cadastro mínimo), login com perfis,
lançamento manual com fila offline, importação de planilhas, exportação, auditoria. Visual DairyUp (Figma).
**Regras provisórias** (a confirmar): situação da vaca pelas duas últimas coletas, meta de CCS = 200 mil, paridas = LAC ≥ 2.
**Desempenho zootécnico** (menu *Desempenho*): painel mensal no formato da planilha "Zootécnico" — dados de entrada, produção, reprodução, transição, recria, saída, saúde e curva de lactação. Você digita (ou importa) só os números; percentuais, taxas e projeções são calculados com as fórmulas da planilha. Mostra resumo com o que **piorou/melhorou** contra o mesmo mês do ano anterior, gráficos ano a ano, metas por indicador e lançamento mensal.
Eventos individuais, bezerras, financeiro e áreas agrícolas entram nas próximas etapas (cada um como módulo).

## Rodar no seu computador / teste
```bash
npm install
cp .env.example .env          # ajuste FARM e DATABASE_URL
npm run migrate               # cria/atualiza as tabelas
npm run seed                  # cria usuários iniciais (senhas temporárias aparecem uma vez)
npm start                     # http://localhost:3000
npm run demo-data             # (só local) 300 vacas fictícias, 12 meses; senha de teste: demo12345
npm test                      # testes automáticos (usa o banco dairy_test)
```

## Criar uma fazenda nova
```bash
npm run new-farm -- sao-jose "Fazenda São José" --owner-email dono@exemplo.com --domain saojose.exemplo.com
# edite farms/sao-jose/farm.config.json e troque o logo.svg
FARM=sao-jose DATABASE_URL=<banco desta fazenda> npm run seed
FARM=sao-jose DATABASE_URL=<banco desta fazenda> npm start
```
Na AWS (etapa de infraestrutura, ainda por fazer) esses passos viram **um único comando**.

## Planilhas aceitas (Importar)
Excel `.xlsx` ou CSV. Colunas reconhecidas sem configurar nada: **Brinco** (ou Animal/Vaca/Número), **Data**,
**Lote** (opcional) e as análises pelo nome (CCS, Gordura, Proteína, CBT…; aliases configuráveis).
Formato "longo" (colunas Tipo + Valor) também funciona. Reenviar o mesmo arquivo **não duplica** (atualiza).
**Relatórios oficiais do controle leiteiro (APCBRH)** são reconhecidos sozinhos: o *Relatório 2* (Sumário de CCS e produção: 12 controles, CCS, leite, gordura, proteína, LAC, parto, registro e tanque) e o *Relatório 2.2* (Impacto da CCS no tanque: lote, parto, produção). Vaca marcada "BAIXA" entra como descartada. O impacto no tanque usa a mesma conta do relatório oficial (CCS × leite ÷ soma de CCS × leite; conferida em 404 vacas). Exemplos em `docs/exemplos/`. Para o mapa do leite do laticínio, escolha "Mapa do leite (tanque)".
Novas análises (ureia, lactose…) são criadas na tela **Mais → Tipos de análise**, sem mexer no código.

## Desempenho zootécnico: planilha aceita
Excel `.xlsx` com **uma aba por ano** (nome `2025`, `2026`…), meses Jan…Dez em colunas e um indicador por linha (exemplo: `docs/exemplos/zootecnico-exemplo.xlsx`). Em **Desempenho → Importar planilha** aparece uma prévia; só grava ao confirmar. Linhas "calculadas" da planilha (%, taxas, RMCA…) não são importadas: o sistema recalcula (conferido contra 637 células calculadas do Excel). As linhas "Ano anterior" só preenchem o ano anterior quando ele ainda não foi lançado. Abas de gráficos/impressão são ignoradas. Desliga-se por fazenda com `"modules": { "performance": false }`.
Permissões: ver = quem vê o painel; lançar/corrigir = dono, encarregado, veterinária; importar = dono, encarregado; metas = dono, veterinária.

## Perfis
| Perfil | Pode |
|---|---|
| Dono | tudo (usuários, apagar/restaurar, exportar, auditoria, desfazer importação) |
| Encarregado | lançar, corrigir, importar, ver painel |
| Funcionário | lançar e consultar ficha (sem painel) |
| Veterinária | ver tudo, lançar, corrigir, exportar, configurar limites |

Apagar é lógico (recuperável). Toda alteração fica no registro de auditoria. Desativar usuário derruba a sessão na hora.

## Segurança
- Senhas com scrypt; bloqueio de 15 min após 5 tentativas erradas; sessão de 90 dias no aparelho.
- Nada de senha/chave no código: `.env` fica fora do Git; na AWS usar Secrets Manager.
- Limites de CCS/CBT/gordura/proteína são **sugestões iniciais** — confirme com a legislação e o laticínio.

## Estrutura
`server/` API (Fastify + PostgreSQL) · `web/` site instalável (PWA) · `db/migrations/` tabelas ·
`farms/` uma pasta por fazenda · `scripts/` criar fazenda e dados de teste · `tests/` testes.
