-- Belge sohbeti (ChatGPT benzeri akış).
--
-- instructions: kullanıcının bu belgeye özel serbest metin talimatı. Çeviri
-- istemine eklenir; bellekten birebir gelen segmentleri DEĞİŞTİRMEZ, çünkü
-- birebir bellek eşleşmesi daha önce teslim edilmiş ve onaylanmış metindir.
--
-- chat: {role, content, at} nesnelerinden oluşan dizi. Sohbetin tamamı belgeyle
-- birlikte durur, böylece sayfa yenilense de konuşma kaybolmaz.
alter table public.ceviri_documents
  add column if not exists instructions text,
  add column if not exists chat jsonb not null default '[]'::jsonb;
