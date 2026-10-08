-- Forum Sistemi veritabanı şeması (SQLite, node:sqlite).
-- İlke: tartışma, öneri ve konu kayıtları ASLA fiziksel olarak silinmez (yalnızca durum/görünürlük değişir).
-- Zaman damgaları: milisaniye (simüle saat, Clock.now()).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ───────────── Kimlik ─────────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                       -- rastgele üye UUID (oy/graf/defter yalnızca bunu bilir)
  nickname TEXT NOT NULL,                    -- takma ad (herkese açık)
  nickname_norm TEXT NOT NULL UNIQUE,        -- shared nicknameKey: NFKC + kırpma + tr-TR küçük harf + I/ı/İ/i → i katlaması
  password_hash TEXT NOT NULL,               -- scrypt$N$r$p$salt$hash
  roles TEXT NOT NULL DEFAULT '["member"]',  -- JSON dizi
  status TEXT NOT NULL DEFAULT 'pending',    -- pending|verified|suspended|rejected|erased
  is_adult INTEGER NOT NULL DEFAULT 0,
  region_il TEXT,
  region_ilce TEXT,
  political_consent INTEGER NOT NULL DEFAULT 0,
  ai_consent INTEGER NOT NULL DEFAULT 0,
  kvkk_notice_at INTEGER,
  created_at INTEGER NOT NULL,
  verified_at INTEGER,
  verified_by TEXT,
  reputation REAL NOT NULL DEFAULT 0,
  objection_budget_used TEXT NOT NULL DEFAULT '[]', -- JSON: imza zaman damgaları (30 günlük pencere)
  -- "Kişisel sıralama" tercihi (şema sürümü 4): 1 = açık (varsayılan). Yalnız siyasi görüş rızasıyla birlikte etkilidir; 0 iken
  -- kişisel sıralama için hiçbir etkinlik sinyali okunmaz (forum/discovery.ts). KVKK dökümünde consents.personalRanking.
  personal_ranking INTEGER NOT NULL DEFAULT 1
);

-- Kimlik kasası: alan bazlı AES-256-GCM. Yalnızca identity modülü erişir.
CREATE TABLE IF NOT EXISTS identity_vault (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  wrapped_dek TEXT,              -- kullanıcıya özel veri anahtarı (MASTER ile sarılı). NULL = kripto-imha edildi
  enc_first_name TEXT,
  enc_last_name TEXT,
  enc_tckn TEXT,
  enc_birth_date TEXT,
  enc_email TEXT,
  enc_phone TEXT,
  enc_address TEXT,              -- AddressInput JSON
  tckn_bidx TEXT UNIQUE,         -- HMAC kör indeks (tekillik)
  email_bidx TEXT UNIQUE,
  household_bidx TEXT,           -- normalize adres HMAC'i (çıkar çatışması / hane)
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pii_access_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- Kimlik verisi düzeltme talepleri (KVKK md. 11/1-d). Önerilen değerler ve gerekçe kişinin DEK'iyle şifrelidir;
-- öneri (enc_payload) karar ya da geri çekme anında imha edilir (NULL). Satırlar silinmez.
CREATE TABLE IF NOT EXISTS identity_corrections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  fields TEXT NOT NULL,                      -- JSON: düzeltilecek alan adları (değer YOK)
  enc_payload TEXT,                          -- önerilen değerler (AES-256-GCM, kişinin DEK'i); karar sonrası NULL
  enc_reason TEXT,                           -- gerekçe (şifreli); kripto-imhada NULL
  key_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending|approved|rejected|withdrawn
  reviewed_by TEXT,                          -- amaç belirterek inceleyen son personel
  reviewed_at INTEGER,
  decided_by TEXT,
  decided_at INTEGER,
  decision_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON identity_corrections(status, created_at);
CREATE INDEX IF NOT EXISTS idx_corrections_user ON identity_corrections(user_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

-- ───────────── Konular ─────────────
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  parent_id TEXT REFERENCES topics(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  origin_proposal_id TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',     -- active|archived
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_parent ON topics(parent_id);

CREATE TABLE IF NOT EXISTS topic_revisions (
  topic_id TEXT NOT NULL REFERENCES topics(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  via_proposal_id TEXT,
  content_hash TEXT NOT NULL,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, version)
);

-- ───────────── Öneriler ─────────────
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL,                        -- topic|subtopic|amendment|deletion|regulation
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  parent_topic_id TEXT REFERENCES topics(id),-- subtopic: üst konu; amendment: hedef konu
  amendment_payload TEXT,                    -- JSON AmendmentPayload
  deletion_payload TEXT,                     -- JSON DeletionPayload
  regulation_patch TEXT,                     -- JSON RegulationPatch
  categories TEXT NOT NULL DEFAULT '[]',
  rights_flags TEXT NOT NULL DEFAULT '[]',
  request_expert INTEGER NOT NULL DEFAULT 0,
  tier TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  audit_report TEXT,                         -- JSON AuditReport (son)
  params TEXT,                               -- JSON DecisionParams (oylama açılışında sabitlenir)
  bylaw_version INTEGER,
  phase_started_at INTEGER,
  phase_ends_at INTEGER,
  voting_round INTEGER NOT NULL DEFAULT 0,   -- 0: henüz yok, 1: ilk oylama, 2: yeniden oylama
  extension_used INTEGER NOT NULL DEFAULT 0, -- mevcut tur için
  reconciliation_used INTEGER NOT NULL DEFAULT 0,
  reconciliation_origin TEXT,                -- contested|objection
  strong_objection INTEGER NOT NULL DEFAULT 0,
  expert_extension_used INTEGER NOT NULL DEFAULT 0,
  cluster_snapshot_id TEXT,
  eligible_count INTEGER,
  enacted_entity_id TEXT,
  expert_draw_height INTEGER,                -- bilirkişi kurası tohumu için ÖNCEDEN taahhüt edilen blok yüksekliği
  content_labels TEXT NOT NULL DEFAULT '[]', -- JSON [{label, confidence, source}] (moderasyon; danışma)
  final_reason TEXT,                         -- kesin sonucun Türkçe gerekçesi (ör. "sürüm çakışması")
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_parent ON proposals(parent_topic_id);

CREATE TABLE IF NOT EXISTS proposal_versions (
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  via_suggestion_id TEXT,
  content_hash TEXT NOT NULL,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, version)
);

CREATE TABLE IF NOT EXISTS proposal_sponsors (
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  at INTEGER NOT NULL,
  ledger_tx TEXT,
  PRIMARY KEY (proposal_id, user_id)
);

CREATE TABLE IF NOT EXISTS proposal_suggestions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',       -- open|accepted|rejected|lapsed (lapsed: karar verilmeden tartışma kapandı)
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE TABLE IF NOT EXISTS phase_events (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL,
  ledger_tx TEXT
);
CREATE INDEX IF NOT EXISTS idx_phase_events_p ON phase_events(proposal_id);

-- Oylama açılışında alınan uygun seçmen anlık görüntüsü (tur 2'de aynısı kullanılır)
CREATE TABLE IF NOT EXISTS eligible_voters (
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (proposal_id, user_id)
);

-- Doğrudan oylar. Yeniden oy verme satırı günceller; her değişiklik deftere yeni VOTE_COMMIT olarak gider.
CREATE TABLE IF NOT EXISTS ballots (
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  round INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  ballot_id TEXT NOT NULL,                   -- HMAC(oyAnahtarı, userId‖proposalId‖round)
  choice TEXT NOT NULL,                      -- yes|no|abstain
  salt TEXT NOT NULL,
  commitment TEXT NOT NULL,
  ledger_tx TEXT,
  cast_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, round, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ballots_ballot ON ballots(ballot_id);

-- Sayım sonuçları (tur başına; needs_more_votes ara sonuçları da saklanır)
CREATE TABLE IF NOT EXISTS tallies (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  round INTEGER NOT NULL,
  result TEXT NOT NULL,                      -- JSON DecisionResult
  tally_payload TEXT,                        -- JSON TallyPayload (deftere giden)
  reveal_payload TEXT,                       -- JSON RevealEntry[]
  ledger_tx TEXT,
  reveal_ledger_tx TEXT,
  interim INTEGER NOT NULL DEFAULT 0,        -- 1: needs_more_votes ara sayımı (oylama sürerken gizli, deftere açıklanmaz)
  delegation_trace TEXT,                     -- JSON {delegatorUserId: delegateUserId} — YALNIZ sunucuda (defterde yok)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tallies_p ON tallies(proposal_id, round);

CREATE TABLE IF NOT EXISTS objections (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  ground TEXT NOT NULL,                      -- fy:ItirazGerekcesi IRI
  statement TEXT NOT NULL,
  cluster_id TEXT,
  ledger_tx TEXT,
  at INTEGER NOT NULL,
  UNIQUE (proposal_id, user_id)
);

CREATE TABLE IF NOT EXISTS minority_reports (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  cluster_id TEXT,
  body TEXT NOT NULL,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_requests (
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'panel',        -- panel|counter
  at INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, user_id, kind)
);

-- ───────────── Tartışma (silinmez) ─────────────
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  thread_type TEXT NOT NULL,                 -- topic|proposal
  thread_id TEXT NOT NULL,
  parent_id TEXT REFERENCES messages(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  stance TEXT NOT NULL DEFAULT 'neutral',
  body TEXT NOT NULL,                        -- güncel sürüm metni (gizliyse API vermez)
  version INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'visible',-- visible|collapsed|hidden|sealed
  hidden_by_proposal_id TEXT,
  hidden_ground TEXT,
  content_salt TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ledger_tx TEXT,
  ai_flags TEXT,                             -- JSON {risk, labels, analysisId} (danışma)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_type, thread_id);

CREATE TABLE IF NOT EXISTS message_versions (
  message_id TEXT NOT NULL REFERENCES messages(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  content_salt TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, version)
);

CREATE TABLE IF NOT EXISTS message_rebuttals (
  message_id TEXT PRIMARY KEY REFERENCES messages(id),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS message_endorsements (
  message_id TEXT NOT NULL REFERENCES messages(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  value INTEGER NOT NULL,                    -- +1 katılıyorum, -1 katılmıyorum
  at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS hidden_access_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- ───────────── Bilirkişi ─────────────
CREATE TABLE IF NOT EXISTS experts (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  domains TEXT NOT NULL,                     -- JSON kategori IRI dizisi
  credentials TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied',    -- applied|active|suspended|removed|rejected
  reputation REAL NOT NULL DEFAULT 0.75,
  approved_by TEXT,
  approved_at INTEGER,
  sanction_note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_questions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  minority_guaranteed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_panels (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  round INTEGER NOT NULL,                    -- 1,2,... (yeniden çekiliş/karşı panel)
  is_counter INTEGER NOT NULL DEFAULT 0,
  seed TEXT NOT NULL,
  seed_source TEXT NOT NULL,                 -- JSON {blockHash, blockHeight, proposalId, round}
  candidates TEXT NOT NULL,                  -- JSON [{userId, weight, softConflict, excludedReason?}]
  selected TEXT NOT NULL,                    -- JSON userId dizisi
  no_expert INTEGER NOT NULL DEFAULT 0,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_assignments (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL REFERENCES expert_panels(id),
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  expert_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'invited',    -- invited|accepted|recused|reported|overdue|replaced
  recuse_reason TEXT,
  due_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS expert_reports (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL UNIQUE REFERENCES expert_assignments(id),
  proposal_id TEXT NOT NULL REFERENCES proposals(id),
  expert_id TEXT NOT NULL REFERENCES users(id),
  assessment TEXT NOT NULL,                  -- feasible|infeasible|uncertain
  confidence REAL NOT NULL,
  risks TEXT NOT NULL DEFAULT '[]',
  answers TEXT NOT NULL DEFAULT '[]',
  body TEXT NOT NULL,
  dissent TEXT,
  lint TEXT NOT NULL DEFAULT '[]',
  score REAL,                                -- itibar kontrol listesi puanı S ∈ [0,1]
  content_hash TEXT NOT NULL,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL
);

-- ───────────── Graf ─────────────
-- Düğüm kimlikleri önekli: user:<id>, topic:<id>, proposal:<id>, cat:<iri>, msg:<id>
CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  scope TEXT,                                -- DELEGATES_TO için kapsam ("*" veya kategori IRI)
  rank INTEGER,                              -- DELEGATES_TO sırası (1..3)
  meta TEXT,                                 -- JSON
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,                        -- kenarlar silinmez; geri alınır
  ledger_tx TEXT
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON graph_edges(src, type);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON graph_edges(dst, type);

CREATE TABLE IF NOT EXISTS cluster_snapshots (
  id TEXT PRIMARY KEY,
  algo TEXT NOT NULL,
  params TEXT NOT NULL,
  seed TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  k INTEGER NOT NULL,
  silhouette REAL NOT NULL,
  assignments TEXT NOT NULL,                 -- JSON {userId: "g0"}
  coords TEXT NOT NULL,                      -- JSON {userId: [x, y]}
  sizes TEXT NOT NULL,                       -- JSON {"g0": 12}
  clustered_total INTEGER NOT NULL,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_runs (
  id TEXT PRIMARY KEY,
  algo TEXT NOT NULL,
  version TEXT NOT NULL,
  params TEXT NOT NULL,
  seed TEXT,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL
);

-- ───────────── Ontoloji / yönetmelik ─────────────
CREATE TABLE IF NOT EXISTS bylaw_versions (
  version INTEGER PRIMARY KEY,
  ttl TEXT NOT NULL,                         -- yürürlükteki yönetmelik A-kutusu (Turtle)
  hash TEXT NOT NULL,
  via_proposal_id TEXT,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL
);

-- ───────────── Yapay zekâ ─────────────
CREATE TABLE IF NOT EXISTS ai_analyses (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  offline INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  output TEXT NOT NULL,                      -- JSON
  approved_by TEXT,
  ledger_tx TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_target ON ai_analyses(target_type, target_id);

-- ───────────── Genel ─────────────
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  meta TEXT,
  at INTEGER NOT NULL
);

-- ───────────── Defter giden kutusu (şema sürümü 2) ─────────────
-- Gönderilmiş ama henüz bir blokta onaylanmamış defter işlemleri. Bir DB işlemi içinden yapılan gönderim satırı o işlemde yazar
-- (işlemsel outbox: COMMIT ile birlikte kalır, geri almada birlikte silinir); işlem dışındaki gönderimleri defter servisi submit anında
-- yazar. İşlem blokta onaylanıp doğrulayıcı depoları diske indirilince (fsync) satır silinir (bu bir kuyruktur, kayıt değildir). Sert
-- kapanıştan (çökme, taskkill /F) ya da elektrik kesintisinden sonra açılışta kalan satırlar yeniden gönderilir; elektrik kesintisinde
-- kaybolan son blok yeniden üretilir, işlem kaybolmaz (MIMARI §4).
-- Yük deftere yazılacak yükün aynısıdır: kişisel veri ve kullanıcı kimliği içermez (prepareTx denetler).
CREATE TABLE IF NOT EXISTS ledger_outbox (
  hash TEXT PRIMARY KEY,                     -- işlem özeti: H(type, payload, nonce)
  type TEXT NOT NULL,
  payload TEXT NOT NULL,                     -- kanonik JSON
  nonce TEXT NOT NULL,
  submitted_at INTEGER NOT NULL              -- simüle saat
);

-- ───────────── Listem (şema sürümü 3) ─────────────
-- "Listeme ekle" kayıtları: kişiye özel yer imleri (öneri ya da konu). Yalnız sahibine görünür; KVKK dökümüne girer; hesap silmede
-- (kripto-imha işleminin içinde) silinir. Bir tartışma/öneri kaydı DEĞİLDİR: listeden çıkarma satırı siler. Kişisel sıralamada
-- "listeye ekleme" sinyalidir (shared/src/recommend.ts). Hedef kimliği yabancı anahtar değildir (iki tablodan birine bakar);
-- sunucu eklemede hedefin var ve görüntüleyene görünür olduğunu denetler.
CREATE TABLE IF NOT EXISTS saved_items (
  user_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('proposal', 'topic')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_items_user_created ON saved_items(user_id, created_at);

-- ───────────── Sorgu indeksleri (sıcak WHERE/JOIN sütunları; mevcut veritabanları bir sonraki açılışta alır) ─────────────
-- Denetim günlüğü: öneri özetleri (action + target IN …), yönetici görünümü (ORDER BY at DESC), dışa aktarım (target), takma ad bekleme süresi.
CREATE INDEX IF NOT EXISTS idx_audit_action_target ON audit_log(action, target);
CREATE INDEX IF NOT EXISTS idx_audit_target_at ON audit_log(target, at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- Bilirkişi: markOverdue her saniye (status IN … AND due_at < ?), uzman/panel/öneri bazlı okumalar, rapor ve soru sayımları.
CREATE INDEX IF NOT EXISTS idx_expert_assign_status_due ON expert_assignments(status, due_at);
CREATE INDEX IF NOT EXISTS idx_expert_assign_expert ON expert_assignments(expert_id, status);
CREATE INDEX IF NOT EXISTS idx_expert_assign_proposal ON expert_assignments(proposal_id);
CREATE INDEX IF NOT EXISTS idx_expert_assign_panel ON expert_assignments(panel_id);
CREATE INDEX IF NOT EXISTS idx_expert_reports_proposal ON expert_reports(proposal_id);
CREATE INDEX IF NOT EXISTS idx_expert_reports_expert ON expert_reports(expert_id);
CREATE INDEX IF NOT EXISTS idx_expert_questions_proposal ON expert_questions(proposal_id);
CREATE INDEX IF NOT EXISTS idx_expert_panels_proposal ON expert_panels(proposal_id, round);

-- Öneri alt kayıtları ve üye bazlı okumalar.
CREATE INDEX IF NOT EXISTS idx_minority_reports_proposal ON minority_reports(proposal_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_proposal ON proposal_suggestions(proposal_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_id);
CREATE INDEX IF NOT EXISTS idx_proposals_author ON proposals(author_id);
CREATE INDEX IF NOT EXISTS idx_ballots_user ON ballots(user_id);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
-- Kişisel sıralamanın sinyal sorgusu (üyenin destekledikleri; şema sürümü 3).
CREATE INDEX IF NOT EXISTS idx_sponsors_user ON proposal_sponsors(user_id, at);

-- Vekâlet grafiği (graph.delegations: type = 'DELEGATES_TO' AND revoked_at IS NULL) ve bildirim listesi (user_id, created_at).
CREATE INDEX IF NOT EXISTS idx_edges_type_revoked ON graph_edges(type, revoked_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(user_id, created_at);
