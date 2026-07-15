@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title منظومة إجازات الموظفين - التشغيل

cd /d "%~dp0"

echo ================================================================
echo    منظومة إدارة إجازات الموظفين - التشغيل التلقائي
echo ================================================================
echo.

REM ---------------------------------------------------------------
REM  1) التحقق من وجود Node.js و npm على هذا الجهاز
REM ---------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [خطأ] لم يتم العثور على Node.js على هذا الجهاز.
    echo.
    echo يرجى تحميل وتثبيت Node.js أولاً ^(الإصدار الموصى به: LTS^)
    echo من الموقع الرسمي:  https://nodejs.org
    echo.
    echo بعد اكتمال التثبيت، أعد تشغيل هذا الملف "start.bat" مرة أخرى.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo [خطأ] لم يتم العثور على npm على هذا الجهاز.
    echo يرجى التأكد من تثبيت Node.js بشكل صحيح ثم إعادة المحاولة.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VERSION=%%v
echo تم العثور على Node.js إصدار: %NODE_VERSION%

set "NODE_VER_NUM=%NODE_VERSION:v=%"
for /f "delims=. tokens=1" %%a in ("%NODE_VER_NUM%") do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 22 (
    echo.
    echo [خطأ] يتطلب هذا النظام إصدار Node.js 22.5 أو أحدث ^(لدعم قاعدة بيانات SQLite المدمجة^).
    echo الإصدار الحالي لديك: %NODE_VERSION%
    echo يرجى تحديث Node.js من الموقع الرسمي: https://nodejs.org ثم إعادة تشغيل هذا الملف.
    echo.
    pause
    exit /b 1
)
echo.

REM ---------------------------------------------------------------
REM  2) تثبيت مكتبات الخادم الخلفي (Backend) إن لم تكن موجودة
REM ---------------------------------------------------------------
if not exist "backend\node_modules" (
    echo [1/4] جاري تثبيت مكتبات الخادم الخلفي "Backend"، يرجى الانتظار...
    pushd backend
    call npm install
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل تثبيت مكتبات الخادم الخلفي.
        popd
        pause
        exit /b 1
    )
    popd
    echo تم تثبيت مكتبات الخادم الخلفي بنجاح.
) else (
    echo [1/4] مكتبات الخادم الخلفي مثبتة مسبقاً، جاري التخطي...
)
echo.

REM ---------------------------------------------------------------
REM  3) تثبيت مكتبات الواجهة الأمامية (Frontend) إن لم تكن موجودة
REM ---------------------------------------------------------------
if not exist "frontend\node_modules" (
    echo [2/4] جاري تثبيت مكتبات الواجهة الأمامية "Frontend"، يرجى الانتظار...
    pushd frontend
    call npm install
    if errorlevel 1 (
        echo.
        echo [خطأ] فشل تثبيت مكتبات الواجهة الأمامية.
        popd
        pause
        exit /b 1
    )
    popd
    echo تم تثبيت مكتبات الواجهة الأمامية بنجاح.
) else (
    echo [2/4] مكتبات الواجهة الأمامية مثبتة مسبقاً، جاري التخطي...
)
echo.

REM ---------------------------------------------------------------
REM  4) بناء نسخة الإنتاج من الواجهة الأمامية (خادم واحد فقط)
REM     يتم البناء فقط إن لم تكن النسخة موجودة مسبقاً لتسريع
REM     عمليات التشغيل اللاحقة. لإجبار إعادة البناء بعد أي تعديل
REM     على الكود، احذف مجلد frontend\dist ثم شغّل الملف مجدداً.
REM ---------------------------------------------------------------
if not exist "frontend\dist" (
    echo [3/4] جاري بناء نسخة الإنتاج من الواجهة الأمامية...
    pushd frontend
    call npm run build
    if errorlevel 1 (
        echo.
        echo [خطأ] فشلت عملية بناء الواجهة الأمامية.
        popd
        pause
        exit /b 1
    )
    popd
    echo تم بناء الواجهة الأمامية بنجاح.
) else (
    echo [3/4] نسخة الإنتاج من الواجهة الأمامية موجودة مسبقاً، جاري التخطي...
)
echo.

REM ---------------------------------------------------------------
REM  5) تشغيل الخادم الخلفي (يخدم الواجهة الأمامية المبنية أيضاً
REM     عبر منفذ واحد فقط لضمان سهولة النقل بين الأجهزة)
REM ---------------------------------------------------------------
set PORT=3001
set URL=http://localhost:%PORT%

echo [4/4] جاري التحقق من حالة المنفذ %PORT% ...
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo يبدو أن الخادم يعمل بالفعل على المنفذ %PORT%.
    goto :openBrowser
)

echo جاري تشغيل خادم منظومة الإجازات على المنفذ %PORT% ...
start "Leave System Server" /D "%~dp0backend" cmd /k "set NODE_ENV=production&& npm start"

echo جاري الانتظار حتى يصبح الخادم جاهزاً...
set READY=0
for /l %%i in (1,1,20) do (
    if "!READY!"=="0" (
        powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%URL%/api/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
        if not errorlevel 1 (
            set READY=1
        ) else (
            timeout /t 1 /nobreak >nul
        )
    )
)

:openBrowser
echo.
start "" "%URL%"

echo ================================================================
echo   تم تشغيل المنظومة بنجاح!
echo   الرابط: %URL%
echo.
echo   بيانات دخول المدير الافتراضية عند أول تشغيل:
echo   اسم المستخدم: admin   /   كلمة المرور: admin2026
echo.
echo   الخادم يعمل الآن في نافذة منفصلة باسم "Leave System Server".
echo   لإيقاف النظام، أغلق تلك النافذة أو اضغط Ctrl+C بداخلها.
echo ================================================================
echo.
pause
