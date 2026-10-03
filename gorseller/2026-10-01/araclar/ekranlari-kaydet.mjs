import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.argv[2] || 'web';
if (!['web', 'android'].includes(platform)) throw new Error('web veya android seçin');
const base = 'http://127.0.0.1:4177';
const adb = 'C:/Users/omen/AppData/Local/Android/Sdk/platform-tools/adb.exe';
const out = join(root, platform);
mkdirSync(out, { recursive: true });
const captures = [], issues = [], checks = [];
const tail = process.argv.includes('--tail');
const details = process.argv.includes('--details');
let replaceCapture = false;
function saveInventory() {
  const content=JSON.stringify({platform,system,dashboard,captures,issues,checks},null,2);
  for(let attempt=0;attempt<8;attempt++) {
    try { writeFileSync(join(root,platform+'-envanter.json'),content); return; }
    catch(err) { if(attempt===7) throw err; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100); }
  }
}
let page, browser, role = '', number = 0;
if(tail || details) {
  const previous=JSON.parse(readFileSync(join(root,platform+'-envanter.json'),'utf8'));
  captures.push(...previous.captures); issues.push(...previous.issues); checks.push(...previous.checks);
  number=captures.length;
  for(const check of checks) if(check.test==='Açık oylamada makbuz doğrulama') check.ok=check.text.includes('Şimdilik doğrulandı')&&!check.text.includes('Doğrulama başarısız');
}
const get = async path => { const res = await fetch(base + path); if (!res.ok) throw new Error(`${path}: ${res.status}`); return res.json(); };
const [proposals, topics, system, dashboard, status, txs, users] = await Promise.all([
  get('/api/proposals'), get('/api/topics'), get('/api/system'), get('/api/dashboard'),
  get('/api/ledger/status'), get('/api/ledger/txs?type=TALLY&limit=1'), get('/api/users?q=ayse'),
]);
const proposal = n => proposals.find(p => p.seq === n);
const ppath = n => '/oneriler/' + proposal(n).id;
const passwords = { ayse: 'Uye12345!', mehmet: 'Uye12345!', yonetici: 'Yonetici123!', kayitmemuru: 'Kayit123!', denetci: 'Denetci123!', bk_saglik1: 'Bilirkisi123!' };
const tokens = new Map();
async function loginToken(as) {
  if (!as) return null;
  if (!tokens.has(as)) {
    const res = await fetch(base + '/api/auth/login', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify({login:as,password:passwords[as]})});
    if (!res.ok) throw new Error(`Giriş: ${as} ${res.status}`);
    tokens.set(as, (await res.json()).token);
  }
  return tokens.get(as);
}
async function settle() {
  await page.locator('main').waitFor({state:'visible'});
  await page.waitForFunction(() => !document.querySelector('.spinner-wrap'), null, {timeout:20000});
  await page.waitForLoadState('networkidle', {timeout:12000}).catch(()=>{});
  await page.evaluate(() => document.fonts.ready);
}
async function prefs(values) {
  await page.evaluate(async values => {
    for (const [key,value] of Object.entries(values)) {
      if (window.Capacitor?.getPlatform() === 'android') {
        if(value == null) await window.Capacitor.Plugins.Preferences.remove({key});
        else await window.Capacitor.Plugins.Preferences.set({key,value});
      }
      if(value == null) localStorage.removeItem(key); else localStorage.setItem(key,value);
    }
  }, values);
}
async function as(name = '') {
  role = name || 'ziyaretci';
  await prefs({'forum.token':await loginToken(name)});
  await page.goto((platform === 'android' ? 'http://localhost/' : base + '/') + '?capture=' + Date.now() + '#/');
  await settle();
}
async function go(path) {
  await page.goto((platform === 'android' ? 'http://localhost/' : base + '/') + '?capture=' + Date.now() + '#' + path);
  await settle();
  await page.evaluate(() => window.scrollTo(0,0));
}
const slug = s => s.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
async function capture(title, note = '', anchor) {
  if(anchor) {
    const loc = typeof anchor === 'string' ? page.getByRole('heading',{name:anchor,exact:true}).first() : anchor;
    if(await loc.count()) await loc.evaluate((el,offset)=>{el.scrollIntoView({block:'start'}); window.scrollBy(0,-offset)},platform==='web'?128:85);
  }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(()=>requestAnimationFrame(r))));
  const existing=replaceCapture?captures.findIndex(c=>c.title===title):-1;
  const file = existing>=0?captures[existing].file.split('/').at(-1):String(++number).padStart(3,'0') + '-' + slug(title) + '.png';
  const state = await page.evaluate(() => ({
    path:location.hash.slice(1), width:innerWidth, height:innerHeight,
    scrollY, overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
    headings:[...document.querySelectorAll('main h1,main h2,main h3')].map(e=>e.textContent),
    alerts:[...document.querySelectorAll('main [role=alert]')].map(e=>e.textContent),
    text:document.querySelector('main').innerText,
    nativePlatform:window.Capacitor?.getPlatform() || 'web',
  }));
  if(platform === 'android') {
    const png=execFileSync(adb,['-s','emulator-5554','exec-out','screencap','-p'],{maxBuffer:20*1024*1024});
    writeFileSync(join(out,file),png);
  } else await page.screenshot({path:join(out,file),fullPage:false,animations:'disabled'});
  const item={title,note,role,file:`${platform}/${file}`,at:new Date().toISOString(),...state};
  if(existing>=0) captures[existing]=item; else captures.push(item);
  if(state.overflow) issues.push({title,type:'overflow',pixels:state.overflow});
  saveInventory();
  console.log(`[${platform}] ${file}`);
}
async function view(title,path,note='',anchor) { await go(path); await capture(title,note,anchor); }
// chips=true: Öneriler listesindeki 'Evre' çipleri de (Oylamada, İtiraz ve uzlaşma, Kabul edilen…) ayrı çekilir; 'Hepsi' sekme çekimidir.
async function tabs(title,path,note='',chips=false) {
  await go(path);
  const list=page.locator('main [role=tablist]').first();
  if(!await list.count()) { await capture(title,note); return; }
  const n=await list.getByRole('tab').count();
  for(let i=0;i<n;i++) {
    const tab=list.getByRole('tab').nth(i);
    if(await tab.isDisabled()) continue;
    const label=(await tab.innerText()).replace(/\s+/g,' ').trim();
    await tab.click(); await settle();
    await page.evaluate(()=>window.scrollTo(0,0));
    await capture(`${title} — ${label}`,note,platform==='android'?list:undefined);
    const group=page.getByRole('group',{name:'Evre',exact:true});
    if(!chips || !await group.count()) continue;
    const m=await group.getByRole('button').count();
    for(let j=1;j<m;j++) {
      const chip=group.getByRole('button').nth(j);
      if(((await chip.getAttribute('class'))||'').includes('phase-chip-empty')) continue;
      const chipLabel=(await chip.innerText()).replace(/\s+/g,' ').trim();
      await chip.click(); await settle();
      await page.evaluate(()=>window.scrollTo(0,0));
      await capture(`${title} — ${chipLabel}`,note,platform==='android'?list:undefined);
      await chip.click(); await settle(); // seçili çipe yeniden dokunmak 'Hepsi'ne döner
    }
  }
}

let backup;
try {
  browser = platform === 'android'
    ? await chromium.connectOverCDP('http://127.0.0.1:9223',{noDefaults:true})
    : await chromium.launch({headless:true,channel:'chrome'});
  if(platform==='android') page=browser.contexts()[0].pages()[0];
  else {
    const context=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1,locale:'tr-TR',timezoneId:'Europe/Istanbul',colorScheme:'light'});
    page=await context.newPage(); await page.goto(base);
  }
  page.on('pageerror',err=>issues.push({type:'pageerror',message:err.message,path:page.url()}));
  page.setDefaultTimeout(20000);
  page.on('console',msg=>{if(msg.type()==='error') issues.push({type:'console',message:msg.text(),path:page.url()});});
  if(platform==='android') {
    backup=await page.evaluate(async()=>({url:location.href,values:await Promise.all(['forum.token','forum.serverUrl','forum.theme','forum.detail','forum.dismissed','forum.receipts','forum.validators'].map(async key=>({key,native:(await window.Capacitor.Plugins.Preferences.get({key})).value,web:localStorage.getItem(key)})))}));
    const tmp=readFileSync(join(tmpdir(),'forum-inceleme-current.txt'),'utf8').trim();
    const backupFile=join(tmp,'android-original-preferences.json');
    if(!existsSync(backupFile)) writeFileSync(backupFile,JSON.stringify(backup));
    // Görünüm yoğunluğu ve gizlenen notlar da sıfırlanır: çekimler varsayılan 'Sade' görünümde ve notlar görünür olsun.
    await prefs({'forum.serverUrl':'http://10.0.2.2:4177','forum.theme':'light','forum.detail':null,'forum.dismissed':null,'forum.token':null,'forum.receipts':null,'forum.validators':null});
  } else await prefs({'forum.theme':'light','forum.detail':null,'forum.dismissed':null});
  await as();
  if(details) {
    replaceCapture=true;
    await view('Kayıt — aydınlatma ve onaylar','/kayit','Başvuru gönderilmedi.',page.locator('legend').filter({hasText:'Aydınlatma metni ve açık rıza'}));
    await as('ayse');
    await view('Tartışma ve mesajlar',ppath(32),'Yanıtlar ve görüş işaretleri.',page.getByRole('heading',{name:/^Tartışma \(/}));
    await view('Bilirkişi paneli ve kura',ppath(32),'Kura kayıtları ve bilirkişi raporları.','Bilirkişi görüşü');
    await view('Uzlaşma ve azınlık raporları',ppath(28),'Azınlık raporları ve uzlaşma.','Uzlaşma turu');
    await go(ppath(24)); await page.getByRole('button',{name:'Sayımı kendim doğrulayayım',exact:true}).click(); await settle();
    await capture('Kesin sayımı cihazda doğrulama','Birinci tur ve yeniden oylama sayımları doğrulandı.','Sayımı kendim doğrulayayım');
    replaceCapture=false;
    await go(ppath(32));
    // Kura kayıtları, sade görünümde kapalı gelen "Kura ve adillik kanıtı" açılırının içindedir.
    await page.locator('summary').filter({hasText:/^Kura ve adillik kanıtı/}).click();
    await page.locator('summary').filter({hasText:/^Kura kayıtları/}).click();
    await capture('Bilirkişi kurası — adaylar ve seçim','Tohum, aday havuzu ve seçilen üyeler.',page.locator('summary').filter({hasText:/^Kura kayıtları/}));
    // Rapor satırı sade görünümde kapalıdır: 'Raporu oku' gövdeyi, riskleri ve karşı görüşü satır içinde açar.
    await go(ppath(32));
    await page.getByRole('button',{name:'Raporu oku'}).first().click();
    await capture('Bilirkişi raporu ve sorular','Uygulanabilirlik raporu (açık) ve üye soruları.','Raporlar (1)');
    await view('Yapay zekâ — tartışma özeti',ppath(32),'Çevrimdışı sezgisel mod.','Tartışma özeti (yapay zekâ)');
    await view('Yapay zekâ — köprü taslakları',ppath(28),'Danışma amaçlı uzlaşma metinleri.','Yapay zekâ köprü taslakları');
    // Katlı kartlar (sade görünüm) ?bolum= ile açık gelir; başlık görünür kalır, çekim kartın açık gövdesini gösterir.
    for(const [title,anchor] of [['Açık rızalar','rizalar'],['Vekâletler','vekaletler'],['Kimlik bilgilerimi düzelt','duzeltme'],['Takma ad değiştir','takma-ad'],['Kişisel verilerim (KVKK)','kvkk']])
      await view('Profil — '+title,'/profil?bolum='+anchor,'Form görüntülendi; veri değiştirilmedi.',title);
    await as('bk_saglik1'); replaceCapture=true;
    await view('Bilirkişi — görevli olduğu öneri',ppath(32),'Bilirkişi hesabının görüntüsü.','Bilirkişi görüşü');
  } else {
  if(!tail) {
  await capture('Ana sayfa — ziyaretçi','Topluluk özeti, temel ilkeler ve katılım bağlantıları.');
  await view('Giriş','/giris');
  await view('Kayıt — kimlik ve rızalar','/kayit');
  await view('Kayıt — aydınlatma ve onaylar','/kayit','Başvuru gönderilmedi.',page.getByRole('button',{name:/Kayıt ol|Başvuruyu gönder/}).last());
  await view('Konular','/konular');
  await view('Konu ayrıntısı ve alt konular','/konular/'+topics.find(t=>topics.some(x=>x.parentId===t.id)).id);
  await tabs('Öneriler','/oneriler','Sekmeler ve evre çipleri.',true);
  await view('Keşfet ve doğrula','/kesfet','Yedi bileşen canlı durumuyla; gösterim rehberi, temel ilkeler ve sözlük.');
  await view('Keşfet — gösterim rehberi','/kesfet','Yedi adım mevcut veriden kurulur (son karar, ilk aykırı öneri).','Gösterim rehberi');
  await view('Keşfet — sözlük','/kesfet','Terim aynen; günlük karşılık, tanım ve dayanak madde.','Sözlük');
  await as('ayse');
  await capture('Ana sayfa — üye','Üyeye ait katılım görevleri.');
  if(platform==='android') {
    await page.getByRole('button',{name:/Daha fazla/}).click(); await capture('Mobil gezinme menüsü');
    await page.keyboard.press('Escape');
    if(await page.locator('dialog[open]').count()) await page.getByRole('button',{name:/Kapat/}).first().click();
  }
  await view('Yeni öneri — tür seçimi','/oneriler/yeni');
  for(const [kind,title] of [['topic','Yeni konu'],['subtopic','Alt konu'],['amendment','Düzenleme teklifi'],['deletion','Silme talebi'],['regulation','Yönetmelik değişikliği']])
    await view(`Yeni öneri — ${title}`,`/oneriler/yeni?tur=${kind}${['subtopic','amendment'].includes(kind)?'&konu='+topics[0].id:''}`,'Form görüntülendi; öneri yayımlanmadı.');
  const privateList=await (await fetch(base+'/api/proposals',{headers:{Authorization:'Bearer '+await loginToken('ayse')}})).json();
  for(const p of privateList) if(!proposals.some(x=>x.id===p.id)) proposals.push(p);
  for(const n of [34,33,32,30,31,29,28,27,24,25,22,23,6,26,21,5,7]) {
    const p=proposal(n);
    await view(`K${n} — ${p.status}`,ppath(n),p.title);
  }
  await view('Tartışma ve mesajlar',ppath(32),'Mesaj yanıtları, görüş işaretleri ve sürüm geçmişi.','Tartışma');
  await view('Bilirkişi paneli ve kura',ppath(32),'Uzman seçimi, rapor ve soru alanı.','Bilirkişi paneli');
  await view('Uzlaşma ve azınlık raporları',ppath(28),'İtiraz gerekçeleri ve köprü metinleri.','Uzlaşma');
  await go(ppath(30));
  await capture('Oy verme paneli','Ayrı demo verisindeki #K-30.','Oylama');
  const voteButton=page.getByRole('button',{name:'Oyumu ver',exact:true});
  if(await voteButton.count()) {
    await page.locator('input[type=radio][value=yes]').check();
    await voteButton.click(); await settle();
  } else {
    const save=page.getByRole('button',{name:'Makbuzu bu cihaza kaydet',exact:true});
    if(await save.count()) {await save.click(); await settle();}
  }
  await page.locator('.receipt-saved').waitFor();
  checks.push({test:'Oy ve cihazda makbuz',ok:true,proposal:30});
  await capture('Oy makbuzu','Demo oyu ve cihazda saklanan makbuz.',page.locator('.receipt-box'));
  await go('/oy-dogrula?oneri='+proposal(30).id);
  await page.waitForFunction(()=>/Şimdilik doğrulandı|Doğrulama başarısız|Oyunuz kayıtlı ve sayıma girdi/.test(document.querySelector('main')?.innerText||''),null,{timeout:15000});
  const verificationText=await page.locator('main').innerText();
  checks.push({test:'Açık oylamada makbuz doğrulama',ok:verificationText.includes('Şimdilik doğrulandı')&&!verificationText.includes('Doğrulama başarısız'),text:verificationText});
  await capture('Oyum kayıtlı mı — doğrulama','Açık oylamada sayım ve açıklama adımları henüz beklemede.','Doğrulama adımları');
  await go(ppath(24));
  await page.getByRole('button',{name:'Sayımı kendim doğrulayayım',exact:true}).click(); await settle();
  await capture('Kesin sayımı cihazda doğrulama','Bülten verilerinden sayım yeniden hesaplanır.','Sayımı kendim doğrulayayım');
  checks.push({test:'Kesin sayım doğrulama ekranı',text:await page.locator('main').innerText()});
  // Sade dil: parametreler günlük adlarıyla, semboller anahtarın arkasında; terimler sözlük penceresi açar.
  await view('Karar parametreleri — sade dil',ppath(7)+'?bolum=parametreler','Her parametre günlük adıyla; semboller ve formüller anahtarın arkasında.','Karar parametreleri');
  await page.getByRole('button',{name:/^Onay eşiği/}).first().click();
  await capture('Sözlük penceresi — terim açıklaması','Terim aynen kalır; günlük karşılık, tanım ve dayanak madde pencerede açılır.');
  await page.keyboard.press('Escape');
  if(await page.locator('dialog[open]').count()) await page.getByRole('button',{name:/Kapat/}).first().click();
  await tabs('Graf','/graf');
  await tabs('Bilirkişiler','/bilirkisiler');
  await view('Üye profili — ilişkiler ve vekâlet','/uyeler/'+users.find(u=>u.nickname==='ayse').id);
  await view('Profil ve rızalar','/profil');
  await tabs('Bildirimler','/bildirimler');
  await tabs('Yönetmelik','/yonetmelik');
  await tabs('Dağıtık defter','/defter');
  await view('Defter — blok ayrıntısı','/defter/blok/'+status.height);
  await view('Defter — işlem ve kanıt','/defter/islem/'+txs[0].hash);
  } else await as('ayse');
  await go('/ayarlar');
  await page.getByRole('button',{name:'Bağlantıyı sına',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('main')?.innerText.includes('Sunucuya ulaşıldı'));
  checks.push({test:'Sunucu bağlantısı',ok:true});
  await capture('Ayarlar — bağlantı ve tema');
  // 'Uygulama hakkında' Gelişmiş altında katlı karttır: ?bolum=hakkinda ile açık gelir.
  await go('/ayarlar?bolum=hakkinda');
  await capture('Ayarlar — sürüm ve platform','Platform bilgisini gösterir.','Uygulama hakkında');
  await page.getByRole('radio',{name:'Koyu',exact:true}).check(); await go('/');
  await capture('Ana sayfa — koyu tema');
  await go('/ayarlar'); await page.getByRole('radio',{name:'Açık',exact:true}).check();
  // 'Tam — tüm ayrıntılar açık': gösterimde her şeyi tek seçimle açar. Çekimler bitince varsayılan 'Sade'ye dönülür.
  await page.getByRole('radio',{name:'Tam — tüm ayrıntılar açık',exact:true}).check();
  await capture('Ayarlar — Tam görünüm','Görünüm yoğunluğu: Tam — tüm ayrıntılar açık.');
  await view('Tam görünüm — öneri sayfası (#K-7)',ppath(7),'Bütün kartlar, semboller ve formüller açık.','Karar parametreleri');
  await view('Tam görünüm — Profil','/profil','Katlı kartların hepsi açık.');
  await go('/ayarlar'); await page.getByRole('radio',{name:'Sade (önerilen)',exact:true}).check();
  await as('kayitmemuru'); await tabs('Kayıt memuru','/kayit-memuru');
  await as('yonetici'); await tabs('Yönetim','/yonetim');
  await tabs('Bilirkişi yönetimi','/bilirkisiler');
  await as('denetci'); await view('Denetçi — erişim günlüğü','/yonetim');
  await as('bk_saglik1'); await tabs('Bilirkişi görevleri','/bilirkisiler');
  await view('Bilirkişi — görevli olduğu öneri',ppath(32),'Bilirkişi hesabının görüntüsü.','Bilirkişi paneli');
  }
  console.log(JSON.stringify({platform,count:captures.length,issues,checks:checks.map(c=>({test:c.test,ok:c.ok}))}));
} finally {
  saveInventory();
  if(backup && page) {
    await page.evaluate(async backup=>{
      for(const {key,native,web} of backup.values) {
        if(native==null) await window.Capacitor.Plugins.Preferences.remove({key}); else await window.Capacitor.Plugins.Preferences.set({key,value:native});
        if(web==null) localStorage.removeItem(key); else localStorage.setItem(key,web);
      }
    },backup).catch(()=>{});
    await page.goto(backup.url).catch(()=>{});
    await page.reload().catch(()=>{});
  }
  if(browser) await browser.close();
}
