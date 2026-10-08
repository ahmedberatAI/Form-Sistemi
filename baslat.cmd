@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem Forum Sistemi başlatıcısı: çift tıklayınca sunucuyu başlatır ve uygulamayı tarayıcıda açar.
rem Sunucu zaten açıksa (ya da açılmaktaysa) ikinci bir sunucu başlatmaz; yalnız tarayıcıyı açar.
if not defined PORT set "PORT=4000"
set "ADRES=http://localhost:%PORT%"
set "SAGLIK=http://127.0.0.1:%PORT%/api/health"
if "%~1"==":tarayici" goto tarayici
title Forum Sistemi - sunucu (kapatmak için bu pencereyi kapatın)

where curl.exe >nul 2>nul
if errorlevel 1 (
  echo Bu başlatıcı Windows 10 ya da daha yeni bir sürüm gerektirir; curl bulunamadı.
  pause
  exit /b 1
)

rem Sağlık denetimi: 0 = sunucu hazır, 7 = bu portta dinleyen yok, başka bir değer = sunucu açılıyor.
rem Windows kapalı porta bağlanmayı ~2 sn yeniden dener; bağlantı süresi bundan uzun olmalı ki sonuç 7 (zaman aşımı değil) çıksın.
curl.exe -s --connect-timeout 5 -m 8 -o NUL "%SAGLIK%"
set "DURUM=%errorlevel%"
if "%DURUM%"=="0" (
  start "" "%ADRES%"
  exit /b 0
)
if not "%DURUM%"=="7" (
  echo Forum Sistemi zaten açılıyor; hazır olunca tarayıcı açılacak.
  goto tarayici
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadı. https://nodejs.org adresinden Node.js 24 kurup tekrar deneyin.
  pause
  exit /b 1
)

rem İlk açılış: bağımlılıklar ve web arayüzü derlemesi yoksa hazırla.
if not exist "node_modules\" (
  echo Bağımlılıklar kuruluyor; ilk seferde birkaç dakika sürebilir...
  call npm ci || goto hata
)
if not exist "web\dist\index.html" (
  echo Web arayüzü derleniyor...
  call npm run build || goto hata
)

rem Yapay zekâ anahtarı bu pencereye geçmemişse setx ile kaydedilen kullanıcı ortam değişkeninden oku.
if not defined ANTHROPIC_API_KEY (
  for /f "tokens=2,*" %%a in ('reg query "HKCU\Environment" /v ANTHROPIC_API_KEY 2^>nul ^| find "ANTHROPIC_API_KEY"') do set "ANTHROPIC_API_KEY=%%b"
)

rem Sunucu hazır olunca tarayıcıyı açan küçük yardımcı (aynı betik, ayrı küçültülmüş pencerede).
start "" /min cmd /c ""%~f0" :tarayici"

echo Forum Sistemi başlatılıyor; tarayıcı birazdan açılacak.
echo Kapatmak için bu pencereyi kapatın.
echo.
call npm start
if errorlevel 1 (
  echo.
  echo Sunucu bir hatayla kapandı; ayrıntılar yukarıda.
  pause
)
exit /b

:tarayici
for /l %%i in (1,1,180) do (
  curl.exe -s -f -m 2 -o NUL "%SAGLIK%" && (start "" "%ADRES%" & exit /b 0)
  timeout /t 1 /nobreak >nul
)
exit /b 1

:hata
echo.
echo Hazırlık başarısız oldu; yukarıdaki iletiyi kontrol edin.
pause
exit /b 1
