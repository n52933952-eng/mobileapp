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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchCamera, launchImageLibrary, ImagePickerResponse, MediaType } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentLocation, LocationData, requestLocationPermission, getAddressFromCoordinates } from '../services/location';

const RegisterScreen: React.FC = () => {
  const navigation = useNavigation();
  const { register } = useAuth();
  const { t } = useTranslation();
  const [formData, setFormData] = useState({
    employeeNumber: '',
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [profileImageBase64, setProfileImageBase64] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LocationData | null>(null);
  const [locationAddress, setLocationAddress] = useState<{ streetName: string; fullAddress: string } | null>(null);
  const [loadingAddress, setLoadingAddress] = useState(false);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);

  useEffect(() => {
    // CRITICAL: DO NOT clear biometric data on mount!
    // This was causing issues where:
    // 1. User registers successfully → key saved to AsyncStorage
    // 2. User tries to register again → key gets cleared here
    // 3. Registration is blocked (duplicate) → key is already gone
    // 4. User tries to login → no key in AsyncStorage → gets NEW key from device → doesn't match database
    // 
    // Instead, biometric data will be:
    // - Cleared when user explicitly starts biometric setup (in BiometricSetupScreen)
    // - Overwritten when registration succeeds (new data saved)
    // - Preserved if registration fails (so user can still login)
    
    // Only clear registrationData and faceCaptureResult (temporary data)
    // Keep fingerprintPublicKey and faceData (needed for login)
    const clearTemporaryData = async () => {
      try {
        // Check if there's an existing key - if so, preserve it
        const existingKey = await AsyncStorage.getItem('fingerprintPublicKey');
        if (existingKey) {
          console.log('🔑 Existing fingerprint key found - preserving it for login');
          console.log('   Key (first 50 chars):', existingKey.substring(0, 50) + '...');
        }
        
        console.log('🧹 Clearing temporary registration data from AsyncStorage...');
        await AsyncStorage.multiRemove([
          'faceCaptureResult', // Temporary face capture result
          'registrationData', // Temporary registration form data
          // NOTE: We do NOT clear fingerprintPublicKey or faceData here
          // These are needed for login even if registration fails
        ]);
        console.log('✅ Temporary data cleared (fingerprintPublicKey and faceData preserved)');
        
        // Verify key is still there after clearing
        const keyAfterClear = await AsyncStorage.getItem('fingerprintPublicKey');
        if (existingKey && !keyAfterClear) {
          console.error('❌ CRITICAL: Key was lost during temporary data clear! Restoring...');
          await AsyncStorage.setItem('fingerprintPublicKey', existingKey);
          console.log('✅ Key restored');
        } else if (keyAfterClear) {
          console.log('✅ Key verified: Still in AsyncStorage after clearing temporary data');
        }
      } catch (error) {
        console.warn('⚠️ Error clearing temporary data:', error);
      }
    };
    
    clearTemporaryData();
    requestLocationPermissions();
  }, []);

  useEffect(() => {
    if (locationPermissionGranted) {
      getCurrentUserLocation();
    }
  }, [locationPermissionGranted]);

  const requestLocationPermissions = async () => {
    try {
      // Show explanation alert first
      Alert.alert(
        t('register.locationPermissionRequired'),
        t('register.locationPermissionMessage'),
        [
          {
            text: t('register.cancel'),
            style: 'cancel',
            onPress: () => {
              setLocationPermissionGranted(false);
            },
          },
          {
            text: t('register.ok'),
            onPress: async () => {
              const granted = await requestLocationPermission();
              setLocationPermissionGranted(granted);
              if (!granted) {
                Alert.alert(
                  t('register.permissionDenied'),
                  t('register.permissionDeniedMessage'),
                  [{ text: t('register.ok') }]
                );
              }
            },
          },
        ],
        { cancelable: false }
      );
    } catch (error) {
      console.error('Error requesting location permission:', error);
      setLocationPermissionGranted(false);
    }
  };

  const getCurrentUserLocation = async () => {
    if (!locationPermissionGranted) {
      return; // Don't try to get location if permission not granted
    }
    try {
      setLoadingAddress(true);
      const location = await getCurrentLocation();
      setUserLocation(location);
      
      // Get full address from coordinates
      if (location.latitude && location.longitude) {
        const address = await getAddressFromCoordinates(location.latitude, location.longitude);
        if (address) {
          setLocationAddress(address);
          // Update location with address
          setUserLocation({
            ...location,
            streetName: address.streetName,
            fullAddress: address.fullAddress,
          });
        }
      }
    } catch (error) {
      console.error('Error getting location:', error);
      // Location permission might have been denied, update state
      setLocationPermissionGranted(false);
    } finally {
      setLoadingAddress(false);
    }
  };

  const handlePickProfileImage = () => {
    Alert.alert(
      t('register.chooseImage'),
      t('register.chooseImageSource'),
      [
        { text: t('register.cancel'), style: 'cancel' },
        { text: t('register.camera'), onPress: handleCamera },
        { text: t('register.gallery'), onPress: handleGallery },
      ]
    );
  };

  const handleCamera = () => {
    const options = {
      mediaType: 'photo' as MediaType,
      quality: 0.8,
      saveToPhotos: false,
    };

    launchCamera(options, (response: ImagePickerResponse) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert(t('register.error'), t('register.cameraFailed'));
        return;
      }
      if (response.assets && response.assets[0] && response.assets[0].uri) {
        processImage(response.assets[0].uri);
      }
    });
  };

  const handleGallery = () => {
    const options = {
      mediaType: 'photo' as MediaType,
      quality: 0.5, // Reduced from 0.8 to 0.5 for faster upload
      maxWidth: 800, // Limit width to 800px
      maxHeight: 800, // Limit height to 800px
    };

    launchImageLibrary(options, (response: ImagePickerResponse) => {
      if (response.didCancel) return;
      if (response.errorMessage) {
        Alert.alert(t('register.error'), t('register.galleryFailed'));
        return;
      }
      if (response.assets && response.assets[0] && response.assets[0].uri) {
        processImage(response.assets[0].uri);
      }
    });
  };

  const processImage = async (uri: string) => {
    try {
      setProfileImage(uri);
      // Convert to base64
      const fileUri = Platform.OS === 'android' && uri.startsWith('file://') 
        ? uri.replace('file://', '') 
        : uri;
      const base64 = await RNFS.readFile(fileUri, 'base64');
      const compressedBase64 = `data:image/jpeg;base64,${base64}`;
      setProfileImageBase64(compressedBase64);
      
      console.log('📦 Profile image size:', (compressedBase64.length / 1024).toFixed(2), 'KB');
    } catch (error: any) {
      Alert.alert(t('register.error'), t('register.imageProcessingFailed'));
      console.error('Image processing error:', error);
    }
  };


  const handleRegister = async () => {
    // Validation
    if (!formData.employeeNumber.trim()) {
      Alert.alert(t('register.error'), t('register.enterEmployeeNumber'));
      return;
    }
    if (!formData.fullName.trim()) {
      Alert.alert(t('register.error'), t('register.enterFullName'));
      return;
    }
    if (!formData.email.trim() || !formData.email.includes('@')) {
      Alert.alert(t('register.error'), t('register.enterValidEmail'));
      return;
    }
    if (!formData.password.trim() || formData.password.length < 6) {
      Alert.alert(t('register.error'), t('register.passwordMinLength'));
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      Alert.alert(t('register.error'), t('register.passwordsDoNotMatch'));
      return;
    }

    setLoading(true);
    try {
      // Prepare registration data to pass as params (don't save to AsyncStorage)
      // We'll send it together with biometric data in BiometricSetupScreen
      const registrationData = {
        employeeNumber: formData.employeeNumber,
        email: formData.email,
        password: formData.password,
        fullName: formData.fullName,
        // Keep both URI and base64 so BiometricSetupScreen can choose the safest way
        profileImageUri: profileImage || null,
        profileImageBase64: profileImageBase64 || null,
        branch: null, // No longer selecting from list
        latitude: userLocation?.latitude || null,
        longitude: userLocation?.longitude || null,
        address: userLocation?.fullAddress || null,
        streetName: userLocation?.streetName || null,
      };
      
      // Navigate to REQUIRED biometric setup screen with user data as params
      // User MUST complete this before accessing the app
      (navigation as any).navigate('BiometricSetup', {
        registrationData: registrationData,
      });
    } catch (error: any) {
      Alert.alert(t('register.accountCreationError'), error.message || t('register.accountCreationFailed'));
    } finally {
      setLoading(false);
    }
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
        <View style={styles.header}>
          {/* Profile Image in Header */}
          <TouchableOpacity 
            style={[
              styles.headerImageContainer,
              profileImage ? styles.headerImageContainerSolid : styles.headerImageContainerDashed
            ]}
            onPress={handlePickProfileImage}
          >
            {profileImage ? (
              <Image source={{ uri: profileImage }} style={styles.headerProfileImage} />
            ) : (
              <View style={styles.headerImagePlaceholder}>
                <Icon name="camera-plus" size={28} color="#4F46E5" />
              </View>
            )}
            {profileImage && (
              <View style={styles.headerImageOverlay}>
                <Icon name="camera" size={20} color="#FFF" />
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.title}>{t('register.createAccount')}</Text>
          {profileImage && (
            <TouchableOpacity
              style={styles.removeImageHeaderButton}
              onPress={() => {
                setProfileImage(null);
                setProfileImageBase64(null);
              }}
            >
              <Icon name="close-circle" size={24} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Icon name="badge-account" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('register.employeeNumberPlaceholder')}
              placeholderTextColor="#999"
              value={formData.employeeNumber}
              onChangeText={(text) => setFormData({ ...formData, employeeNumber: text })}
              textAlign="right"
            />
          </View>

          <View style={styles.inputContainer}>
            <Icon name="account" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('register.fullNamePlaceholder')}
              placeholderTextColor="#999"
              value={formData.fullName}
              onChangeText={(text) => setFormData({ ...formData, fullName: text })}
              textAlign="right"
            />
          </View>

          {/* Current Location Display */}
          <View style={styles.locationContainer}>
            <View style={styles.locationHeader}>
              <Text style={styles.sectionLabel}>{t('register.currentLocation')}</Text>
              {locationPermissionGranted ? (
                <View style={styles.permissionBadge}>
                  <Icon name="check-circle" size={16} color="#10B981" />
                  <Text style={styles.permissionBadgeText}>{t('register.enabled')}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.requestPermissionButton}
                  onPress={requestLocationPermissions}
                >
                  <Icon name="map-marker-alert" size={16} color="#F59E0B" />
                  <Text style={styles.requestPermissionText}>{t('register.enableLocation')}</Text>
                </TouchableOpacity>
              )}
            </View>
            
            {loadingAddress ? (
              <View style={styles.locationLoadingContainer}>
                <ActivityIndicator size="small" color="#4F46E5" />
                <Text style={styles.locationLoadingText}>{t('register.detectingLocation')}</Text>
              </View>
            ) : userLocation && locationPermissionGranted ? (
              <View style={styles.currentLocationCard}>
                <View style={styles.locationIconContainer}>
                  <Icon name="map-marker" size={32} color="#4F46E5" />
                </View>
                <View style={styles.locationDetails}>
                  {userLocation.streetName && (
                    <Text style={styles.streetName}>{userLocation.streetName}</Text>
                  )}
                  {userLocation.fullAddress && (
                    <Text style={styles.fullAddress}>{userLocation.fullAddress}</Text>
                  )}
                  <Text style={styles.coordinates}>
                    {userLocation.latitude.toFixed(6)}, {userLocation.longitude.toFixed(6)}
                  </Text>
                </View>
              </View>
            ) : !locationPermissionGranted ? (
              <View style={styles.noLocationContainer}>
                <Icon name="map-marker-off" size={48} color="#9CA3AF" />
                <Text style={styles.noLocationText}>
                  {t('register.noLocation')}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.inputContainer}>
            <Icon name="email-outline" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('register.emailPlaceholder')}
              placeholderTextColor="#999"
              value={formData.email}
              onChangeText={(text) => setFormData({ ...formData, email: text })}
              autoCapitalize="none"
              keyboardType="email-address"
              textAlign="right"
            />
          </View>

          <View style={styles.inputContainer}>
            <Icon name="lock-outline" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('register.passwordPlaceholder')}
              placeholderTextColor="#999"
              value={formData.password}
              onChangeText={(text) => setFormData({ ...formData, password: text })}
              secureTextEntry={!showPassword}
              textAlign="right"
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

          <View style={styles.inputContainer}>
            <Icon name="lock-check-outline" size={24} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('register.confirmPasswordPlaceholder')}
              placeholderTextColor="#999"
              value={formData.confirmPassword}
              onChangeText={(text) => setFormData({ ...formData, confirmPassword: text })}
              secureTextEntry={!showConfirmPassword}
              textAlign="right"
            />
            <TouchableOpacity
              onPress={() => setShowConfirmPassword(!showConfirmPassword)}
              style={styles.eyeIcon}
            >
              <Icon
                name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                size={24}
                color="#666"
              />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.registerButton, loading && styles.registerButtonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Icon name="account" size={24} color="#FFF" style={styles.buttonIcon} />
                <Text style={styles.registerButtonText}>{t('register.registerButton')}</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>{t('login.noAccount')}</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.loginLink}>{t('login.loginButton')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
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
    padding: 16,
    paddingTop: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 20,
    position: 'relative',
  },
  headerImageContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EEF2FF',
    borderWidth: 2,
    borderColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  headerImageContainerDashed: {
    borderStyle: 'dashed',
  },
  headerImageContainerSolid: {
    borderStyle: 'solid',
  },
  headerProfileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  headerImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerImageOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    paddingVertical: 6,
    alignItems: 'center',
  },
  removeImageHeaderButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 12,
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    height: 48,
  },
  inputIcon: {
    marginLeft: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#1F2937',
    paddingVertical: 0,
  },
  eyeIcon: {
    padding: 4,
  },
  registerButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    // Make main register button a bit smaller in height
    paddingVertical: 10,
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
  registerButtonDisabled: {
    opacity: 0.6,
  },
  buttonIcon: {
    marginLeft: 8,
  },
  registerButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    // Reduce space above "لديك حساب؟ تسجيل الدخول" so it comes up a bit
    marginTop: 16,
  },
  footerText: {
    color: '#6B7280',
    fontSize: 14,
    marginLeft: 8,
  },
  loginLink: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 6,
  },
  imagePickerContainer: {
    marginBottom: 16,
  },
  addImageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: '#4F46E5',
    borderStyle: 'dashed',
  },
  addImageButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4F46E5',
    marginLeft: 8,
  },
  imagePreviewContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  profileImagePreview: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 12,
  },
  imageActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  changeImageButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  changeImageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
    marginLeft: 6,
  },
  removeImageButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  removeImageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
    marginLeft: 6,
  },
  locationContainer: {
    marginBottom: 12,
  },
  locationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  permissionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  permissionBadgeText: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600',
    marginLeft: 4,
  },
  requestPermissionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  requestPermissionText: {
    fontSize: 12,
    color: '#F59E0B',
    fontWeight: '600',
    marginLeft: 4,
  },
  locationLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  locationLoadingText: {
    marginLeft: 12,
    fontSize: 14,
    color: '#6B7280',
  },
  currentLocationCard: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  locationIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  locationDetails: {
    flex: 1,
  },
  streetName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 3,
  },
  fullAddress: {
    fontSize: 12,
    color: '#4B5563',
    marginBottom: 6,
    lineHeight: 16,
  },
  coordinates: {
    fontSize: 11,
    color: '#9CA3AF',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  noLocationContainer: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
  },
  noLocationText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
});

export default RegisterScreen;

