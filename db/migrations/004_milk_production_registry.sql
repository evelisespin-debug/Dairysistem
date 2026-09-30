-- Produção de leite por vaca no dia do controle (kg) e registro oficial do animal.
insert into analysis_types (code, name, unit, decimals, aliases, geometric, scale, sort_order) values
 ('LEITE','Produção de leite (controle)','kg',1, array['leite','leite kg','leitekg','producao','producao kg','producao por vaca','producao dia'], false,'animal', 80)
on conflict (code) do nothing;
alter table animals add column registry text;   -- número de registro (ex.: associação de raça)
