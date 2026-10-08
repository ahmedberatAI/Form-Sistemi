@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem Forum Sistemi SUNUM MODU: isteğe bağlı taze demo verisi (bütün hesaplar deneme123) + gerçek zamanlı saat (TIME_SCALE=1).
title Forum Sistemi - sunum modu
if not defined PORT set "PORT=4000"
if defined DATA_DIR (set "VERI=%DATA_DIR%") else (set "VERI=server\data")
set "SAGLIK=http://127.0.0.1:%PORT%/api/health"

echo ============================================================
echo   FORUM SİSTEMİ - SUNUM MODU
echo   Saat gerçek zamanlı işler: sunum sırasında öneriler kendi
echo   kendine evre değiştirmez. Geçişleri Yönetim ^> "Saat ileri"
echo   ile istediğin anda gösterebilirsin.
echo ============================================================
echo.

where curl.exe >nul 2>nul || (echo Bu başlatıcı Windows 10 ya da daha yeni bir sürüm gerektirir. & pause & exit /b 1)
where npm >nul 2>nul || (echo Node.js bulunamadı. https://nodejs.org adresinden Node.js 24 kurun. & pause & exit /b 1)

rem Sunucu açıkken veri sıfırlanamaz (veri klasörü kilitli): önce kapatılmalı.
curl.exe -s --connect-timeout 5 -m 8 -o NUL "%SAGLIK%"
if not "%errorlevel%"=="7" (
  echo Forum Sistemi şu an açık. Sunum modu için önce açık sunucu penceresini kapatın,
  echo sonra bu kısayolu yeniden çalıştırın.
  pause
  exit /b 1
)

rem SUNUM_TAZE=E/H verilirse soru sorulmaz (otomatik kullanım).
if /i "%SUNUM_TAZE%"=="H" goto baslat
if /i "%SUNUM_TAZE%"=="E" goto yedek
choice /c EH /n /m "Taze sunum verisi yüklensin mi? Bütün hesapların şifresi deneme123 olur; mevcut veri yedeklenir. [E/H]: "
if errorlevel 2 goto baslat

:yedek

if not exist "%VERI%\forum.db" goto tohum
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "DAMGA=%%t"
echo Mevcut veri yedekleniyor: %VERI%-yedek\%DAMGA%
robocopy "%VERI%" "%VERI%-yedek\%DAMGA%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto hata

:tohum
echo Sunum verisi hazırlanıyor (yaklaşık yarım dakika)...
set "TOHUM_SIFRE=deneme123"
call npm run seed -w server -- --reset || goto hata
set "TOHUM_SIFRE="
echo.

:baslat
set "TIME_SCALE=1"
call "%~dp0baslat.cmd"
exit /b

:hata
echo.
echo Sunum verisi hazırlanamadı; yukarıdaki iletiyi kontrol edin. Mevcut verinin yedeği %VERI%-yedek klasöründe.
pause
exit /b 1
