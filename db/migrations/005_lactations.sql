-- Histórico de lactações (parto + ordem): permite calcular o DEL de cada teste no passado.
create table animal_lactations (
  animal_id bigint not null references animals(id) on delete cascade,
  calving_date date not null,
  lactation_number int check (lactation_number is null or lactation_number >= 0),
  primary key (animal_id, calving_date)
);
insert into animal_lactations (animal_id, calving_date, lactation_number)
  select id, calving_date, lactation_number from animals where calving_date is not null and deleted_at is null
  on conflict do nothing;
