-- Tipos do formulário de análise do tanque (Figma): sólidos totais, uréia, produção total.
insert into analysis_types (code, name, unit, decimals, aliases, geometric, scale, sort_order) values
 ('SOLIDOS_TOTAIS','Sólidos Totais','%',2, array['solidos totais','sol totais','solidos','st','extrato seco total','est'], false,'both', 50),
 ('UREIA','Uréia (N ureico)','mg/dL',1, array['ureia','nu','n ureico','nitrogenio ureico','mun'], false,'both', 60),
 ('PRODUCAO_TOTAL','Produção total','L',0, array['producao total','producao','litros','volume'], false,'tank', 70)
on conflict (code) do nothing;

-- Lactação e último parto: base do LAC e do DEL (dias em lactação) do relatório de controle leiteiro.
alter table animals add column lactation_number int check (lactation_number is null or lactation_number >= 0);
alter table animals add column calving_date date;
