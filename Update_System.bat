@echo off
cd /d "%~dp0"

:: ============================================
::  تحديث ونشر النظام إلى GitHub Pages
:: ============================================

echo ============================================
echo   منظومة إجازات الموظفين - التحديث والنشر
echo ============================================
echo.

:: 1. فحص الملفات المعدلة
echo [1/4] جاري فحص الملفات المعدلة...
git add .
echo تمت إضافة جميع الملفات المعدلة.
echo.

:: 2. رفع التعديلات
echo [2/4] جاري رفع التعديلات إلى GitHub...
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set dt=%%I
set datetime=%dt:~0,8%_%dt:~8,6%
git commit -m "Auto Update: %datetime%"
git push origin main
echo تم رفع التعديلات بنجاح.
echo.

:: 3. بناء ونشر الموقع
echo [3/4] جاري بناء ونشر الموقع على GitHub Pages...
cd /d "%~dp0frontend"
call npm run deploy
if %errorlevel% neq 0 (
    echo [!] فشلت عملية النشر. تحقق من الأخطاء أعلاه.
    pause
    exit /b 1
)
echo.
echo [4/4] تم نشر الموقع بنجاح!
echo.

:: 4. الرجوع للمجلد الرئيسي
cd /d "%~dp0"

echo ============================================
echo   تم التحديث والنشر بنجاح - الحمد لله
echo   الموقع: https://wwawqf-dot.github.io/hr-2026-awqf/
echo ============================================
echo.
pause
