import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { getCurrentLocation } from '../services/location';
import { attendanceAPI, authAPI } from '../services/api';
import { validateFaceQuality } from '../utils/faceRecognition';
import { generateFaceEmbedding } from '../services/faceEmbedding';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface FaceCheckInModalProps {
  type: 'checkin' | 'checkout';
  onSuccess: (checkInTime?: string, checkOutTime?: string) => Promise<void> | void;
  onClose: () => void;
}

const FaceCheckInModal: React.FC<FaceCheckInModalProps> = ({ type, onSuccess, onClose }) => {
  const navigation = useNavigation();
  const { user, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [capturing, setCapturing] = useState(true);
  const [statusMessage, setStatusMessage] = useState(t('faceCheckIn.lookAtCamera'));

  useEffect(() => {
    // Navigate to FaceCaptureScreen for face detection when modal opens
    // OPTIMIZATION: Navigate immediately - don't wait for anything
    if (capturing) {
      // Clear old result in background (don't wait)
      AsyncStorage.removeItem('faceCaptureResult').catch(() => {});
      
      // Navigate immediately - camera should open instantly
      navigation.navigate('FaceCapture' as never, {
        autoSubmit: true,
        origin: 'attendance',
      } as never);
    }
    
    // Listen for face capture result
    const checkFaceResult = async () => {
      try {
        const faceCaptureResult = await AsyncStorage.getItem('faceCaptureResult');
        if (faceCaptureResult) {
          const result = JSON.parse(faceCaptureResult);
          const timeDiff = Date.now() - result.timestamp;
          
          // Check if result is recent (within last 10 seconds)
          if (timeDiff < 10000 && capturing) {
            await handleFaceCaptured(result);
          }
        }
      } catch (error) {
        console.error('Error checking face result:', error);
      }
    };

    // Check periodically while capturing
    if (capturing) {
      const interval = setInterval(checkFaceResult, 1000);
      return () => clearInterval(interval);
    }
  }, [navigation, capturing]);

  const handleFaceCaptured = async (result: any) => {
    try {
      setStatusMessage(t('faceCheckIn.verifyingIdentity'));
      setLoading(true);
      setCapturing(false);

      // OPTIMIZATION: Do all checks in parallel, not sequentially
      const startTime = Date.now();
      
      // Get faceId, landmarks, embedding, and image from result
      const faceId = result.faceId;
      if (!faceId) {
        Alert.alert(t('faceCheckIn.error'), t('faceCheckIn.faceIdNotFound'));
        onClose();
        return;
      }
      
      // OPTIMIZATION: Use embedding from result (should already be generated during capture)
      // Don't regenerate - it's slow!
      const faceEmbedding = result.faceEmbedding || null;
      if (!faceEmbedding) {
        console.warn('⚠️ No faceEmbedding in result - this should have been generated during capture');
      }
      
      const capturedFaceData = result.faceData?.[0] || null;
      const faceLandmarksPayload = capturedFaceData || result.faceFeatures || null;
      const faceImageBase64 = result.imageBase64 || null;

      // Check token with retry (might be saving after face login)
      let token = await AsyncStorage.getItem('token');
      
      // If token not found but user is authenticated, wait a bit (token might still be saving)
      if (!token && isAuthenticated && user) {
        console.log('⚠️ FaceCheckInModal: Token not found but user authenticated - waiting for token save...');
        // Wait up to 2 seconds for token to be saved (after face login)
        for (let i = 0; i < 10; i++) {
          await new Promise(resolve => setTimeout(resolve, 200));
          token = await AsyncStorage.getItem('token');
          if (token) {
            console.log(`✅ FaceCheckInModal: Token found after ${(i + 1) * 200}ms wait`);
            break;
          }
        }
      }
      
      const checkDuration = Date.now() - startTime;
      console.log(`⏱️ FaceCheckInModal: Checks completed in ${checkDuration}ms`);
      
      console.log('🔍 FaceCheckInModal: Checking authentication...');
      console.log('🔍 FaceCheckInModal: Token exists:', !!token);
      console.log('🔍 FaceCheckInModal: User state exists:', !!user);
      console.log('🔍 FaceCheckInModal: isAuthenticated:', isAuthenticated);
      
      // CRITICAL: Verify token exists - if not, try to recover
      if (!token) {
        console.error('❌ FaceCheckInModal: No token found');
        
        // If user is authenticated but no token, try to get fresh token
        if (isAuthenticated && user) {
          console.log('⚠️ FaceCheckInModal: User authenticated but no token - attempting recovery...');
          
          // Try to get user data from API (this might refresh the token)
          try {
            const userData = await authAPI.getMe();
            if (userData?.user) {
              // Check if token was saved after getMe
              const recoveredToken = await AsyncStorage.getItem('token');
              if (recoveredToken) {
                console.log('✅ FaceCheckInModal: Token recovered after getMe');
                token = recoveredToken;
              } else {
                throw new Error('Token still missing after recovery attempt');
              }
            } else {
              throw new Error('Could not get user data');
            }
          } catch (recoveryError: any) {
            console.error('❌ FaceCheckInModal: Token recovery failed:', recoveryError.message);
            Alert.alert(t('faceCheckIn.error'), t('faceCheckIn.sessionExpired'));
            onClose();
            return;
          }
        } else {
          Alert.alert(t('faceCheckIn.error'), t('faceCheckIn.pleaseLogin'));
          onClose();
          return;
        }
      }
      
      if (!user || !isAuthenticated) {
        console.warn('⚠️ FaceCheckInModal: User state missing - token exists but user state not set');
        // Token exists but user state missing - try to get user from API
        Alert.alert(t('faceCheckIn.error'), t('faceCheckIn.pleaseLoginAgain'));
        onClose();
        return;
      }
      
      console.log('✅ FaceCheckInModal: Authenticated, proceeding with check-in');

      // OPTIMIZATION: Use cached location immediately (no GPS wait)
      // This makes check-in instant!
      let location: any = null;
      try {
        const cachedLocationStr = await AsyncStorage.getItem('lastKnownLocation');
        if (cachedLocationStr) {
          const cached = JSON.parse(cachedLocationStr);
          const age = Date.now() - cached.timestamp;
          // Use cached location if it's less than 5 minutes old (still accurate enough)
          if (age < 300000) { // 5 minutes instead of 2
            location = { latitude: cached.latitude, longitude: cached.longitude };
            console.log('✅ Using cached location (age:', Math.round(age / 1000), 'seconds)');
          }
        }
      } catch (e) {
        console.warn('Could not read cached location:', e);
      }

      // OPTIMIZATION: Only get fresh location if absolutely no cache (rare case)
      // Most of the time, cached location will be used (instant!)
      if (!location) {
        setStatusMessage(t('faceCheckIn.verifyingLocation'));
        try {
          // Shorter timeout - 5 seconds instead of 8
          location = await Promise.race([
            getCurrentLocation(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Location timeout')), 5000)
            )
          ]) as any;
          console.log('✅ Got fresh GPS location');
        } catch (locationError) {
          console.warn('Location fetch failed:', locationError);
          Alert.alert(t('faceCheckIn.warning'), t('faceCheckIn.locationFailed'));
          onClose();
          return;
        }
      }
      
      setStatusMessage('جارٍ إرسال الطلب...');

      // Get device fingerprint for device binding verification
      let deviceFingerprint = null;
      try {
        deviceFingerprint = await AsyncStorage.getItem('fingerprintPublicKey');
        if (deviceFingerprint) {
          console.log('🔑 Retrieved device fingerprint for check-in verification');
        }
      } catch (error) {
        console.warn('⚠️ Could not retrieve device fingerprint:', error);
      }

      // Call attendance API
      // Priority: Send faceEmbedding (generated on-device) - MOST ACCURATE
      // Fallback: Send image or landmarks if embedding not available
      const attendancePayload: any = {
        latitude: location.latitude,
        longitude: location.longitude,
        address: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
        faceIdVerified: true,
        faceId: faceId, // Send faceId for verification
        fingerprintPublicKey: deviceFingerprint, // Device binding verification
      };
      
      if (faceEmbedding && Array.isArray(faceEmbedding) && faceEmbedding.length > 0) {
        attendancePayload.faceEmbedding = faceEmbedding;
        console.log(`✅ Sending faceEmbedding (${faceEmbedding.length}-D array) for verification`);
      } else if (faceImageBase64) {
        attendancePayload.faceImage = faceImageBase64;
        console.log('✅ Sending faceImage (base64) for verification (fallback)');
      } else if (faceLandmarksPayload) {
        attendancePayload.faceLandmarks = faceLandmarksPayload;
        console.log('✅ Sending faceLandmarks for verification (fallback)');
      }
      
      if (deviceFingerprint) {
        console.log('🔒 Device binding enabled for check-in/out - backend will verify device');
      }
      
      setStatusMessage('جارٍ إرسال الطلب...');
      const apiStartTime = Date.now();
      
      // Show progress for slow networks
      const progressInterval = setInterval(() => {
        const elapsed = Date.now() - apiStartTime;
        if (elapsed > 5000) {
          setStatusMessage(`جارٍ المعالجة... (${Math.round(elapsed / 1000)} ثانية)`);
        }
      }, 1000);
      
      let response;
      try {
        if (type === 'checkout') {
          response = await attendanceAPI.checkOut(attendancePayload);
        } else {
          response = await attendanceAPI.checkIn(attendancePayload);
        }
        clearInterval(progressInterval);
      } catch (apiError: any) {
        clearInterval(progressInterval);
        const apiTime = Date.now() - apiStartTime;
        console.error(`❌ API call failed after ${apiTime}ms:`, apiError.message);
        
        // Check if it's a token/auth error
        if (apiError.response?.status === 401) {
          Alert.alert('خطأ', 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مرة أخرى.');
          onClose();
          return;
        }
        
        throw apiError; // Re-throw other errors
      }
      
      const apiTime = Date.now() - apiStartTime;
      console.log(`✅ Frontend: API call completed successfully in ${apiTime}ms`);
      console.log('✅ Response received:', response?.message || 'Success');
      
      // Show success message based on response time
      if (apiTime > 10000) {
        console.log('⚠️ Slow network detected:', apiTime, 'ms');
      }
      
      // Clear face capture result in background (don't wait)
      AsyncStorage.removeItem('faceCaptureResult').catch(() => {});

      // Get the check-in/check-out time from response or use current time
      // Backend returns: { message: "...", attendance: { checkInTime: Date, ... } }
      const now = new Date().toISOString();
      let checkTime: string = now;
      
      if (type === 'checkin') {
        // Backend returns checkInTime as Date object or string, convert to ISO string
        const checkInTime = response?.attendance?.checkInTime;
        if (checkInTime) {
          if (typeof checkInTime === 'string') {
            checkTime = checkInTime;
          } else {
            checkTime = new Date(checkInTime).toISOString();
          }
        }
      } else {
        // Backend returns checkOutTime as Date object or string, convert to ISO string
        const checkOutTime = response?.attendance?.checkOutTime;
        if (checkOutTime) {
          if (typeof checkOutTime === 'string') {
            checkTime = checkOutTime;
          } else {
            checkTime = new Date(checkOutTime).toISOString();
          }
        }
      }
      
      // Update UI immediately (optimistic update) - pass time to onSuccess
      // Backend still saves to database for admin, but we update UI instantly
      if (type === 'checkin') {
        await Promise.resolve(onSuccess(checkTime, undefined));
      } else {
        await Promise.resolve(onSuccess(undefined, checkTime));
      }
      
      // Close modal and show success
      onClose();
      
      // Show success alert
      Alert.alert('نجح', response?.message || (type === 'checkout' ? 'تم تسجيل الانصراف بنجاح' : 'تم تسجيل الحضور بنجاح'));
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'حدث خطأ أثناء التسجيل';
      Alert.alert('خطأ', errorMessage, [
        {
          text: 'حسناً',
          onPress: () => {
            onClose();
          },
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Icon
            name="face-recognition"
            size={40}
            color="#10B981"
          />
        </View>
        <Text style={styles.title}>
          {type === 'checkout' ? 'تأكيد الانصراف بالوجه' : 'تأكيد الحضور بالوجه'}
        </Text>
        <Text style={styles.subtitle}>{statusMessage}</Text>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#10B981" />
            <Text style={styles.loadingText}>جارٍ التحقق من الهوية والموقع...</Text>
          </View>
        ) : capturing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#10B981" />
            <Text style={styles.loadingText}>جارٍ التقاط الوجه...</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.retryButton} onPress={() => {
            setCapturing(true);
            navigation.navigate('FaceCapture' as never);
          }}>
            <Icon name="refresh" size={20} color="#10B981" />
            <Text style={styles.retryText}>المحاولة مرة أخرى</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>إلغاء</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#10B981',
    marginTop: 8,
  },
  retryText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#10B981',
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 12,
  },
  cancelText: {
    fontSize: 14,
    color: '#6B7280',
  },
});

export default FaceCheckInModal;

