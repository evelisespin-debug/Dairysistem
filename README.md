# Dairysistem — gestão de rebanho leiteiro (um sistema por fazenda)

Um código só, uma cópia por fazenda, cada uma com **banco de dados próprio** (isolamento total).
O que muda entre fazendas está em `farms/<fazenda>/farm.config.json` (nome, logotipo, endereço, usuários iniciais).
Nenhum nome de fazenda fica no código.

**Estado atual (piloto):** qualidade do leite + dashboards, relatório de controle leiteiro por vaca (CCS mês a mês, LAC/DEL,
situação sadia/curada/nova infecção/crônica), resultados do tanque, animais (cadastro mínimo), login com perfis,
lançamento manual com fila offline, importação de planilhas, exportação, auditoria. Visual DairyUp (Figma).
**Regras provisórias** (a confirmar): situação da vaca pelas duas últimas coletas, meta de CCS = 200 mil, paridas = LAC ≥ 2.
Produção, eventos, bezerras, financeiro e áreas agrícolas entram nas próximas etapas (cada um como módulo).

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

**Resultado genômico:** em *Importar*, escolha "Resultado genômico" e envie o arquivo em `.xlsx` ou `.csv` (se vier em `.xls`, abra no Excel e salve como `.xlsx`). A aba com as colunas ID e TPI é achada sozinha; o ID casa com o brinco. Gera o painel **Genética** (em cinza): TPI por ano de nascimento, pais, haplótipos, caseínas, conferência de paternidade e melhores animais; a ficha do animal mostra os índices.

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
