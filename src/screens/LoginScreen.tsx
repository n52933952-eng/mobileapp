import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useTranslation } from 'react-i18next';
import { getBiometricTypeName } from '../services/biometrics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import BiometricSetupModal from './BiometricSetupModal';

const LoginScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { login, loginWithBiometrics, loginWithFaceRecognition, biometricAvailable, biometricType, loading: authLoading } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const [emailOrEmployeeNumber, setEmailOrEmployeeNumber] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [systemBiometricEnabled, setSystemBiometricEnabled] = useState(false);
  const [faceRecognitionEnabled, setFaceRecognitionEnabled] = useState(false);
  const [showBiometricSetupModal, setShowBiometricSetupModal] = useState(false);
  const [capturingFace, setCapturingFace] = useState(false);

  useEffect(() => {
    // Check if biometric login was enabled
    checkBiometricEnabled();
    
    // Listen for navigation focus to handle face capture result
    const unsubscribe = navigation.addListener('focus', async () => {
      console.log('🔍 LoginScreen: Checking for face capture result...');
      try {
        const faceCaptureResult = await AsyncStorage.getItem('faceCaptureResult');
        if (faceCaptureResult) {
          console.log('✅ LoginScreen: Found faceCaptureResult');
          const result = JSON.parse(faceCaptureResult);
          const timeDiff = Date.now() - result.timestamp;
          console.log('⏰ LoginScreen: Time diff:', timeDiff, 'ms');
          
          // Check if result is recent (within last 5 seconds)
          // emailOrEmployeeNumber is optional - face login can work without it
          if (timeDiff < 5000) {
            console.log('✅ LoginScreen: Result is recent, proceeding with login...');
            setCapturingFace(true);
            try {
              // NEW APPROACH: ML Kit detected face (liveness check passed)
              // Now trigger biometric authentication (Face ID / Face Unlock)
              const faceDetected = result.faceDetected || result.faceId ? true : false;
              const currentFaceId = result.faceId; // Use faceId from CURRENT capture (not stored one)
              
              console.log('🔍 LoginScreen: faceDetected:', faceDetected);
              console.log('🔍 LoginScreen: currentFaceId:', currentFaceId);
              console.log('🔍 LoginScreen: faceEmbedding:', result.faceEmbedding ? `exists (${result.faceEmbedding.length}-D array)` : 'null');
              const capturedFaceData = result.faceData?.[0] || result.faceFeatures || null;
              
              if (!faceDetected) {
                Alert.alert(t('login.error'), t('login.faceNotDetected'));
                return;
              }

              // Login with face recognition: ML Kit detected face + Biometric auth
              // Pass the full result object (includes faceEmbedding, imageBase64, etc.)
              const emailOrEmpNum = emailOrEmployeeNumber.trim() || undefined;
              console.log('🚀 LoginScreen: Calling loginWithFaceRecognition...');
              await loginWithFaceRecognition(faceDetected, emailOrEmpNum, currentFaceId, result);
              console.log('✅ LoginScreen: loginWithFaceRecognition completed');
              
              // CRITICAL: Verify token exists after login before allowing navigation
              const postLoginToken = await AsyncStorage.getItem('token');
              console.log('🔍 LoginScreen: Post-login token check:', !!postLoginToken);
              if (!postLoginToken) {
                console.error('❌ LoginScreen: Token missing after login! This should not happen.');
                Alert.alert(t('login.error'), t('login.tokenSaveFailed'));
                return;
              }
              console.log('✅ LoginScreen: Token verified, navigation should proceed');
              // Navigation will be handled by AuthContext
            } catch (error: any) {
              console.error('❌ LoginScreen: Login error:', error);
              Alert.alert(t('login.verificationFailed'), error.message || t('login.loginWithFace'));
            } finally {
              setCapturingFace(false);
              // Clear the temporary result
              await AsyncStorage.removeItem('faceCaptureResult');
              console.log('🧹 LoginScreen: Cleared faceCaptureResult');
            }
          } else {
            console.log('⏰ LoginScreen: Result too old, ignoring');
            await AsyncStorage.removeItem('faceCaptureResult');
          }
        } else {
          console.log('❌ LoginScreen: No faceCaptureResult found');
        }
      } catch (error) {
        console.error('❌ LoginScreen: Error checking face capture result:', error);
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [navigation, emailOrEmployeeNumber, loginWithFaceRecognition]);

  const checkBiometricEnabled = async () => {
    try {
      const biometricEnabled = await AsyncStorage.getItem('biometricEnabled');
      
      // Check if user has stored credentials (email/employee number) - means they can use face recognition
      const storedEmail = await AsyncStorage.getItem('biometricEmail');
      const storedEmployeeNumber = await AsyncStorage.getItem('biometricEmployeeNumber');
      const hasStoredCredentials = !!(storedEmail || storedEmployeeNumber);
      
      let faceData = null;
      try {
        faceData = await AsyncStorage.getItem('faceData');
        // If faceData is too large (contains base64), clean it up
        if (faceData && faceData.length > 50000) {
          await AsyncStorage.removeItem('faceData');
          faceData = null;
        }
      } catch (error: any) {
        // If reading faceData fails (likely too large), remove it
        if (error.message?.includes('too big') || error.message?.includes('CursorWindow')) {
          await AsyncStorage.removeItem('faceData');
          faceData = null;
        }
      }
      
      // System biometric (fingerprint/face ID) enabled if user enabled it AND device supports it
      setSystemBiometricEnabled(biometricEnabled === 'true' && biometricAvailable);
      
      // Face recognition enabled ALWAYS:
      // Face login works by capturing face and matching with database,
      // so it doesn't require local storage - always show the button
      // User can login with face even if they don't have local data (database lookup)
      setFaceRecognitionEnabled(true);
    } catch (error) {
      console.log('Error checking biometric:', error);
      setSystemBiometricEnabled(false);
      setFaceRecognitionEnabled(true); // Still enable face recognition even on error
    }
  };

  const handleLogin = async () => {
    if (!emailOrEmployeeNumber.trim() || !password.trim()) {
      Alert.alert(t('login.error'), t('login.fillFields'));
      return;
    }

    setLoading(true);
    try {
      await login(emailOrEmployeeNumber, password);
      // Navigation will be handled by AuthContext
    } catch (error: any) {
      // Reset loading state immediately so screen is active again
      setLoading(false);
      
      // Check for approval status errors
      if (error.message?.includes('PENDING_APPROVAL:')) {
        const message = error.message.replace('PENDING_APPROVAL: ', '');
        Alert.alert(
          t('login.pendingApproval'),
          message,
          [
            {
              text: t('login.ok'),
              onPress: () => {
                // User can stay on login screen but won't be able to login
                // They need to wait for admin approval
              }
            }
          ]
        );
      } else if (error.message?.includes('REJECTED:')) {
        const message = error.message.replace('REJECTED: ', '');
        Alert.alert(
          t('login.requestRejected'),
          message,
          [
            {
              text: t('login.ok'),
              onPress: () => {
                // User cannot login - they were rejected
                // They can logout but won't be able to login again
              }
            }
          ]
        );
      } else {
        Alert.alert(t('login.loginError'), error.message || t('login.loginFailed'));
      }
    } finally {
      // Ensure loading is always reset
      setLoading(false);
    }
  };

  // Handle System Biometric Login (Face ID / Fingerprint)
  const handleSystemBiometricLogin = async () => {
    if (!biometricAvailable) {
      Alert.alert(t('login.notAvailable'), t('login.biometricNotAvailable'));
      return;
    }

    setLoading(true);
    try {
      await loginWithBiometrics();
      // Navigation will be handled by AuthContext
    } catch (error: any) {
      // Reset loading state immediately so screen is active again
      setLoading(false);
      Alert.alert(t('login.verificationFailed'), error.message || t('login.verificationError'));
    } finally {
      // Ensure loading is always reset
      setLoading(false);
    }
  };

  // Handle Face Recognition Login (Camera-based) - Navigate to FaceCaptureScreen
  const handleFaceRecognitionLogin = async () => {
    // Try to get stored email/employee number first (from previous login or registration)
    // But it's optional - face login can work without it
    let storedEmail = await AsyncStorage.getItem('biometricEmail');
    let storedEmployeeNumber = await AsyncStorage.getItem('biometricEmployeeNumber');
    
    // Use stored credentials if available, otherwise use entered value, or empty (face-only)
    const emailOrEmpNum = storedEmail || storedEmployeeNumber || emailOrEmployeeNumber.trim() || undefined;
    
    // Clear any previous result
    await AsyncStorage.removeItem('faceCaptureResult');
    // Navigate to FaceCaptureScreen - result will be handled by navigation listener
    // emailOrEmployeeNumber is optional - face login can work without it
    navigation.navigate('FaceCapture', {
      emailOrEmployeeNumber: emailOrEmpNum,
      autoSubmit: true,
      origin: 'login',
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Language Switcher - Single Toggle Button */}
        <View style={styles.languageSwitcher}>
          <TouchableOpacity
            style={styles.langButton}
            onPress={() => setLanguage(language === 'en' ? 'ar' : 'en')}
          >
            <Text style={styles.langButtonText}>
              {language === 'en' ? 'AR' : 'EN'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.header}>
          <Icon name="briefcase-check" size={80} color="#4F46E5" />
          <Text style={styles.title}>Work Spot</Text>
          <Text style={styles.subtitle}>{t('login.title')}</Text>
        </View>

        <View style={styles.form}>
          {/* Email/Employee Number Input */}
          <View style={styles.inputContainer}>
            <Icon name="account-outline" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('login.emailOrEmployeeNumber')}
              placeholderTextColor="#999"
              value={emailOrEmployeeNumber}
              onChangeText={setEmailOrEmployeeNumber}
              autoCapitalize="none"
              keyboardType="email-address"
              textAlign="right"
              editable={!loading && !authLoading}
            />
          </View>

          {/* Password Input */}
          <View style={styles.inputContainer}>
            <Icon name="lock-outline" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('login.password')}
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              textAlign="right"
              editable={!loading && !authLoading}
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeIcon}
            >
              <Icon
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={24}
                color="#666"
              />
            </TouchableOpacity>
          </View>

          {/* Login Button (Email/Password) */}
          <TouchableOpacity
            style={[styles.loginButton, loading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={loading || authLoading}
          >
            {loading || authLoading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Icon name="login" size={24} color="#FFF" style={styles.buttonIcon} />
                <Text style={styles.loginButtonText}>{t('login.loginButton')}</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Show biometric options */}
          {(systemBiometricEnabled || faceRecognitionEnabled || biometricAvailable) ? (
            <>
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>{t('login.or')}</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* System Biometric (Face ID / Fingerprint) */}
              {biometricAvailable && (
                <>
                  {systemBiometricEnabled ? (
                    <TouchableOpacity
                      style={styles.biometricButton}
                      onPress={handleSystemBiometricLogin}
                      disabled={loading || authLoading}
                    >
                      <Icon
                        name={
                          biometricType === 'FaceID'
                            ? 'face-recognition'
                            : biometricType === 'TouchID'
                            ? 'fingerprint'
                            : 'fingerprint'
                        }
                        size={32}
                        color="#4F46E5"
                      />
                      <Text style={styles.biometricButtonText}>
                        {t('login.loginWith')} {getBiometricTypeName(biometricType, t)}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={styles.setupBiometricButton}
                      activeOpacity={0.7}
                      onPress={() => {
                        // ONLY show modal - ABSOLUTELY NO NAVIGATION
                        console.log('Opening biometric setup modal - NO NAVIGATION');
                        setShowBiometricSetupModal(true);
                      }}
                    >
                      <Icon
                        name={
                          biometricType === 'FaceID'
                            ? 'face-recognition'
                            : 'fingerprint'
                        }
                        size={24}
                        color="#4F46E5"
                      />
                      <Text style={styles.setupBiometricButtonText}>
                        {t('login.enable')} {getBiometricTypeName(biometricType, t)} ({t('login.optional')})
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Divider between biometric options */}
              {((systemBiometricEnabled || biometricAvailable) && faceRecognitionEnabled) && (
                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>{t('login.or')}</Text>
                  <View style={styles.dividerLine} />
                </View>
              )}

              {/* Face Recognition (Camera-based) */}
              {faceRecognitionEnabled && (
                <TouchableOpacity
                  style={[styles.biometricButton, (systemBiometricEnabled || biometricAvailable) && styles.biometricButtonSecondary]}
                  onPress={handleFaceRecognitionLogin}
                  disabled={loading || authLoading}
                >
                  <Icon
                    name="camera"
                    size={32}
                    color="#4F46E5"
                  />
                  <Text style={styles.biometricButtonText}>
                    {t('login.loginWithFace')}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            // Show setup biometric option if not available
            <TouchableOpacity
              style={styles.setupBiometricButton}
              activeOpacity={0.7}
              onPress={() => {
                // ONLY show modal - ABSOLUTELY NO NAVIGATION
                console.log('Opening biometric setup modal - NO NAVIGATION');
                setShowBiometricSetupModal(true);
              }}
            >
              <Icon name="fingerprint" size={24} color="#4F46E5" />
              <Text style={styles.setupBiometricButtonText}>
                {t('login.setupBiometric')} ({t('login.optional')})
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('login.noAccount')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.registerLink}>{t('login.createAccount')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>


      {/* Biometric Login Modal - Small height, NO NAVIGATION */}
      <Modal
        visible={showBiometricSetupModal}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          // Close modal, DO NOT navigate
          setShowBiometricSetupModal(false);
        }}
      >
        <View style={styles.modalContainer}>
          <BiometricSetupModal 
            onSetupComplete={async () => {
              // User successfully logged in with fingerprint
              // Navigation to Home will happen automatically via AppNavigator (when user state is set)
              setShowBiometricSetupModal(false);
              await checkBiometricEnabled(); // Refresh biometric status
            }}
            onClose={() => setShowBiometricSetupModal(false)}
          />
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingVertical: 12, // less vertical padding so content is higher
  },
  header: {
    alignItems: 'center',
    // Reduce space under title to fit everything without scroll
    marginBottom: 12,
  },
  title: {
    // Make "Work Spot" smaller for small screens
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 20,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: '#6B7280',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    height: 56,
  },
  inputIcon: {
    marginLeft: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#1F2937',
    paddingVertical: 0,
  },
  eyeIcon: {
    padding: 4,
  },
  loginButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    // Make main login button a bit smaller in height
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    shadowColor: '#4F46E5',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  buttonIcon: {
    marginLeft: 8,
  },
  loginButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    // Reduce vertical spacing around divider
    marginVertical: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#6B7280',
    fontSize: 14,
  },
  biometricButton: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    // Make biometric boxes more compact
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4F46E5',
    marginBottom: 10,
  },
  biometricButtonText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    // Reduce space above "ليس لديك حساب" so it's not too low
    marginTop: 16,
  },
  footerText: {
    color: '#6B7280',
    fontSize: 14,
    marginLeft: 8,
  },
  registerLink: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
  },
  biometricButtonSecondary: {
    // Reduce space above second biometric button
    marginTop: 8,
    borderColor: '#10B981',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContentWrapper: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    width: '90%',
    maxHeight: '70%',
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  closeButton: {
    padding: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    flex: 1,
    textAlign: 'center',
    marginRight: 32,
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  infoText: {
    flex: 1,
    marginLeft: 12,
    fontSize: 14,
    color: '#1F2937',
    textAlign: 'right',
  },
  processingContainer: {
    alignItems: 'center',
    padding: 32,
    marginTop: 20,
  },
  processingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  setupBiometricButton: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  setupBiometricButtonText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  languageSwitcher: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginBottom: 4,
    marginTop: 4,
    paddingHorizontal: 0,
    height: 32,
  },
  langButton: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 16,
    backgroundColor: '#4F46E5',
    borderWidth: 1,
    borderColor: '#4F46E5',
    minWidth: 40,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default LoginScreen;




