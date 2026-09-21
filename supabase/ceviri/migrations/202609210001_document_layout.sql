-- Taranmış PDF'ten gelen belgenin düzeni (sayfa, başlık, tablo, görsel).
--
-- DOCX kaynaklarında çeviri orijinal dosyanın içine yazılır; PDF'te
-- değiştirilecek bir Word yoktur. Word'ü çeviriden yeniden üretebilmek için
-- OCR'ın çıkardığı yapı burada saklanır. DOCX belgelerde null kalır.
alter table public.ceviri_documents
  add column if not exists layout jsonb;
