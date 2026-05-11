INSERT INTO "banks" ("id", "name", "is_active", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'Bank of Kigali',              true, NOW(), NOW()),
  (gen_random_uuid(), 'Equity Bank Rwanda',           true, NOW(), NOW()),
  (gen_random_uuid(), 'I&M Bank Rwanda',              true, NOW(), NOW()),
  (gen_random_uuid(), 'KCB Bank Rwanda',              true, NOW(), NOW()),
  (gen_random_uuid(), 'Ecobank Rwanda',               true, NOW(), NOW()),
  (gen_random_uuid(), 'Cogebanque',                   true, NOW(), NOW()),
  (gen_random_uuid(), 'BPR Bank Rwanda',              true, NOW(), NOW()),
  (gen_random_uuid(), 'Access Bank Rwanda',           true, NOW(), NOW()),
  (gen_random_uuid(), 'NCBA Bank Rwanda',             true, NOW(), NOW()),
  (gen_random_uuid(), 'Development Bank of Rwanda',   true, NOW(), NOW()),
  (gen_random_uuid(), 'Zigama CSS',                   true, NOW(), NOW()),
  (gen_random_uuid(), 'Urwego Bank',                  true, NOW(), NOW()),
  (gen_random_uuid(), 'AB Bank Rwanda',               true, NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;
