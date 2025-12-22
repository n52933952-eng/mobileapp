import ReactNativeBiometrics from 'react-native-biometrics';
import FingerprintScanner from 'react-native-fingerprint-scanner';
import { Platform } from 'react-native';

// Configure react-native-biometrics to use native Android BiometricPrompt
const rnBiometrics = new ReactNativeBiometrics({
  allowDeviceCredentials: false, // Force biometric only (Face ID / Fingerprint)
});

export interface BiometricResult {
  available: boolean;
  biometryType: string | null;
  error?: string;
}

export interface BiometricAuthResult {
  success: boolean;
  error?: string;
  message?: string;
}

/**
 * Check if biometric authentication is available
 * Tries react-native-biometrics first, then falls back to react-native-fingerprint-scanner
 */
export const checkBiometricAvailability = async (): Promise<BiometricResult> => {
  try {
    // Try react-native-biometrics first (supports both Face ID and Fingerprint)
    const result = await rnBiometrics.isSensorAvailable();
    if (result.available) {
      return {
        available: true,
        biometryType: result.biometryType || null,
      };
    }
  } catch (error: any) {
    console.log('react-native-biometrics not available, trying fingerprint-scanner...');
  }

  // Fallback to react-native-fingerprint-scanner
  try {
    const isAvailable = await FingerprintScanner.isSensorAvailable();
    if (isAvailable) {
      // Try to get biometric type
      let biometryType = Platform.OS === 'ios' ? 'TouchID' : 'Fingerprint';
      
      // On iOS, check if it's FaceID or TouchID
      if (Platform.OS === 'ios') {
        try {
          // react-native-fingerprint-scanner doesn't directly tell us if it's FaceID
          // but we can infer from the device capabilities
          // For now, we'll use TouchID as default and let the system handle it
          biometryType = 'TouchID'; // Could be FaceID on newer devices
        } catch (e) {
          // Ignore
        }
      }
      
      return {
        available: true,
        biometryType,
      };
    }
  } catch (error: any) {
    console.log('react-native-fingerprint-scanner not available:', error.message);
  }

  return {
    available: false,
    biometryType: null,
    error: 'Biometric authentication not available on this device',
  };
};

/**
 * Authenticate user with biometrics
 * Tries react-native-biometrics first, then falls back to react-native-fingerprint-scanner
 */
export const authenticateWithBiometrics = async (
  promptMessage: string = 'تأكيد الهوية',
  fallbackPromptMessage: string = 'استخدم كلمة المرور'
): Promise<BiometricAuthResult> => {
  try {
    // Try react-native-biometrics first
    const availability = await checkBiometricAvailability();
    
    if (!availability.available) {
      return {
        success: false,
        error: 'Biometric authentication not available',
        message: 'المصادقة الحيوية غير متاحة على هذا الجهاز',
      };
    }

    // Try react-native-biometrics (shows native Android BiometricPrompt)
    try {
      console.log('🔐 Biometrics: Calling rnBiometrics.simplePrompt...');
      console.log('🔐 Biometrics: promptMessage:', promptMessage);
      console.log('🔐 Biometrics: Platform:', Platform.OS);
      
      // Add timeout to detect if prompt hangs
      const promptPromise = rnBiometrics.simplePrompt({
        promptMessage: promptMessage || 'تأكيد الهوية',
        fallbackPromptMessage: fallbackPromptMessage || 'استخدم كلمة المرور',
        // Android specific: This ensures native BiometricPrompt is shown
        cancelButtonText: 'إلغاء',
      });
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Face ID prompt timeout after 30 seconds')), 30000);
      });
      
      console.log('⏳ Biometrics: Waiting for user to authenticate Face ID...');
      console.log('💡 Biometrics: Face ID prompt should appear now - please authenticate');
      
      let result;
      try {
        result = await Promise.race([promptPromise, timeoutPromise]) as any;
      } catch (timeoutError: any) {
        console.error('❌ Biometrics: Face ID prompt timeout or error:', timeoutError.message);
        throw timeoutError;
      }

      console.log('🔐 Biometrics: simplePrompt result received!');
      console.log('🔐 Biometrics: result.success:', result?.success);
      console.log('🔐 Biometrics: result.error:', result?.error);
      console.log('🔐 Biometrics: result object:', JSON.stringify(result));

      if (!result) {
        console.error('❌ Biometrics: No result received from simplePrompt');
        return {
          success: false,
          error: 'No result from biometric prompt',
          message: 'فشل التحقق من الهوية',
        };
      }
      
      if (result.success) {
        console.log('✅ Biometrics: Authentication successful!');
        return {
          success: true,
          message: 'تم التحقق بنجاح',
        };
      } else {
        console.log('❌ Biometrics: Authentication failed or cancelled');
        console.log('❌ Biometrics: Error:', result.error);
        return {
          success: false,
          error: result.error || 'User cancelled or failed',
          message: result.error?.includes('cancel') ? 'تم إلغاء العملية' : 'تم إلغاء العملية أو فشل التحقق',
        };
      }
    } catch (biometricsError: any) {
      console.error('❌ Biometrics: react-native-biometrics failed:', biometricsError.message);
      console.error('❌ Biometrics: Error details:', biometricsError);
      
      // Fallback to react-native-fingerprint-scanner
      console.log('🔄 Biometrics: Falling back to react-native-fingerprint-scanner...');
      try {
        if (Platform.OS === 'android') {
          // Android - uses native BiometricPrompt (API 23+)
          // Make sure it shows the native Android BiometricPrompt dialog
          console.log('🔐 Biometrics: Android - calling FingerprintScanner.authenticate...');
          await FingerprintScanner.authenticate({
            title: promptMessage || 'تأكيد الهوية',
            subTitle: fallbackPromptMessage || 'استخدم كلمة المرور',
            description: 'ضع إصبعك على الماسح الضوئي',
            cancelButton: 'إلغاء',
            // Android specific options to ensure native BiometricPrompt
            negativeButtonText: 'إلغاء',
            allowDeviceCredentials: false, // Force biometric only
          });
          console.log('✅ Biometrics: FingerprintScanner.authenticate SUCCESS (Android)');
        } else {
          // iOS - uses TouchID/FaceID
          console.log('🔐 Biometrics: iOS - calling FingerprintScanner.authenticate...');
          await FingerprintScanner.authenticate({
            description: promptMessage || 'تأكيد الهوية',
            fallbackTitle: fallbackPromptMessage || 'استخدم كلمة المرور',
          });
          console.log('✅ Biometrics: FingerprintScanner.authenticate SUCCESS (iOS)');
        }

        return {
          success: true,
          message: 'تم التحقق بنجاح',
        };
      } catch (fingerprintError: any) {
        console.error('❌ Biometrics: FingerprintScanner.authenticate failed:', fingerprintError);
        // Handle fingerprint scanner errors
        let errorMessage = 'تم إلغاء العملية أو فشل التحقق';
        
        // react-native-fingerprint-scanner error types
        if (fingerprintError.name === 'UserCancel' || fingerprintError.message?.includes('UserCancel')) {
          errorMessage = 'تم إلغاء العملية';
        } else if (fingerprintError.name === 'UserFallback' || fingerprintError.message?.includes('UserFallback')) {
          errorMessage = 'تم اختيار طريقة بديلة';
        } else if (fingerprintError.name === 'SystemCancel' || fingerprintError.message?.includes('SystemCancel')) {
          errorMessage = 'تم إلغاء العملية من النظام';
        } else if (fingerprintError.name === 'AuthenticationFailed' || fingerprintError.message?.includes('AuthenticationFailed')) {
          errorMessage = 'فشل التحقق من الهوية';
        } else if (fingerprintError.message) {
          errorMessage = fingerprintError.message;
        }

        return {
          success: false,
          error: fingerprintError.message || fingerprintError.name || 'Authentication failed',
          message: errorMessage,
        };
      }
    }
  } catch (error: any) {
    console.error('Biometric authentication error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
      message: 'حدث خطأ أثناء التحقق',
    };
  }
};

/**
 * Get biometric type name in Arabic
 */
// Note: This function should be used with translations in components
// For direct use, import i18n and use t() function
export const getBiometricTypeName = (biometryType: string | null, t?: (key: string) => string): string => {
  if (!biometryType) {
    return t ? t('biometricSetup.notAvailable') : 'Not Available';
  }
  
  switch (biometryType) {
    case ReactNativeBiometrics.TouchID:
    case 'TouchID':
      return t ? t('biometricSetup.touchID') : 'Touch ID';
    case ReactNativeBiometrics.FaceID:
    case 'FaceID':
      return t ? t('biometricSetup.faceID') : 'Face ID';
    case ReactNativeBiometrics.Biometrics:
    case 'Fingerprint':
      return t ? t('biometricSetup.fingerprint') : 'Fingerprint';
    default:
      return t ? t('biometricSetup.biometric') : 'Biometric';
  }
};

/**
 * Get existing biometric public key (without creating new keys)
 * Uses react-native-biometrics only
 * Returns the existing public key if keys exist, or null if they don't
 */
export const getExistingBiometricPublicKey = async (): Promise<{
  success: boolean;
  publicKey?: string;
  error?: string;
}> => {
  try {
    // Check if keys exist first
    const keysExist = await rnBiometrics.biometricKeysExist();
    if (!keysExist.keysExist) {
      console.log('🔑 No existing biometric keys found');
      return {
        success: false,
        error: 'No biometric keys exist',
      };
    }
    
    // Keys exist - get the public key
    // Note: createKeys() returns existing public key if keys already exist
    // It doesn't overwrite existing keys
    const { publicKey } = await rnBiometrics.createKeys();
    return {
      success: true,
      publicKey,
    };
  } catch (error: any) {
    console.error('Get existing biometric public key error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
};

/**
 * Create biometric keys (for secure storage)
 * Uses react-native-biometrics only
 * Note: If keys already exist, this will return the existing public key
 */
export const createBiometricKeys = async (): Promise<{
  success: boolean;
  publicKey?: string;
  error?: string;
}> => {
  try {
    // createKeys() returns existing public key if keys already exist
    // It only creates new keys if they don't exist
    const { publicKey } = await rnBiometrics.createKeys();
    return {
      success: true,
      publicKey,
    };
  } catch (error: any) {
    console.error('Create biometric keys error:', error);
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
};

/**
 * Delete biometric keys
 * Uses react-native-biometrics only
 */
export const deleteBiometricKeys = async (): Promise<boolean> => {
  try {
    await rnBiometrics.deleteKeys();
    return true;
  } catch (error) {
    console.error('Delete biometric keys error:', error);
    return false;
  }
};

/**
 * Release fingerprint scanner resources (for react-native-fingerprint-scanner)
 */
export const releaseFingerprintScanner = (): void => {
  try {
    FingerprintScanner.release();
  } catch (error) {
    console.error('Release fingerprint scanner error:', error);
  }
};

export default rnBiometrics;



