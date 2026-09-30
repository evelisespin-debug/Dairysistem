# Prompt para recriar o Painel Genômico (Agro Arkafla)

Anexe ao novo chat: (1) a planilha de resultados genômicos (.xls/.xlsx) e (2) a imagem da logo. Depois cole o texto abaixo.

---

Crie um **web software de página única (um arquivo HTML, como Artifact)** chamado **"Painel Genômico"**, com dashboard e filtros sobre a planilha genômica anexa (aba `Export`, uma linha por animal) e a logo anexa da **Agro Arkafla**. Todo o texto da interface em português do Brasil. Use o termo **"Touro"** (nunca "Pai") na interface. Os dados da planilha ficam embutidos no HTML; não precisa de servidor.

## Dados
Da aba `Export` use estas colunas: `ID`, `Dt nasc.`, `Pai` (nome do touro), `TPI`, `NM` (NM$), `Leite`, `Gor` (gordura kg), `Pro` (proteína kg), `%Gor`, `VP` (vida produtiva), `DPR`, `Tipo`, `C. Ub.` (úbere), `LIV` (longevidade), `MAST`, `MET`, `KET`, `HH1 HH3 HH4 HH5 HH6 DUMPS` (1 = portador), `betaC`, `kappaC`, `Touro enviado`, `Touro correto`.
- Idade em meses = (hoje − Dt nasc.) / 30,4375 dias.
- Haplótipos do animal = lista dos que valem 1.
- Paternidade: `Touro correto` = "OK" → "Touro confere"; "No ABS found" → "Touro não identificado"; qualquer outro valor → "Touro divergente" (mostrar "informado → correto"; se o enviado estiver vazio, "não informado").
- MAST, MET e KET têm duas escalas misturadas (animais antigos ~100, novos ~1). Em gráficos, rankings e contagens use **só valores ≥ 50**.
- O arquivo de referência tem 3.245 animais. Embuta os dados em formato compacto (arrays).
- Permita enviar outro arquivo dentro da página (.xls, .xlsx ou .csv) com SheetJS (cdnjs, xlsx 0.18.5): procurar a aba que tenha as colunas ID e TPI e recarregar tudo.

## Visual
- Fontes Google: **IBM Plex Sans** (texto) e **IBM Plex Mono** (números, tabular).
- Tema claro e escuro (tokens em `:root`, `prefers-color-scheme`, `data-theme`), `body` com fundo explícito.
- Claro: bg `#e6eaee`, surface `#f8f9fa`, ink `#1d2730`, muted `#5d6d7a`, line `#cfd7de`, strong `#2e4556`, mid `#7b93a5`, soft `#b3c1cc`, wash `#dde4ea`, acento verde-azulado `#23808f` (fundo do acento `#d6eaed`), ouro `#c79a1c`, prata `#94a3af`, bronze `#b47d4c`, alerta vermelho `#a8382c` (fundo `#efd9d5`).
- Escuro: bg `#11171c`, surface `#192127`, ink `#e5ebef`, muted `#92a2ae`, line `#2a353e`, strong `#b9d4e1`, mid `#5d7b8f`, soft `#43596a`, wash `#232d35`, acento `#5cc2d1` (fundo `#1b3a40`), ouro `#e0b64a`, prata `#a9b6c1`, bronze `#d09a68`, alerta `#e9877b` (fundo `#3d2522`).
- Base em cinza-ardósia; o acento verde-azulado só em aba ativa, etiquetas de filtro, destaques, linha do gráfico por ano e barras do ranking. Vermelho **só** para alertas (haplótipo, touro divergente). Cards com borda de 1px, raio 6px e sombra leve no claro.
- Cabeçalho: logo em uma moldura branca arredondada (altura 80px, padding 5px 10px, borda) à esquerda, ao lado do título "Painel Genômico"; à direita, "Resultados genômicos · animais ativos · 27/08/2026 · N animais". Embuta a logo como data URI (recorte o espaço em branco da imagem e reduza a ~520px de largura).
- Layout: coluna de filtros de 260px à esquerda (sticky) e conteúdo à direita; no celular (≤860px) tudo em uma coluna, filtros recolhidos atrás de um botão "Filtros (n ativos)". Sem rolagem horizontal; tabelas largas rolam dentro do próprio contêiner.

## Filtros (todos valem para todas as abas)
Buscar ID · Idade (Até 6 meses, 6 a 12, 12 a 24, 2 a 4 anos, Mais de 4 anos; com contagem) · TPI de / TPI até · Nascidos em (ano) · Touro (com contagem) · Haplótipo (Todos, Qualquer portador, Livres, HH1…, com contagem) · Beta-caseína · Kappa-caseína · Paternidade · "Limpar filtros". Etiquetas dos filtros ativos acima das abas, cada uma com "×" para remover.

## Faixa de indicadores (sempre visível)
Animais (mostrar "X de Y" quando filtrado) · TPI médio · NM$ médio · Leite (PTA) · DPR médio · Portadores de haplótipo (vermelho) · Touro divergente (vermelho). Quando há filtro, os quatro primeiros médios mostram "▲/▼ N vs rebanho".

## Abas
1. **Visão geral**
   - Cartão "Destaques" com frases automáticas: TPI médio do filtro vs rebanho (só se filtrado); ganho genético em pontos de TPI por ano (regressão linear das médias por ano de nascimento, só anos com ≥ 20 animais); % com TPI ≥ 3.000; haplótipo mais frequente; quantidade e % de touro divergente; % A2/A2.
   - Gráficos (Chart.js 4.4.1 via cdnjs): histograma do TPI (faixas de 100, **clicar numa barra filtra a faixa**); TPI médio por ano de nascimento (linha, **clicar num ponto filtra o ano**); touros mais usados (top 12 por filhas, rótulo "NOME · TPI x", **clicar filtra o touro**); dispersão idade × TPI (amostra máx. 1.500 pontos).
   - Listas de barras: haplótipos (vermelho) e caseínas beta/kappa, com n e %.
   - Tabela de animais: ID, Nascimento, Idade (m), Touro, TPI, NM$, Leite, %Gor, DPR, Beta, Kappa, Haplótipos (etiquetas vermelhas), Paternidade. Ordenável por clique no cabeçalho, 25/50/100 linhas por página, botão "Copiar tabela" (área de transferência, TSV), clicar na linha abre uma janela com todos os índices do animal.
2. **Rankings**
   - Seletor de requisito: TPI, NM$, Leite (PTA), Gordura (kg), Proteína (kg), %Gordura, DPR, Longevidade, Vida produtiva, Tipo, Úbere, Resist. mastite, Resist. metrite, Resist. cetose. Quantidade (10/25/50/100/todos) e ordem (melhores/piores primeiro).
   - Indicadores: 1º lugar (com ID), top 10% a partir de, top 25% a partir de, mediana, último.
   - Tabela: posição (empates dividem a posição; 1º/2º/3º em medalha ouro/prata/bronze), ID (abre a ficha), idade, touro, valor em negrito, barra proporcional (acento), NM$, leite, DPR, percentil (arredondado para baixo), alertas (haplótipo, "Touro?").
   - Quadro "Os 10 melhores de cada requisito": um cartão por requisito (14) em grade de 3 colunas.
   - "Ranking de touros" pela média do requisito (mínimo 5 filhas; clicar no nome filtra) e "Melhor de cada faixa de idade".
3. **Produção**: leite, gordura e proteína por ano de nascimento (3 linhas pequenas); histograma do leite (faixas de 200); dispersão leite × %gordura.
4. **Saúde e fertilidade**: DPR, longevidade e mastite por ano; metrite e cetose por ano (duas linhas, com legenda); histograma do DPR (faixas de 1); barras "animais abaixo da média" (mastite, metrite, cetose < 100 na escala 100; DPR negativo; longevidade negativa).
5. **Touros**: dispersão touros (filhas × TPI médio) e tabela de ranking (filhas, TPI, NM$, leite, DPR, nº de divergências); clicar no touro filtra e volta à Visão geral.
6. **Paternidade**: barra empilhada e lista com touro confere / não identificado / divergente; divergências por touro informado (top 12, vermelho); tabela dos divergentes (ID, touro registrado, informado → correto, TPI; até 300 linhas).
7. **Seleção**: cortes de TPI (melhor, top 10%, mediana, 25% piores, menor); tabelas dos 25 melhores e 25 piores por TPI (ID, idade, touro, TPI, NM$, DPR, haplótipo).

## Regras de qualidade
Um único eixo por gráfico; tooltips com valores e nº de animais; números em pt-BR com fonte mono tabular; nenhum texto colorido com a cor da série; nada de botão de download de arquivo nem `window.print`; página completa ao carregar (estado real, não vazio); títulos de aba e gráficos em caixa alta pequena com letter-spacing; `<title>` = "Painel Genômico". Teste uma vez o carregamento, um clique de filtro em gráfico, a aba Rankings e o celular (390px) nos dois temas, corrija o que aparecer e publique.
