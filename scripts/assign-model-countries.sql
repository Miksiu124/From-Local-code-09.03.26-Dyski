-- Assign models to countries (DE, US, PL)
-- Run on VPS: psql -U platform -d content_platform -f assign-model-countries.sql

-- 1. Ensure countries exist (DE, US, PL) - seed usually creates them
INSERT INTO countries (name, code, flag_emoji, created_at, updated_at)
VALUES 
  ('Germany', 'DE', '🇩🇪', now(), now()),
  ('United States', 'US', '🇺🇸', now(), now()),
  ('Poland', 'PL', '🇵🇱', now(), now())
ON CONFLICT (code) DO NOTHING;

-- 2. Update DE models
UPDATE models m SET country_id = c.id
FROM countries c
WHERE c.code = 'DE' AND m.folder_name IN (
  'elenakamperivip','elisa_aline','ginalaitschek','gwendolynceline','lia.engel','mellooow'
);

-- 3. Update US models
UPDATE models m SET country_id = c.id
FROM countries c
WHERE c.code = 'US' AND m.folder_name IN (
  'abigaillutz','abigaillutzvip','alinaxrose','alinity','amouranth','amxnduh','andiegen','arikytsya','asian.candy','autumren','avaxreyes','breckie','camillaxaraujo','claire.lewis','corinnakopf','izzygreen','julia.filippo','justasecret892','kawaiisofey','lanahub','leximarvel','liltay','lilydaisyphillips','lunabenna','madison','maligoshik','mathildtantot','mckinleyexclusive','mckinleyrichardson','miahuffmanvip','miakhalifa','miamalkova','michellescottt','misslavoie','skybri','skylarmaexo','sophieraiin','stellabarey','summerxiris','tanamongeau','val.rossi','yunaof'
);

-- 4. Update PL models
UPDATE models m SET country_id = c.id
FROM countries c
WHERE c.code = 'PL' AND m.folder_name IN (
  '50elf50model','aga.zolnierka','alexberg','alexbergvip','angeljustx','angeljustxfree','asiapik','aurolka','badgirlsandra','bianciaaaa','bitchimacowsu','blonde.lady','bootlega_veneta','candy_crush_doll','cherry.candle_official','chillqueenie','curlyvelvet','dabrowskadaria','eklektyzm','emilia.szkopiak','emiliaszymanska','exgrazyna','fagatka','flychanelle1','hotdecyzja','hotjulcia','jaworowa','julkaguzik','kikijulek','kishigirly','klaudiaxxnvip','klaudusiek','kleoofficial','kroliczeksara','littlepolishangel','llleasy','lovelyamyoo','madzialos','madzialoskot','magiczna','malinatrix','maszagraczykowska','meggie.pond','melaniasweetpl','mia_tattoo','mmaukowa','monikaking','monikarossa','moniq25','mrs.honey','najlepszadziennikarka','nikita.alokin','nomaggy','olivia_aryy','olivoil','oliwia_dziatkiewicz','pavoxy','polishmuffin','poxxi','rivers_vip','sarenkaaof','sheeya','shirleycvc','songheli','strawberries77','ultrafioletova','urfavbarbiedoll','vanessamonroeee','vanessaszwaczka','vatacukrova','venus.sun','vikibor','vulgart','vvikaraa','wika99','wiksa_666','wiksola','zusjeofficial'
);
