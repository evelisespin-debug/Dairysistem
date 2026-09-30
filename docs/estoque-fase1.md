# Fase 1 — Controle de estoque

Sistema **somente online** (nada de PWA offline/fila para o estoque). Se a conexão cair, uma faixa vermelha avisa
e a tela mantém tudo o que o usuário digitou; ele toca de novo no botão quando a internet voltar.

## Perfis
| Perfil (código) | Estoque |
|---|---|
| Proprietário (`dono`) | tudo (aprovação de ajustes de inventário: `estoque_aprovar`, reservada) |
| Gerente (`gerente`) | cadastros, entrada por nota, cancelar entrada, ver custos e relatórios |
| Almoxarife (`almoxarife`) | entrada por nota (todas as 4 formas), saída, transferência, inventário; **não vê valores** |
| Encarregado de setor (`encarregado`) | consulta e saída (consumo); **não** dá entrada por nota |

## Entrada por nota — 4 formas, uma tela de conferência
1. **XML** (principal): vários arquivos ou `.zip`. Lê chave, número/série, emissão, fornecedor, itens (código, EAN, NCM, unidade, qtd., valores),
   frete/seguro/desconto/outras despesas, IPI/ICMS-ST, parcelas, forma de pagamento e lote/validade (`rastro`).
2. **Foto/PDF do DANFE**: leitura por IA (visão). Ative com `ANTHROPIC_API_KEY` (modelo em `DANFE_OCR_MODEL`). Cada campo vem com confiança;
   abaixo de 0,8 fica amarelo. Chave com dígito verificador inválido, CNPJ inválido e itens que não somam o total também são marcados.
   Se a chave for lida e a busca de XML estiver ativa, o XML oficial substitui a leitura da imagem.
3. **QR code / chave**: câmera (BarcodeDetector; Chrome/Android) ou colar a chave. A chave já informa UF, mês, CNPJ, série e número.
   Com provedor configurado, busca o XML completo; sem ele, só preenche o cabeçalho.
4. **Manual**: mesmo formulário, com fornecedor, itens, frete, parcelas.

Regras: nada entra no estoque sem **Dar entrada**; fornecedor achado pelo CNPJ ou criado na hora; de-para por código do fornecedor
(aprendido a cada nota) → EAN → descrição parecida; conversão de unidade (SC → 25 kg); item novo criável na própria conferência;
nota repetida (mesma chave) é barrada; item com controle de lote exige lote e validade.
Com XML, cabeçalho, totais e parcelas vêm **sempre do XML** (o cliente só escolhe item, conversão, lote e local).

### Custo do estoque
Custo do item = valor − desconto + parte do frete/seguro/outras (rateio pelo valor) + IPI + ICMS-ST. A soma dos itens fecha com o total da nota,
centavo a centavo. Cada movimento guarda custo unitário e total; o item guarda custo médio móvel. ICMS/PIS/COFINS ficam só como informação (`purchases.taxes`).
> Premissa a confirmar com o contador: IPI e ICMS-ST entram no custo (comum para produtor rural sem crédito). Se a fazenda credita algum imposto, ajustar `allocateCosts`.

## Busca do XML pela chave — opções (decisão pendente)
| Opção | Custo | Prós | Contras |
|---|---|---|---|
| **A. Provedor de API de NF-e** (recomendada) | mensal ou por consulta (valores variam; cote 2–3 provedores) | sem certificado, sem lidar com SEFAZ, funciona em uma tarde | dependência e custo recorrente; a nota precisa estar disponível no provedor |
| B. SEFAZ direto (NFeDistribuiçãoDFe) com certificado A1 | certificado A1 (~R$ 150–250/ano) | sem mensalidade; traz todas as notas emitidas contra o CNPJ da fazenda | certificado guardado com segurança (Secrets Manager), limites de consulta, manutenção do protocolo SOAP |
| C. Manifestação do destinatário + download | igual à B | notas chegam sozinhas | mais complexo; exige manifestar cada nota |
Recomendação: **A** agora; migrar para B se o volume justificar. O código usa um adaptador HTTP genérico:
`NFE_PROVIDER_URL` (com `{chave}`), `NFE_PROVIDER_TOKEN`, `NFE_PROVIDER_HEADER`. Cada provedor tem formato próprio — confira a documentação dele
e ajuste só `server/estoque/provedores.js` (o parser do XML já existe).

## Preparado para a Fase 2 (financeiro)
- `purchases` (fornecedor, totais, forma/condições de pagamento, XML) e `purchase_installments` (vencimento/valor): a Fase 2 cria contas a pagar apontando para `purchases.id`, sem alterar tabelas.
- `stock_movements` é um razão imutável com custo e `cost_center_id`: custo por setor sai direto dele. Cancelar uma entrada gera estorno, nunca edição.

## Não incluído nesta entrega
O texto do pedido chegou cortado após "De-para de itens". Portanto **não** foram feitos: saída/consumo por setor, transferência, inventário com aprovação do proprietário,
relatórios, saldo inicial na importação. A base (razão, saldos por local/lote, permissões `estoque_saida/transferir/inventario/aprovar`, flag "exigir setor") já está pronta para recebê-los.
O código legado de qualidade do leite ainda tem fila offline/PWA; não foi mexido.

## Testes
`npm test` (28 testes; `tests/estoque.test.js` cobre XML, zip, chave, OCR simulado, custo, lotes, duplicidade, de-para, cancelamento, importação e permissões).
