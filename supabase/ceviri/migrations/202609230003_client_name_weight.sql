-- Firma adının "müşteri" göstergesi olarak güvenilirliği (0–1), parmak iziyle
-- birlikte bellekten öğrenilir (lib/ceviri/detect-client.ts nameReliability).
-- Bayer'in adı çoğunlukla Nase'nin belgelerinde geçtiği için düşük çıkar;
-- tespitte ad ipucu bununla çarpılır.
alter table public.clients add column if not exists name_weight real not null default 1;
