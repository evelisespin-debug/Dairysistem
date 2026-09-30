-- Regra da veterinária: a CCS nunca é "média". O painel usa o valor do último controle (tanque) e o valor de cada vaca.
update analysis_types set geometric = false where code in ('CCS', 'CBT');
