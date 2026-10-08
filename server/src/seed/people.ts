// Tohum nüfusu: takma adlar, roller, görüş blokları ve uydurma (ama biçimce geçerli) kimlik bilgileri.
// Kimlik bilgileri yalnızca şifreli kimlik kasasına gider; hiçbir metne, deftere ya da günlüğe yazılmaz.
import { fy, generateTckn, type RegistrationInput, type Rng } from "@forum/shared";

export type Block = "A" | "B" | "C";
export type Kind = "admin" | "registrar" | "auditor" | "expert" | "member" | "pending" | "rejected";

export interface Person {
  nickname: string;
  kind: Kind;
  password: string;
  /** Görüş bloğu (oy veren üyeler); yoksa oy vermez. */
  block?: Block;
  /** Doğrudan oy verme olasılığı (varsayılan: blok üyesi 0,88; C 0,97) */
  turnout?: number;
  minor?: boolean;
  noPoliticalConsent?: boolean;
  aiConsent?: boolean;
  expert?: { domains: string[]; credentials: string };
  /** Aynı hanede yaşayan kişinin takma adı (aynı adres) */
  householdWith?: string;
  /**
   * Kayıt verisi ayrı tohumlu akıştan (`EXTRA_STREAM_SEED`) üretilir. Sonradan eklenen hesaplar senaryonun ana rastgele akışını
   * (oylar, işaretler, destekçiler) kaydırmasın diye kullanılır; böylece mevcut vitrin sonuçları değişmez.
   */
  separateStream?: boolean;
}

/** `separateStream` hesaplarının kayıt verisi için tohum (ana tohumdan bağımsız, sabit). */
export const EXTRA_STREAM_SEED = "forum-seed-1|ek-hesaplar";

/**
 * Tek ortak şifre: TOHUM_SIFRE verilirse BÜTÜN demo hesaplarının şifresi odur (sunum için akılda kalır şifre; bkz. sunum.cmd).
 * Verilmezse rol başına varsayılan şifreler kullanılır (e2e testleri bunlara dayanır). Şifre kuralı seed.ts'te açılışta denetlenir.
 */
export const SHARED_SEED_PASSWORD = process.env.TOHUM_SIFRE?.trim() || null;

export const PASSWORDS = {
  admin: SHARED_SEED_PASSWORD ?? "Yonetici123!",
  demoAdmin: SHARED_SEED_PASSWORD ?? "admin123",
  registrar: SHARED_SEED_PASSWORD ?? "Kayit123!",
  auditor: SHARED_SEED_PASSWORD ?? "Denetci123!",
  expert: SHARED_SEED_PASSWORD ?? "Bilirkisi123!",
  member: SHARED_SEED_PASSWORD ?? "Uye12345!",
} as const;

const M = PASSWORDS.member;
const LOW = 0.12; // vekâlet veren, kendisi nadiren oy kullanan üyeler

/** Sabit nüfus (60/30/10 görüş blokları: A 28, B 14, C 6 oy veren üye). */
export const PEOPLE: Person[] = [
  { nickname: "yonetici", kind: "admin", password: PASSWORDS.admin, aiConsent: true },
  { nickname: "kayitmemuru", kind: "registrar", password: PASSWORDS.registrar },
  { nickname: "denetci", kind: "auditor", password: PASSWORDS.auditor },

  { nickname: "bk_enerji1", kind: "expert", password: PASSWORDS.expert, block: "A", turnout: 0.85, aiConsent: true, expert: { domains: [fy("Enerji"), fy("Cevre")], credentials: "Elektrik mühendisi; 12 yıl güneş enerjisi santrali projelendirme ve saha denetimi deneyimi." } },
  { nickname: "bk_enerji2", kind: "expert", password: PASSWORDS.expert, block: "B", turnout: 0.85, expert: { domains: [fy("Enerji"), fy("Cevre")], credentials: "Makine mühendisi, enerji verimliliği uzmanı; kamu binalarında enerji etüdü ve izleme deneyimi." } },
  { nickname: "bk_saglik1", kind: "expert", password: PASSWORDS.expert, block: "A", turnout: 0.85, aiConsent: true, expert: { domains: [fy("Saglik"), fy("HalkSagligi")], credentials: "Halk sağlığı uzmanı hekim; 15 yıl birinci basamak sağlık hizmetleri ve toplum tabanlı tarama programları." } },
  { nickname: "bk_saglik2", kind: "expert", password: PASSWORDS.expert, block: "B", turnout: 0.85, expert: { domains: [fy("Saglik"), fy("HalkSagligi")], credentials: "Hemşire; kronik hastalık yönetimi ve evde bakım koordinasyonu alanında yüksek lisans." } },
  { nickname: "bk_saglik3", kind: "expert", password: PASSWORDS.expert, block: "A", turnout: 0.85, expert: { domains: [fy("Saglik"), fy("HalkSagligi")], credentials: "İç hastalıkları uzmanı; diyabet ve hipertansiyon izlem programlarında görev aldı." } },
  { nickname: "bk_imar1", kind: "expert", password: PASSWORDS.expert, block: "A", turnout: 0.85, aiConsent: true, expert: { domains: [fy("Imar"), fy("DepremGuvenligi"), fy("Butce")], credentials: "İnşaat mühendisi; yapı denetimi ve deprem güçlendirme projelerinde 10 yıl deneyim." } },
  { nickname: "bk_imar2", kind: "expert", password: PASSWORDS.expert, block: "B", turnout: 0.85, expert: { domains: [fy("Imar"), fy("DepremGuvenligi"), fy("Butce")], credentials: "Şehir plancısı ve kamu maliyesi uzmanı; belediye yatırım bütçeleri üzerine çalışmalar." } },
  // Kura havuzu (ARASTIRMA.md §13.3: alan başına en az 6 bilirkişi): Enerji ve Sağlık alanlarında 6'şar bilirkişi olsun ki
  // vitrin kuraları (#K-7, #K-32) uygun adayların bir kısmını dışarıda bıraksın ve ağırlıklı kura görülebilsin. Bu hesaplar
  // görüş bloğuna girmez ve oy/görüş verisi rızası vermemiştir: uygun seçmen değildir, böylece yeter sayı ve itiraz eşikleri
  // (|E|) mevcut senaryodakiyle aynı kalır. Bilirkişilik oy hakkı gerektirmez; kayıt verileri ayrı akıştan üretilir.
  { nickname: "bk_enerji3", kind: "expert", password: PASSWORDS.expert, separateStream: true, noPoliticalConsent: true, expert: { domains: [fy("Enerji"), fy("Cevre")], credentials: "Enerji sistemleri mühendisi; çatı tipi güneş santrallerinde şebeke bağlantısı ve izin süreçleri deneyimi." } },
  { nickname: "bk_enerji4", kind: "expert", password: PASSWORDS.expert, separateStream: true, noPoliticalConsent: true, expert: { domains: [fy("Enerji")], credentials: "Elektrik-elektronik mühendisi; kamu binalarında enerji izleme ve sayaç sistemleri kurulumu." } },
  { nickname: "bk_enerji5", kind: "expert", password: PASSWORDS.expert, separateStream: true, noPoliticalConsent: true, expert: { domains: [fy("Enerji"), fy("Cevre")], credentials: "Çevre mühendisi; yenilenebilir enerji projelerinde çevresel etki değerlendirmesi." } },
  { nickname: "bk_enerji6", kind: "expert", password: PASSWORDS.expert, separateStream: true, noPoliticalConsent: true, expert: { domains: [fy("Enerji")], credentials: "Yapı fiziği uzmanı mimar; okul binalarında enerji verimliliği ve yalıtım etütleri." } },
  { nickname: "bk_saglik4", kind: "expert", password: PASSWORDS.expert, separateStream: true, noPoliticalConsent: true, expert: { domains: [fy("Saglik"), fy("HalkSagligi")], credentials: "Aile hekimi; kronik hastalık taramaları ve yaşlı izlemi alanında 10 yıl deneyim." } },
  { nickname: "bk_saglik5", kind: "expert", password: PASSWORDS.expert, separateStream: true, noPoliticalConsent: true, expert: { domains: [fy("Saglik"), fy("HalkSagligi")], credentials: "Epidemiyolog; toplum tabanlı sağlık araştırmalarında veri toplama ve kalite güvencesi." } },
  { nickname: "bk_saglik6", kind: "expert", password: PASSWORDS.expert, separateStream: true, noPoliticalConsent: true, expert: { domains: [fy("Saglik")], credentials: "Eczacı; ilaç güvenliği ve evde bakım hastalarında ilaç uyumu danışmanlığı." } },

  { nickname: "ayse", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "mehmet", kind: "member", password: M, block: "B" },
  { nickname: "zeynep", kind: "member", password: M, block: "C", aiConsent: true },

  // ── A bloğu (toplu taşıma, yeşil alan, yaya öncelikli) ──
  { nickname: "deniz_k", kind: "member", password: M, block: "A", turnout: 0.95, aiConsent: true },
  { nickname: "elif_d", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "burak_s", kind: "member", password: M, block: "A" },
  { nickname: "selin_a", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "emre_t", kind: "member", password: M, block: "A" },
  { nickname: "cem_y", kind: "member", password: M, block: "A", householdWith: "deniz_k" },
  { nickname: "ozge_b", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "murat_e", kind: "member", password: M, block: "A" },
  { nickname: "irem_c", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "tolga_a", kind: "member", password: M, block: "A" },
  { nickname: "pinar_g", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "onur_h", kind: "member", password: M, block: "A" },
  { nickname: "ceren_m", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "umut_f", kind: "member", password: M, block: "A" },
  { nickname: "ece_p", kind: "member", password: M, block: "A", aiConsent: true },
  { nickname: "baran_y", kind: "member", password: M, block: "A" },
  { nickname: "bora_t", kind: "member", password: M, block: "A", turnout: LOW },
  { nickname: "sinem_a", kind: "member", password: M, block: "A", turnout: LOW, aiConsent: true },
  { nickname: "yusuf_c", kind: "member", password: M, block: "A", turnout: LOW },
  { nickname: "melis_o", kind: "member", password: M, block: "A", turnout: LOW },
  { nickname: "hakan_d", kind: "member", password: M, block: "A", turnout: LOW },
  { nickname: "aylin_s", kind: "member", password: M, block: "A", turnout: LOW, aiConsent: true },
  { nickname: "gizem_e", kind: "member", password: M, block: "A", turnout: LOW },

  // ── B bloğu (araç/otopark yanlısı, maliyet kaygılı) ──
  { nickname: "sert_kaan", kind: "member", password: M, block: "B" },
  { nickname: "kemal_b", kind: "member", password: M, block: "B", turnout: LOW },
  { nickname: "serkan_u", kind: "member", password: M, block: "B" },
  { nickname: "gokhan_r", kind: "member", password: M, block: "B", aiConsent: true },
  { nickname: "nihan_l", kind: "member", password: M, block: "B" },
  { nickname: "volkan_i", kind: "member", password: M, block: "B" },
  { nickname: "derya_n", kind: "member", password: M, block: "B", aiConsent: true },
  { nickname: "tarik_o", kind: "member", password: M, block: "B" },
  { nickname: "figen_s", kind: "member", password: M, block: "B" },
  { nickname: "levent_c", kind: "member", password: M, block: "B", aiConsent: true },

  // ── C bloğu (engelli erişimi ve yaşlı bakımı odaklı) ──
  { nickname: "nur_a", kind: "member", password: M, block: "C", turnout: 0.97 },
  { nickname: "hulya_t", kind: "member", password: M, block: "C", turnout: 0.97, aiConsent: true },
  { nickname: "ismail_g", kind: "member", password: M, block: "C", turnout: 0.97 },
  { nickname: "sevgi_k", kind: "member", password: M, block: "C", turnout: 0.97 },
  { nickname: "orhan_d", kind: "member", password: M, block: "C", turnout: 0.97, aiConsent: true },

  // ── Oy kullanamayanlar ──
  { nickname: "genc_ali", kind: "member", password: M, minor: true },
  { nickname: "ada_k", kind: "member", password: M, minor: true, aiConsent: true },
  { nickname: "ozan_v", kind: "member", password: M, noPoliticalConsent: true },
  { nickname: "kerem_b", kind: "member", password: M, noPoliticalConsent: true },
  { nickname: "lale_y", kind: "member", password: M, noPoliticalConsent: true, aiConsent: true },

  // ── Kendi başvurusu (kayıt memuru ekranı) ──
  { nickname: "berk_n", kind: "pending", password: M },
  { nickname: "nisan_t", kind: "pending", password: M, aiConsent: true },
  { nickname: "oguz_k", kind: "pending", password: M },
  { nickname: "ece_s", kind: "pending", password: M },
  { nickname: "tuna_m", kind: "rejected", password: M },
  // Kolay demo girişi; ayrı akış ve oy rızası olmaması mevcut oylama senaryolarını korur.
  { nickname: "admin", kind: "admin", password: PASSWORDS.demoAdmin, separateStream: true, noPoliticalConsent: true },
];

const FIRST = [
  "Ayşe", "Mehmet", "Zeynep", "Ahmet", "Elif", "Burak", "Selin", "Emre", "Cem", "Özge", "Murat", "İrem", "Tolga", "Pınar", "Onur",
  "Ceren", "Umut", "Ece", "Baran", "Bora", "Sinem", "Yusuf", "Melis", "Hakan", "Aylin", "Gizem", "Kaan", "Kemal", "Serkan", "Gökhan",
  "Nihan", "Volkan", "Derya", "Tarık", "Figen", "Levent", "Nur", "Hülya", "İsmail", "Sevgi", "Orhan", "Ali", "Ada", "Ozan", "Kerem",
  "Lale", "Berk", "Nisan", "Oğuz", "Tuna", "Deniz", "Selim", "Gül", "Canan", "Erdem", "Filiz", "Hasan",
];
const LAST = [
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Yıldız", "Yıldırım", "Öztürk", "Aydın", "Özdemir", "Arslan", "Doğan", "Kılıç", "Aslan",
  "Çetin", "Kara", "Koç", "Kurt", "Özkan", "Şimşek", "Polat", "Erdoğan", "Güneş", "Tekin", "Acar", "Bulut", "Aksoy", "Karaca", "Uçar",
];

const PLACES: { il: string; ilce: string; mahalleler: string[] }[] = [
  { il: "İstanbul", ilce: "Kadıköy", mahalleler: ["Moda", "Fenerbahçe", "Caferağa", "Koşuyolu"] },
  { il: "İstanbul", ilce: "Üsküdar", mahalleler: ["Altunizade", "Kuzguncuk", "Salacak"] },
  { il: "Ankara", ilce: "Çankaya", mahalleler: ["Bahçelievler", "Emek", "Kavaklıdere"] },
  { il: "Ankara", ilce: "Yenimahalle", mahalleler: ["Demetevler", "Batıkent"] },
  { il: "İzmir", ilce: "Karşıyaka", mahalleler: ["Bostanlı", "Mavişehir", "Alaybey"] },
  { il: "İzmir", ilce: "Bornova", mahalleler: ["Kazımdirik", "Erzene"] },
];
const STREETS = ["Lale", "Menekşe", "Çınar", "Ihlamur", "Papatya", "Akasya", "Zambak", "Defne", "Kardelen", "Manolya", "Nergis", "Ladin"];

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Kişiye ait uydurma kayıt bilgileri (tohumlu RNG; aynı tohum → aynı veri). */
export function registrationFor(p: Person, rng: Rng, opts: { usedTckn: Set<string>; addressOf: Map<string, RegistrationInput["address"]> }): RegistrationInput {
  const firstName = FIRST[rng.int(FIRST.length)];
  const lastName = LAST[rng.int(LAST.length)];
  let tckn = "";
  do {
    let nine = String(1 + rng.int(9));
    for (let i = 0; i < 8; i++) nine += String(rng.int(10));
    tckn = generateTckn(nine);
  } while (opts.usedTckn.has(tckn));
  opts.usedTckn.add(tckn);

  let birthDate: string;
  if (p.minor) birthDate = `${2009 + rng.int(2)}-${pad(1 + rng.int(12), 2)}-${pad(1 + rng.int(28), 2)}`;
  else birthDate = `${1950 + rng.int(57)}-${pad(1 + rng.int(12), 2)}-${pad(1 + rng.int(28), 2)}`;

  const phone = `05${["32", "33", "35", "42", "43", "44", "05", "06", "07", "52", "53"][rng.int(11)]} ${pad(rng.int(1000), 3)} ${pad(rng.int(100), 2)} ${pad(rng.int(100), 2)}`;

  let address = p.householdWith ? opts.addressOf.get(p.householdWith) : undefined;
  if (!address) {
    const place = PLACES[rng.int(PLACES.length)];
    address = {
      il: place.il,
      ilce: place.ilce,
      mahalle: place.mahalleler[rng.int(place.mahalleler.length)],
      acikAdres: `${STREETS[rng.int(STREETS.length)]} Sokak No: ${1 + rng.int(80)} Daire ${1 + rng.int(12)}`,
      postaKodu: pad(10000 + rng.int(80000), 5),
    };
  }
  opts.addressOf.set(p.nickname, address);

  return {
    nickname: p.nickname,
    password: p.password,
    firstName,
    lastName,
    tckn,
    birthDate,
    email: `${p.nickname.replace(/[^a-z0-9._-]/g, "")}@ornek.org`,
    phone,
    address,
    kvkkNoticeAccepted: true,
    politicalConsent: !p.noPoliticalConsent,
    aiConsent: !!p.aiConsent,
  };
}
