import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import {
  authenticateWithBiometrics,
  checkBiometricAvailability,
  getBiometricTypeName,
  releaseFingerprintScanner,
  createBiometricKeys,
  getExistingBiometricPublicKey,
} from '../services/biometrics';
import { authAPI } from '../services/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface BiometricSetupModalProps {
  onSetupComplete: () => void;
  onClose: () => void;
}

const BiometricSetupModal: React.FC<BiometricSetupModalProps> = ({ onSetupComplete, onClose }) => {
  const { biometricAvailable, biometricType, checkAuth, loginWithBiometrics } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [fingerprintPublicKey, setFingerprintPublicKey] = useState<string | null>(null);
  const [fingerprintCompleted, setFingerprintCompleted] = useState(false);
  const [hasTriedOnce, setHasTriedOnce] = useState(false);

  useEffect(() => {
    checkBiometric();
    
    // Cleanup
    return () => {
      releaseFingerprintScanner();
    };
  }, []);

  // Auto-trigger fingerprint authentication when modal first opens (only once)
  useEffect(() => {
    if (biometricChecked && biometricAvailable && !loading && !hasTriedOnce) {
      // Small delay to ensure modal is fully rendered
      const timer = setTimeout(() => {
        handleLoginWithBiometric();
      }, 300);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [biometricChecked, biometricAvailable]); // Only depend on these, not hasTriedOnce

  const checkBiometric = async () => {
    const result = await checkBiometricAvailability();
    setBiometricChecked(true);
  };

  const handleLoginWithBiometric = async () => {
    if (!biometricAvailable) {
      Alert.alert(t('biometricSetup.notAvailable'), t('biometricSetup.biometricNotAvailable'));
      return;
    }

    setLoading(true);
    setHasTriedOnce(true); // Mark that we're trying
    try {
      // Step 1: Authenticate with system biometric (shows fingerprint prompt like screenshot)
      const authResult = await authenticateWithBiometrics(
        t('checkIn.verifyIdentity'),
        t('checkIn.usePassword')
      );

      if (!authResult.success) {
        // Reset loading immediately
        setLoading(false);
        // Close modal and return to login screen
        Alert.alert('فشل التحقق', authResult.message || 'لم يتم التحقق من الهوية', [
          {
            text: 'موافق',
            onPress: () => {
              onClose();
            },
          },
        ]);
        return;
      }

      // Step 2: Get STORED fingerprint public key from AsyncStorage (matches database)
      // IMPORTANT: We use the stored key (from registration) because:
      // 1. The database has this key associated with the user
      // 2. Even if device keys are regenerated, we should use the stored key
      // 3. The backend will verify the fingerprint matches the user
      let fingerprintPublicKey: string | null = null;
      
      // CRITICAL: Use the EXACT key that was saved during registration
      // This key was sent to the backend and saved in the database
      // Priority: AsyncStorage (exact key from registration) > Device storage
      console.log('🔑 Getting fingerprint key (priority: AsyncStorage first, then device storage)...');
      
      // First, try AsyncStorage - this has the EXACT key that was sent to backend during registration
      const storedFingerprintPublicKey = await AsyncStorage.getItem('fingerprintPublicKey');
      if (storedFingerprintPublicKey) {
        // CRITICAL: Normalize the key (trim whitespace) to prevent intermittent mismatches
        // This ensures consistent comparison on backend
        fingerprintPublicKey = storedFingerprintPublicKey.trim();
        
        // Log if normalization changed the key (indicates whitespace issue)
        if (storedFingerprintPublicKey !== fingerprintPublicKey) {
          console.warn('⚠️ WARNING: Fingerprint key had whitespace! Normalized.');
          console.warn('   Original length:', storedFingerprintPublicKey.length);
          console.warn('   Normalized length:', fingerprintPublicKey.length);
        }
        
        console.log('✅ Using fingerprint key from AsyncStorage (EXACT key from registration)');
        console.log('🔑 Key (first 100 chars):', fingerprintPublicKey.substring(0, 100) + '...');
        console.log('🔑 Key (full length):', fingerprintPublicKey.length);
        console.log('🔑 Key (last 100 chars):', '...' + fingerprintPublicKey.substring(fingerprintPublicKey.length - 100));
        console.log('💡 This is the EXACT key that was sent to backend during registration');
        console.log('🔍 FULL KEY for debugging (first 200 + last 200):');
        console.log('   Start:', fingerprintPublicKey.substring(0, 200));
        console.log('   End:', fingerprintPublicKey.substring(Math.max(0, fingerprintPublicKey.length - 200)));
        console.log('   Complete length:', fingerprintPublicKey.length);
      } else {
        // Fallback: Try device secure storage
        console.log('⚠️ No key in AsyncStorage, trying device secure storage...');
        const existingKeyResult = await getExistingBiometricPublicKey();
        
        if (existingKeyResult.success && existingKeyResult.publicKey) {
          // CRITICAL: Normalize the key (trim whitespace) to prevent intermittent mismatches
          fingerprintPublicKey = existingKeyResult.publicKey.trim();
          
          // Log if normalization changed the key
          if (existingKeyResult.publicKey !== fingerprintPublicKey) {
            console.warn('⚠️ WARNING: Fingerprint key from device had whitespace! Normalized.');
            console.warn('   Original length:', existingKeyResult.publicKey.length);
            console.warn('   Normalized length:', fingerprintPublicKey.length);
          }
          
          console.log('✅ Got fingerprint key from device secure storage (fallback)');
          console.log('🔑 Key (first 50 chars):', fingerprintPublicKey.substring(0, 50) + '...');
          console.log('⚠️ WARNING: This key might not match database if keys were regenerated!');
          
          // Save normalized key to AsyncStorage for next time
          await AsyncStorage.setItem('fingerprintPublicKey', fingerprintPublicKey);
          console.log('✅ Saved normalized key to AsyncStorage for next time');
        } else {
          // No key found anywhere - this is a problem
          console.error('❌ CRITICAL: No fingerprint key found in AsyncStorage OR device storage!');
          console.error('❌ This means the key was either:');
          console.error('   1. Never saved during registration');
          console.error('   2. Cleared from both storage locations');
          console.error('   3. User is on a different device');
          console.error('💡 SOLUTION: User must re-register.');
          
          setLoading(false);
          Alert.alert(
            t('biometricSetup.error'),
            t('biometricSetup.fingerprintKeyMissing') || 'لم يتم العثور على مفتاح البصمة. يرجى إعادة التسجيل.',
            [
              {
                text: t('register.ok'),
                onPress: () => {
                  onClose();
                },
              },
            ]
          );
          return;
        }
      }

      if (!fingerprintPublicKey) {
        setLoading(false);
        Alert.alert(t('biometricSetup.error'), t('biometricSetup.biometricDataNotFound'), [
          {
            text: t('register.ok'),
            onPress: () => {
              onClose();
            },
          },
        ]);
        return;
      }

      // Step 3: Login with fingerprint - verify fingerprint ID against database
      // NOTE: fingerprintPublicKey is device-specific, so if multiple users registered on same device,
      // we need to also send faceId to identify the correct user
      // Get stored faceId from AsyncStorage (from registration) to help identify user
      const storedFaceData = await AsyncStorage.getItem('faceData');
      let faceIdForLogin: string | undefined = undefined;
      
      if (storedFaceData) {
        try {
          const faceData = JSON.parse(storedFaceData);
          faceIdForLogin = faceData.faceId;
          console.log('🔍 Found stored faceId for user identification:', faceIdForLogin);
        } catch (e) {
          console.log('⚠️ Could not parse stored face data');
        }
      }
      
      // Send fingerprintPublicKey + faceId (if available) to backend
      // Backend will use faceId to identify correct user if multiple users on same device
      // IMPORTANT: Always include faceId if available - it helps backend find the correct user
      const loginData: {
        fingerprintPublicKey: string;
        faceId?: string; // Optional: helps identify user if multiple users on same device
      } = {
        fingerprintPublicKey: fingerprintPublicKey,
      };
      
      if (faceIdForLogin) {
        loginData.faceId = faceIdForLogin;
        console.log('✅ Including faceId in login request for user identification');
        console.log('🔍 faceId value:', faceIdForLogin);
      } else {
        console.warn('⚠️ WARNING: No faceId found in storedFaceData!');
        console.warn('⚠️ Backend might have trouble identifying the user without faceId');
        
        // Try to get faceId from faceData if it exists
        const faceDataString = await AsyncStorage.getItem('faceData');
        if (faceDataString) {
          try {
            const faceData = JSON.parse(faceDataString);
            if (faceData.faceId) {
              loginData.faceId = faceData.faceId;
              console.log('✅ Found faceId in faceData, including it:', faceData.faceId);
            } else {
              console.warn('⚠️ faceData exists but has no faceId property');
            }
          } catch (e) {
            console.log('⚠️ Could not parse faceData:', e);
          }
        } else {
          console.warn('⚠️ No faceData found in AsyncStorage at all!');
        }
      }
      
      console.log('🔐 Sending fingerprint login request');
      console.log('🔐 fingerprintPublicKey length:', fingerprintPublicKey.length);
      console.log('🔐 fingerprintPublicKey FULL (first 200 chars):', fingerprintPublicKey.substring(0, 200));
      console.log('🔐 fingerprintPublicKey FULL (last 200 chars):', '...' + fingerprintPublicKey.substring(Math.max(0, fingerprintPublicKey.length - 200)));
      console.log('🔐 faceId included:', !!loginData.faceId, loginData.faceId || 'NONE');
      console.log('🔍 COMPLETE loginData being sent:', JSON.stringify({
        fingerprintLength: loginData.fingerprintPublicKey.length,
        fingerprintStart: loginData.fingerprintPublicKey.substring(0, 100),
        fingerprintEnd: '...' + loginData.fingerprintPublicKey.substring(loginData.fingerprintPublicKey.length - 100),
        hasFaceId: !!loginData.faceId,
        faceId: loginData.faceId || 'null',
      }));
      
      console.log('📤 Calling loginWithBiometric...');
      const loginResponse = await authAPI.loginWithBiometric(loginData);
      console.log('📥 loginWithBiometric returned:', loginResponse ? 'success' : 'null/undefined');
      console.log('📥 loginResponse type:', typeof loginResponse);
      console.log('📥 loginResponse keys:', loginResponse ? Object.keys(loginResponse) : 'null');
      console.log('📥 loginResponse.user:', loginResponse?.user ? 'exists' : 'null');
      console.log('📥 loginResponse.token:', loginResponse?.token ? 'exists' : 'null');

      // Backend has already verified the fingerprint matches the user
      // No need for additional client-side check since we're using the stored key (matches database)
      if (loginResponse && loginResponse.user) {
        console.log('✅ BiometricSetupModal: Login successful - backend verified fingerprint');
        console.log('✅ Login response user:', loginResponse.user.email || loginResponse.user.employeeNumber);
        
        // Save credentials for future use (optional)
        if (loginResponse.user.email) {
          await AsyncStorage.setItem('biometricEmail', loginResponse.user.email);
        }
        if (loginResponse.user.employeeNumber) {
          await AsyncStorage.setItem('biometricEmployeeNumber', loginResponse.user.employeeNumber);
        }
        
        // Get fresh user data from database using checkAuth (which calls getMe())
        // This ensures we get the latest user data from database, not AsyncStorage
        try {
          if (checkAuth) {
            console.log('🔄 Calling checkAuth to get fresh user data...');
            await checkAuth(); // This will call getMe() and update user state with fresh data
            console.log('✅ checkAuth completed successfully');
          }
        } catch (checkAuthError: any) {
          console.error('❌ checkAuth failed:', checkAuthError);
          console.error('❌ Error message:', checkAuthError.message);
          // Don't fail login if checkAuth fails - user is already logged in
          // Just log the error and continue
          console.warn('⚠️ Continuing with login despite checkAuth error');
        }
        
        // Call onSetupComplete to close modal and navigate to home
        onSetupComplete();
      } else {
        setLoading(false);
        console.error('❌ Login response missing user or token');
        console.error('❌ loginResponse:', loginResponse);
        Alert.alert(t('biometricSetup.error'), t('biometricSetup.identityVerificationFailed'), [
          {
            text: t('register.ok'),
            onPress: () => {
              onClose();
            },
          },
        ]);
      }
    } catch (error: any) {
      setLoading(false);
      const errorMessage = error.response?.data?.message || error.message || 'فشل تسجيل الدخول';
      console.error('Fingerprint login error:', errorMessage);
      console.error('Error response:', error.response?.data);
      
      // If backend requires faceImage, show specific message
      if (errorMessage.includes('صوره الوجه') || errorMessage.includes('صورة الوجه') || errorMessage.includes('faceImage')) {
        Alert.alert(
          'خطأ في الـ Backend',
          'الـ Backend يتطلب صورة الوجه حتى عند استخدام البصمة. يجب تعديل الـ Backend ليقبل البصمة فقط بدون صورة وجه.',
          [
            {
              text: 'موافق',
              onPress: () => {
                onClose();
              },
            },
          ]
        );
      } else {
        // Check if it's a fingerprint mismatch error
        if (errorMessage.includes('البصمة غير مسجلة') || errorMessage.includes('البصمة غير صحيحة') || 
            errorMessage.includes('fingerprint') || errorMessage.includes('not registered')) {
          console.error('❌ Fingerprint key mismatch detected!');
          console.error('❌ The fingerprint key in AsyncStorage does not match the database.');
          console.error('❌ This usually means:');
          console.error('   1. Keys were regenerated on the device');
          console.error('   2. You are on a different device');
          console.error('   3. The key was not saved correctly during registration');
          console.error('💡 SOLUTION: You may need to re-register or use the original device.');
          
          Alert.alert(
            t('biometricSetup.error'),
            t('biometricSetup.fingerprintMismatch') || 'البصمة لا تطابق ما هو مسجل في قاعدة البيانات. قد تحتاج إلى إعادة التسجيل.',
            [
              {
                text: t('register.ok'),
                onPress: () => {
                  onClose();
                },
              },
            ]
          );
        } else {
          Alert.alert(t('biometricSetup.error'), errorMessage, [
            {
              text: t('register.ok'),
              onPress: () => {
                onClose();
              },
            },
          ]);
        }
      }
    } finally {
      // Ensure loading is always reset
      setLoading(false);
    }
  };


  if (!biometricChecked) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>جارٍ التحقق من إمكانيات الجهاز...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4F46E5" />
            <Text style={styles.loadingText}>جارٍ التحقق من الهوية...</Text>
          </View>
        ) : biometricAvailable ? null : (
          <View style={styles.notAvailableContainer}>
            <Icon name="alert-circle" size={32} color="#EF4444" />
            <Text style={styles.notAvailableText}>
              المصادقة الحيوية غير متاحة على هذا الجهاز
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: 'transparent',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  header: {
    alignItems: 'center',
    padding: 16,
    paddingTop: 20,
    backgroundColor: '#FFF',
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  content: {
    paddingVertical: 10,
    backgroundColor: 'transparent',
  },
  benefitsContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  benefitText: {
    fontSize: 13,
    color: '#1F2937',
    marginLeft: 12,
    flex: 1,
  },
  primaryButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#4F46E5',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
  retryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'transparent',
  },
  retryButtonText: {
    marginTop: 12,
    fontSize: 14,
    color: '#4F46E5',
    textAlign: 'center',
    fontWeight: '600',
  },
  notAvailableContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  notAvailableText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginTop: 12,
    marginBottom: 6,
    textAlign: 'center',
  },
  faceCaptureContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  sectionDescription: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 18,
  },
  faceImageContainer: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 16,
    marginBottom: 12,
    backgroundColor: '#F3F4F6',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  faceImage: {
    width: '100%',
    height: '100%',
  },
  faceDataContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    marginBottom: 12,
  },
  faceDataText: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  stepContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  stepNumberCompleted: {
    backgroundColor: '#10B981',
  },
  stepNumberText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4B5563',
  },
  stepTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
  },
  stepCompletedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
  },
  stepCompletedText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#10B981',
    marginLeft: 8,
  },
  stepDisabledContainer: {
    padding: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    alignItems: 'center',
  },
  stepDisabledText: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
  },
});

export default BiometricSetupModal;

