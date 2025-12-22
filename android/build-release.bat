@echo off
echo Setting Node.js memory limit to 4GB...
set NODE_OPTIONS=--max-old-space-size=4096

echo Cleaning previous builds...
call gradlew.bat clean

echo Building Release APK...
call gradlew.bat assembleRelease

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Build SUCCESSFUL!
    echo ========================================
    echo APK location: app\build\outputs\apk\release\app-release.apk
    echo ========================================
) else (
    echo.
    echo ========================================
    echo Build FAILED!
    echo ========================================
)

pause











