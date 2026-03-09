-- Assign models to countries (DE, US, PL, CZ)
-- Run on VPS: cd /opt/contentvault && bash scripts/vps-assign-countries.sh
-- Or: docker compose exec -T postgres psql -U platform -d content_platform < scripts/assign-model-countries.sql

-- 1. Ensure countries exist (DE, US, PL, CZ)
INSERT INTO countries (name, code, flag_emoji, created_at, updated_at)
VALUES 
  ('Germany', 'DE', '🇩🇪', now(), now()),
  ('United States', 'US', '🇺🇸', now(), now()),
  ('Poland', 'PL', '🇵🇱', now(), now()),
  ('Czech Republic', 'CZ', '🇨🇿', now(), now())
ON CONFLICT (code) DO NOTHING;

-- 2. DE: insert models if not exist, update country_id for existing
INSERT INTO models (name, folder_name, country_id, is_active)
SELECT f.folder, f.folder, c.id, true
FROM (VALUES 
  ('elenakamperivip'), ('elisa_aline'), ('ginalaitschek'), ('gwendolynceline'), ('lia.engel'), ('mellooow')
) AS f(folder)
CROSS JOIN countries c
WHERE c.code = 'DE'
ON CONFLICT (folder_name) DO UPDATE SET country_id = EXCLUDED.country_id;

-- 3. US: insert models if not exist, update country_id for existing
INSERT INTO models (name, folder_name, country_id, is_active)
SELECT f.folder, f.folder, c.id, true
FROM (VALUES 
  ('abigaillutz'), ('abigaillutzvip'), ('alinaxrose'), ('alinity'), ('amouranth'), ('amxnduh'), ('andiegen'),
  ('arikytsya'), ('asian.candy'), ('autumren'), ('avaxreyes'), ('breckie'), ('camillaxaraujo'), ('claire.lewis'),
  ('corinnakopf'), ('izzygreen'), ('julia.filippo'), ('justasecret892'), ('kawaiisofey'), ('lanahub'),
  ('leximarvel'), ('liltay'), ('lilydaisyphillips'), ('lunabenna'), ('madison'), ('maligoshik'), ('mathildtantot'),
  ('mckinleyexclusive'), ('mckinleyrichardson'), ('miahuffmanvip'), ('miakhalifa'), ('miamalkova'), ('michellescottt'),
  ('misslavoie'), ('skybri'), ('skylarmaexo'), ('sophieraiin'), ('stellabarey'), ('summerxiris'), ('tanamongeau'),
  ('val.rossi'), ('yunaof')
) AS f(folder)
CROSS JOIN countries c
WHERE c.code = 'US'
ON CONFLICT (folder_name) DO UPDATE SET country_id = EXCLUDED.country_id;

-- 4. PL: insert models if not exist, update country_id for existing
INSERT INTO models (name, folder_name, country_id, is_active)
SELECT f.folder, f.folder, c.id, true
FROM (VALUES 
  ('50elf50model'), ('aga.zolnierka'), ('alexberg'), ('alexbergvip'), ('angeljustx'), ('angeljustxfree'), ('asiapik'),
  ('aurolka'), ('badgirlsandra'), ('bianciaaaa'), ('bitchimacowsu'), ('blonde.lady'), ('bootlega_veneta'),
  ('candy_crush_doll'), ('cherry.candle_official'), ('chillqueenie'), ('curlyvelvet'), ('dabrowskadaria'),
  ('eklektyzm'), ('emilia.szkopiak'), ('emiliaszymanska'), ('exgrazyna'), ('fagatka'), ('flychanelle1'), ('hotdecyzja'),
  ('hotjulcia'), ('jaworowa'), ('julkaguzik'), ('kikijulek'), ('kishigirly'), ('klaudiaxxnvip'), ('klaudusiek'),
  ('kleoofficial'), ('kroliczeksara'), ('littlepolishangel'), ('llleasy'), ('lovelyamyoo'), ('madzialos'),
  ('madzialoskot'), ('magiczna'), ('malinatrix'), ('maszagraczykowska'), ('meggie.pond'), ('melaniasweetpl'),
  ('mia_tattoo'), ('mmaukowa'), ('monikaking'), ('monikarossa'), ('moniq25'), ('mrs.honey'), ('najlepszadziennikarka'),
  ('nikita.alokin'), ('nomaggy'), ('olivia_aryy'), ('olivoil'), ('oliwia_dziatkiewicz'), ('pavoxy'), ('polishmuffin'),
  ('poxxi'), ('rivers_vip'), ('sarenkaaof'), ('sheeya'), ('shirleycvc'), ('songheli'), ('strawberries77'),
  ('ultrafioletova'), ('urfavbarbiedoll'), ('vanessamonroeee'), ('vanessaszwaczka'), ('vatacukrova'), ('venus.sun'),
  ('vikibor'), ('vulgart'), ('vvikaraa'), ('wika99'), ('wiksa_666'), ('wiksola'), ('zusjeofficial')
) AS f(folder)
CROSS JOIN countries c
WHERE c.code = 'PL'
ON CONFLICT (folder_name) DO UPDATE SET country_id = EXCLUDED.country_id;

-- 5. CZ: insert models if not exist, update country_id for existing
INSERT INTO models (name, folder_name, country_id, is_active)
SELECT f.folder, f.folder, c.id, true
FROM (VALUES 
  ('miaonlyonelove'), ('teaonlyonelovevip'), ('lena12'), ('sunsphynx'),
  ('deathene'), ('petulkaa'), ('kafuu'), ('dariaof')
) AS f(folder)
CROSS JOIN countries c
WHERE c.code = 'CZ'
ON CONFLICT (folder_name) DO UPDATE SET country_id = EXCLUDED.country_id;
