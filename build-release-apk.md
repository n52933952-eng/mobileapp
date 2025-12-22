# Build Release APK - Step by Step Guide

## Prerequisites
1. Make sure you have Android SDK installed
2. Java JDK installed
3. Node.js and npm installed

## Steps to Build Release APK

### Option 1: Using Gradle (Recommended)

1. **Open Terminal in VSCode** (Ctrl + ` or Terminal > New Terminal)

2. **Navigate to android folder:**
   ```bash
   cd android
   ```

3. **Clean previous builds:**
   ```bash
   ./gradlew clean
   ```

4. **Build Release APK:**
   ```bash
   ./gradlew assembleRelease
   ```

5. **Find your APK:**
   The APK will be located at:
   ```
   android/app/build/outputs/apk/release/app-release.apk
   ```

### Option 2: Using React Native CLI

1. **Navigate to project root:**
   ```bash
   cd mobile/appmobile
   ```

2. **Build Release APK:**
   ```bash
   npx react-native build-android --mode=release
   ```

### Option 3: Generate Signed APK (For Production)

**IMPORTANT:** For production, you need to create a proper keystore file.

1. **Generate a keystore (one-time setup):**
   ```bash
   cd android/app
   keytool -genkeypair -v -storetype PKCS12 -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
   ```

2. **Update `android/app/build.gradle`:**
   - Add signingConfigs for release
   - Update release buildType to use the new signing config

3. **Build signed APK:**
   ```bash
   cd android
   ./gradlew assembleRelease
   ```

## Current Configuration

⚠️ **Note:** Your current `build.gradle` uses debug keystore for release builds (line 107). This is fine for testing but NOT for production.

For production, you should:
1. Create a proper release keystore
2. Update the signingConfigs in build.gradle
3. Never commit the keystore file to git

## Quick Build Command (Copy & Paste)

```bash
cd mobile/appmobile/android && ./gradlew clean && ./gradlew assembleRelease
```

The APK will be at: `mobile/appmobile/android/app/build/outputs/apk/release/app-release.apk`











