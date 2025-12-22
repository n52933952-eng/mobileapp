import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI } from '../services/api';
import { authenticateWithBiometrics, checkBiometricAvailability } from '../services/biometrics';
import { User } from '../types';
import { initializeSocket } from '../services/socket';

interface AuthContextType {
  user: User | null;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  loading: boolean;
  isAuthenticated: boolean;
  biometricAvailable: boolean;
  biometricType: string | null;
  login: (emailOrEmployeeNumber: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  loginWithBiometrics: () => Promise<void>;
  loginWithFaceRecognition: (faceDetected: boolean, emailOrEmployeeNumber?: string, currentFaceId?: string, capturedFaceData?: any) => Promise<void>;
  enableBiometric: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

interface RegisterData {
  employeeNumber: string;
  email: string;
  password: string;
  fullName?: string;
  department?: string;
  position?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState<string | null>(null);

  // Check biometric availability on mount
  useEffect(() => {
    checkBiometricAvailability().then((result) => {
      setBiometricAvailable(result.available);
      setBiometricType(result.biometryType);
    });
  }, []);

  // Check authentication status on mount
  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      // First, try to clean up any large base64 data from AsyncStorage
      // Use getAllKeys to find all keys and clean them one by one
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        
        // Clean up registrationData if it contains base64
        if (allKeys.includes('registrationData')) {
          try {
            const regData = await AsyncStorage.getItem('registrationData');
            if (regData) {
              const parsed = JSON.parse(regData);
              // If it contains base64, remove it
              if (parsed.profileImage && parsed.profileImage.startsWith('data:')) {
                parsed.profileImage = null;
                parsed.profileImageUri = parsed.profileImageUri || null;
                await AsyncStorage.setItem('registrationData', JSON.stringify(parsed));
              }
            }
          } catch (e) {
            // If corrupted, remove it
            await AsyncStorage.removeItem('registrationData');
          }
        }
        
        // Clean up user if it contains base64
        if (allKeys.includes('user')) {
          try {
            const userString = await AsyncStorage.getItem('user');
            if (userString) {
              const user = JSON.parse(userString);
              if (user.profileImage && user.profileImage.startsWith('data:')) {
                delete user.profileImage;
                await AsyncStorage.setItem('user', JSON.stringify(user));
              }
            }
          } catch (e) {
            // If corrupted, try to remove profileImage only
            try {
              const userString = await AsyncStorage.getItem('user');
              if (userString && userString.length > 100000) {
                // Likely contains large base64, remove entire user object
                await AsyncStorage.removeItem('user');
              }
            } catch (e2) {
              // If still fails, remove it
              await AsyncStorage.removeItem('user');
            }
          }
        }
        
        // Clean up faceData if it contains base64
        if (allKeys.includes('faceData')) {
          try {
            const faceDataString = await AsyncStorage.getItem('faceData');
            if (faceDataString) {
              if (faceDataString.length > 50000) {
                // Likely contains base64, remove it
                await AsyncStorage.removeItem('faceData');
              } else {
                const faceData = JSON.parse(faceDataString);
                if (faceData.base64) {
                  const cleanedFaceData = {
                    uri: faceData.uri,
                    face: faceData.face,
                  };
                  await AsyncStorage.setItem('faceData', JSON.stringify(cleanedFaceData));
                }
              }
            }
          } catch (e) {
            // If corrupted, remove it
            await AsyncStorage.removeItem('faceData');
          }
        }
        
        // Clean up temporary storage
        await AsyncStorage.removeItem('profileImageBase64_temp');
      } catch (cleanupError) {
        console.log('Cleanup error (non-critical):', cleanupError);
        // If cleanup fails, try to remove potentially problematic keys
        try {
          await AsyncStorage.multiRemove(['registrationData', 'faceData', 'profileImageBase64_temp']);
        } catch (e) {
          // Ignore
        }
      }
      
      // Now try to read token and user
      const token = await AsyncStorage.getItem('token');
      let userString = null;
      try {
        userString = await AsyncStorage.getItem('user');
      } catch (error: any) {
        // If reading user fails (likely too large), remove it
        if (error.message?.includes('too big') || error.message?.includes('CursorWindow')) {
          await AsyncStorage.removeItem('user');
          userString = null;
        }
      }
      
      if (token && userString) {
        try {
          // Verify token by getting current user
          console.log('🔄 checkAuth: Calling getMe() to verify token...');
          const response = await authAPI.getMe();
          console.log('✅ checkAuth: getMe() successful, user:', response.user?.email || response.user?.employeeNumber);
          setUser(response.user);
          
          // Initialize Socket.io if user is authenticated
          try {
            await initializeSocket();
            console.log('✅ Socket.io initialized after checkAuth');
          } catch (socketError) {
            console.error('⚠️ Failed to initialize Socket.io after checkAuth:', socketError);
          }
        } catch (error: any) {
          console.error('❌ checkAuth: getMe() failed:', error.message);
          console.error('❌ Error details:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
          });
          // Token invalid, clear storage
          await AsyncStorage.multiRemove(['token', 'user', 'cookies']);
          setUser(null);
          throw error; // Re-throw so caller knows it failed
        }
      } else {
        setUser(null);
      }
    } catch (error: any) {
      console.error('Check auth error:', error);
      // If error is related to AsyncStorage size, try to clean up
      if (error.message?.includes('too big') || error.message?.includes('CursorWindow')) {
        try {
          await AsyncStorage.multiRemove(['registrationData', 'faceData', 'profileImageBase64_temp', 'user']);
        } catch (e) {
          // Ignore
        }
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (emailOrEmployeeNumber: string, password: string) => {
    try {
      const data = emailOrEmployeeNumber.includes('@')
        ? { email: emailOrEmployeeNumber, password }
        : { employeeNumber: emailOrEmployeeNumber, password };
      
      const response = await authAPI.login(data);
      
      // Check approval status - allow login even if pending (user will see message in home screen)
      // if (response.approvalStatus === 'pending') {
      //   // User can login but will see pending message
      //   // Don't save credentials or navigate - show approval pending screen
      //   throw new Error('PENDING_APPROVAL: يرجى انتظار موافقة المدير على طلب التسجيل');
      // }

      if (response.approvalStatus === 'rejected') {
        // User was rejected - cannot login
        throw new Error(`REJECTED: تم رفض طلب التسجيل. ${response.rejectionReason ? `السبب: ${response.rejectionReason}` : 'لا يمكنك تسجيل الدخول.'}`);
      }
      
      // Get fresh user data from database (not from AsyncStorage)
      try {
        const freshUserData = await authAPI.getMe();
        setUser(freshUserData.user);
        
        // Save user data to AsyncStorage for persistence after refresh
        if (freshUserData.user) {
          await AsyncStorage.setItem('user', JSON.stringify(freshUserData.user));
        }
      } catch (getMeError) {
        // If getMe fails, use the user from login response
        setUser(response.user);
        
        // Save user data to AsyncStorage for persistence after refresh
        if (response.user) {
          await AsyncStorage.setItem('user', JSON.stringify(response.user));
        }
      }
      
      // Save credentials for biometric login
      if (emailOrEmployeeNumber.includes('@')) {
        await AsyncStorage.setItem('biometricEmail', emailOrEmployeeNumber);
      } else {
        await AsyncStorage.setItem('biometricEmployeeNumber', emailOrEmployeeNumber);
      }
      await AsyncStorage.setItem('biometricPassword', password);
      
      // Save user preference for biometric
      if (biometricAvailable && response.user.faceIdEnabled) {
        await AsyncStorage.setItem('biometricEnabled', 'true');
      }
      
      // Initialize Socket.io connection after successful login
      try {
        await initializeSocket();
        console.log('✅ Socket.io initialized after login');
      } catch (socketError) {
        console.error('⚠️ Failed to initialize Socket.io after login:', socketError);
        // Don't fail login if socket fails
      }
    } catch (error: any) {
      // Check if it's an approval status error
      if (error.message?.includes('PENDING_APPROVAL:') || error.message?.includes('REJECTED:')) {
        throw error; // Re-throw approval errors as-is
      }
      
      // Check response for approval status
      if (error.response?.data?.approvalStatus === 'pending') {
        throw new Error('PENDING_APPROVAL: يرجى انتظار موافقة المدير على طلب التسجيل');
      }
      
      if (error.response?.data?.approvalStatus === 'rejected') {
        const reason = error.response?.data?.rejectionReason || '';
        throw new Error(`REJECTED: تم رفض طلب التسجيل. ${reason ? `السبب: ${reason}` : 'لا يمكنك تسجيل الدخول.'}`);
      }
      
      throw new Error(error.response?.data?.message || error.message || 'فشل تسجيل الدخول');
    }
  };

  const register = async (data: RegisterData) => {
    try {
      const response = await authAPI.register({
        ...data,
        fullName: data.fullName || data.employeeNumber, // Use employee number if name not provided
      });
      setUser(response.user);
      // Don't navigate automatically - let the screen handle navigation
      return response;
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'فشل إنشاء الحساب');
    }
  };

  const logout = async () => {
    // Optimistic logout - clear state immediately, call API in background
    setUser(null);
    // IMPORTANT: Do NOT remove fingerprintPublicKey or faceData - these are needed for biometric login
    // Only remove session-related data (token, user, cookies, biometricEnabled flag)
    await AsyncStorage.multiRemove(['token', 'user', 'cookies', 'biometricEnabled']);
    console.log('✅ Logout: Removed session data (token, user, cookies, biometricEnabled)');
    console.log('✅ Logout: Kept fingerprintPublicKey and faceData for biometric login');
    
    // Verify fingerprintPublicKey is still there
    const fingerprintKey = await AsyncStorage.getItem('fingerprintPublicKey');
    const faceData = await AsyncStorage.getItem('faceData');
    console.log('🔍 Logout: fingerprintPublicKey still exists?', !!fingerprintKey);
    console.log('🔍 Logout: faceData still exists?', !!faceData);
    if (fingerprintKey) {
      console.log('🔑 Logout: fingerprintPublicKey (first 50 chars):', fingerprintKey.substring(0, 50) + '...');
    }
    
    // Call logout API in background (don't wait for it)
    // 401 errors are expected if token is expired/invalid - silently ignore
    authAPI.logout().catch((error) => {
      // Only log if it's not a 401 (unauthorized) - that's expected when token is invalid
      if (error.response?.status !== 401) {
        console.error('Logout API error (non-critical):', error);
      }
      // 401 is expected - token already expired/invalid, user is already logged out locally
    });
  };

  const loginWithBiometrics = async () => {
    try {
      if (!biometricAvailable) {
        throw new Error('المصادقة الحيوية غير متاحة');
      }

      // Authenticate with biometrics (System Biometric: Face ID / Fingerprint)
      const authResult = await authenticateWithBiometrics(
        'تأكيد الهوية لتسجيل الدخول',
        'استخدم كلمة المرور'
      );

      if (!authResult.success) {
        throw new Error(authResult.message || 'فشل التحقق');
      }

      // CRITICAL: Use the EXACT key that was saved during registration
      // Priority: AsyncStorage (exact key from registration) > Device storage
      let fingerprintPublicKey: string | null = null;
      
      // First, try AsyncStorage - this has the EXACT key that was sent to backend
      fingerprintPublicKey = await AsyncStorage.getItem('fingerprintPublicKey');
      if (fingerprintPublicKey) {
        console.log('✅ Got fingerprint key from AsyncStorage (EXACT key from registration)');
      } else {
        // Fallback: Try device secure storage
        console.log('⚠️ No key in AsyncStorage, trying device secure storage...');
        const { getExistingBiometricPublicKey } = await import('../services/biometrics');
        const existingKeyResult = await getExistingBiometricPublicKey();
        
        if (existingKeyResult.success && existingKeyResult.publicKey) {
          fingerprintPublicKey = existingKeyResult.publicKey;
          console.log('✅ Got fingerprint key from device secure storage (fallback)');
          console.log('⚠️ WARNING: This key might not match database if keys were regenerated!');
          
          // Save to AsyncStorage for next time
          await AsyncStorage.setItem('fingerprintPublicKey', fingerprintPublicKey);
        }
      }
      
      if (fingerprintPublicKey) {
        // Login with fingerprint only - backend will find user by fingerprintPublicKey
        try {
          const response = await authAPI.loginWithBiometric({
            fingerprintPublicKey: fingerprintPublicKey,
          });
          
          // Check approval status - allow login even if pending (user will see message in home screen)
          // if (response.approvalStatus === 'pending') {
          //   throw new Error('PENDING_APPROVAL: يرجى انتظار موافقة المدير على طلب التسجيل');
          // }

          if (response.approvalStatus === 'rejected') {
            const reason = response.rejectionReason || '';
            throw new Error(`REJECTED: تم رفض طلب التسجيل. ${reason ? `السبب: ${reason}` : 'لا يمكنك تسجيل الدخول.'}`);
          }
          
          if (response && response.user) {
            // Get fresh user data from database (not from AsyncStorage)
            try {
              const freshUserData = await authAPI.getMe();
              setUser(freshUserData.user);
              
              // Save user data to AsyncStorage for persistence after refresh
              if (freshUserData.user) {
                await AsyncStorage.setItem('user', JSON.stringify(freshUserData.user));
              }
            } catch (getMeError) {
              // If getMe fails, use the user from login response
              setUser(response.user);
              
              // Save user data to AsyncStorage for persistence after refresh
              if (response.user) {
                await AsyncStorage.setItem('user', JSON.stringify(response.user));
              }
            }
            
            // Save credentials for future use (optional)
            if (response.user.email) {
              await AsyncStorage.setItem('biometricEmail', response.user.email);
            }
            if (response.user.employeeNumber) {
              await AsyncStorage.setItem('biometricEmployeeNumber', response.user.employeeNumber);
            }
            
            // Initialize Socket.io connection after successful login
            try {
              await initializeSocket();
              console.log('✅ Socket.io initialized after biometric login');
            } catch (socketError) {
              console.error('⚠️ Failed to initialize Socket.io after biometric login:', socketError);
            }
            
            return; // Success - exit early
          }
        } catch (fingerprintError: any) {
          // If fingerprint login fails, fall back to stored credentials
          console.log('Fingerprint login failed, trying stored credentials:', fingerprintError.message);
        }
      }

      // Fallback: Use stored credentials (email/employeeNumber + password)
      const storedEmail = await AsyncStorage.getItem('biometricEmail');
      const storedEmployeeNumber = await AsyncStorage.getItem('biometricEmployeeNumber');
      const storedPassword = await AsyncStorage.getItem('biometricPassword');
      
      if (!storedEmail && !storedEmployeeNumber) {
        throw new Error('لم يتم حفظ بيانات تسجيل الدخول');
      }

      if (!storedPassword) {
        // Try to use existing token if available
        const token = await AsyncStorage.getItem('token');
        if (token) {
          try {
            const response = await authAPI.getMe();
            setUser(response.user);
            return;
          } catch (error) {
            // Token expired, need password
            throw new Error('يرجى تسجيل الدخول بالبريد وكلمة المرور أولاً');
          }
        } else {
          throw new Error('يرجى تسجيل الدخول بالبريد وكلمة المرور أولاً');
        }
      }

      // Login with stored credentials
      const loginData = storedEmail
        ? { email: storedEmail, password: storedPassword }
        : { employeeNumber: storedEmployeeNumber!, password: storedPassword };
      
      const response = await authAPI.login(loginData);
      setUser(response.user);
    } catch (error: any) {
      throw new Error(error.message || 'فشل تسجيل الدخول بالبيومترية');
    }
  };

  const loginWithFaceRecognition = async (faceDetected: boolean, emailOrEmployeeNumber?: string, currentFaceId?: string, capturedFaceData?: any) => {
    console.log('🚀 AuthContext: loginWithFaceRecognition called');
    console.log('🔍 AuthContext: faceDetected:', faceDetected);
    console.log('🔍 AuthContext: emailOrEmployeeNumber:', emailOrEmployeeNumber);
    console.log('🔍 AuthContext: currentFaceId:', currentFaceId);
    console.log('🔍 AuthContext: has capturedFaceData:', capturedFaceData ? 'yes' : 'no');
    
    try {
      // NEW APPROACH: ML Kit detects face (liveness check) - NO native biometric prompt needed
      // Step 1: ML Kit already detected and verified real face (faceDetected = true means real face is present)
      // ML Kit's liveness detection (eyes open, looking at camera, etc.) is sufficient security
      if (!faceDetected) {
        throw new Error('لم يتم اكتشاف الوجه. يرجى النظر إلى الكاميرا');
      }

      console.log('✅ AuthContext: ML Kit verified real face - proceeding with faceId login');
      console.log('💡 AuthContext: Will compare current face with stored faceId for security');

      // SECURITY: Compare current captured faceId with stored faceId
      // This ensures only the registered person can login (not someone else using stored credentials)
      if (!currentFaceId) {
        throw new Error('لم يتم إنشاء faceId من الوجه الحالي. يرجى المحاولة مرة أخرى');
      }

      console.log('🔍 AuthContext: Current captured faceId:', currentFaceId);
      
      // Step 3: Login with FACE (this is loginWithFaceRecognition - ALWAYS use face!)
      // SECURITY: Send face data + current device fingerprint for device verification
      // This ensures: 1) Face matches user (97% threshold), 2) Device matches registered device
      
      console.log('🔍 AuthContext: Step 3 - Face login with device verification...');
      let response;
      
      // capturedFaceData is now the full result object from FaceCaptureScreen
      console.log('🔍 AuthContext: Full capturedFaceData keys:', capturedFaceData ? Object.keys(capturedFaceData) : 'null');
      console.log('🔍 AuthContext: capturedFaceData.faceEmbedding:', capturedFaceData?.faceEmbedding ? `exists (${capturedFaceData.faceEmbedding.length}-D array)` : 'null');
      
      const faceLandmarksPayload = capturedFaceData?.faceData?.[0] || capturedFaceData?.faceFeatures || null;
      const faceImageBase64 = capturedFaceData?.imageBase64 || null;
      const faceEmbedding = capturedFaceData?.faceEmbedding || null;
      
      console.log('🔍 AuthContext: Extracted faceEmbedding:', faceEmbedding ? `exists (${faceEmbedding.length}-D array)` : 'null');
      console.log('🔍 AuthContext: faceEmbedding type:', typeof faceEmbedding);
      console.log('🔍 AuthContext: faceEmbedding isArray:', Array.isArray(faceEmbedding));
      
      // Get CURRENT device's fingerprintPublicKey for device verification
      // IMPORTANT: Use STORED key from AsyncStorage (registered during setup)
      // This ensures we use the SAME key that was saved during registration
      let currentDeviceFingerprintPublicKey: string | null = null;
      try {
        // First, try to get the stored key from AsyncStorage (saved during registration)
        const storedKey = await AsyncStorage.getItem('fingerprintPublicKey');
        if (storedKey) {
          currentDeviceFingerprintPublicKey = storedKey;
          console.log('✅ AuthContext: Using STORED device fingerprintPublicKey (from registration)');
          console.log('🔑 AuthContext: Stored key (first 50 chars):', currentDeviceFingerprintPublicKey.substring(0, 50) + '...');
          console.log('📱 AuthContext: Key length:', currentDeviceFingerprintPublicKey.length);
        } else {
          console.log('⚠️ AuthContext: No stored fingerprintPublicKey in AsyncStorage');
          console.log('⚠️ AuthContext: Backend will block if user has registered device');
        }
      } catch (keysError) {
        console.log('⚠️ AuthContext: Error getting stored fingerprintPublicKey:', keysError);
        console.log('⚠️ AuthContext: Continuing without it - backend will block if user has registered device');
      }
      
      console.log('👤 AuthContext: Face login with device binding security');
      console.log('🔒 AuthContext: This ensures only the registered user on their registered device can login');
      
      // Declare loginPayload outside try block so it's accessible in catch block
      let loginPayload: any = {};
      
      // FACE LOGIN: Send face data + device fingerprint
      try {
        console.log('📤 AuthContext: Sending face login request...');
        loginPayload = {};
        
        // REQUIRED: Include face data (at least one type)
        // Priority: Send faceEmbedding (generated on-device) - MOST ACCURATE
        if (faceEmbedding && Array.isArray(faceEmbedding) && faceEmbedding.length > 0) {
          // Ensure faceEmbedding is a proper array of numbers
          const validEmbedding = faceEmbedding.filter(v => typeof v === 'number' && !isNaN(v));
          if (validEmbedding.length !== faceEmbedding.length) {
            console.warn('⚠️ AuthContext: Some faceEmbedding values are not numbers, filtering...');
            console.warn(`   Original length: ${faceEmbedding.length}, Valid length: ${validEmbedding.length}`);
          }
          loginPayload.faceEmbedding = validEmbedding.length > 0 ? validEmbedding : faceEmbedding;
          console.log(`✅ AuthContext: Including faceEmbedding (${loginPayload.faceEmbedding.length}-D array) for face verification`);
          console.log(`🔍 AuthContext: faceEmbedding type: ${typeof loginPayload.faceEmbedding}, isArray: ${Array.isArray(loginPayload.faceEmbedding)}`);
          console.log(`🔍 AuthContext: faceEmbedding first 5 values: [${loginPayload.faceEmbedding.slice(0, 5).join(', ')}]`);
          console.log(`🔍 AuthContext: faceEmbedding last 5 values: [${loginPayload.faceEmbedding.slice(-5).join(', ')}]`);
          console.log(`🔍 AuthContext: faceEmbedding min/max: ${Math.min(...loginPayload.faceEmbedding)} / ${Math.max(...loginPayload.faceEmbedding)}`);
        } else if (faceImageBase64) {
          // Fallback: Send image if embedding not available
          loginPayload.faceImage = faceImageBase64;
          console.log('✅ AuthContext: Including faceImage (base64) for face verification (fallback)');
          console.log('🔍 AuthContext: faceImage length:', faceImageBase64.length);
        } else if (faceLandmarksPayload) {
          // Fallback: Send landmarks if neither embedding nor image available
          loginPayload.faceLandmarks = faceLandmarksPayload;
          console.log('✅ AuthContext: Including faceLandmarks for face verification (fallback)');
        } else {
          console.error('❌ AuthContext: No face data available!');
          console.error('   - faceEmbedding:', faceEmbedding ? `exists (${faceEmbedding.length}-D)` : 'null');
          console.error('   - faceImageBase64:', faceImageBase64 ? `exists (${faceImageBase64.length} chars)` : 'null');
          console.error('   - faceLandmarksPayload:', faceLandmarksPayload ? 'exists' : 'null');
          throw new Error('لم يتم العثور على بيانات الوجه. يرجى المحاولة مرة أخرى');
        }
        
        // REQUIRED: Include current device's fingerprintPublicKey for device verification
        // Backend will check: if user has registered device, must match current device
        if (currentDeviceFingerprintPublicKey) {
          loginPayload.fingerprintPublicKey = currentDeviceFingerprintPublicKey;
          console.log('✅ AuthContext: Including device fingerprint for device verification');
          console.log('🔒 AuthContext: Backend will verify this device matches registered device');
          console.log('📱 AuthContext: Device fingerprint (full):', currentDeviceFingerprintPublicKey);
          console.log('📱 AuthContext: Device fingerprint length:', currentDeviceFingerprintPublicKey.length);
        } else {
          console.log('⚠️ AuthContext: No device fingerprint - backend will block if user has registered device');
        }
        
        // REQUIRED: Always include faceId as fallback if faceEmbedding fails
        // Backend will use faceId if faceEmbedding similarity is below threshold
        if (currentFaceId) {
          loginPayload.faceId = currentFaceId;
          console.log('✅ AuthContext: Including faceId as fallback:', currentFaceId);
        } else {
          console.warn('⚠️ AuthContext: No faceId available - faceEmbedding must match exactly');
        }
        
        console.log('📤 AuthContext: Sending face login payload:', JSON.stringify({
          hasFaceEmbedding: !!loginPayload.faceEmbedding,
          faceEmbeddingLength: loginPayload.faceEmbedding?.length || 0,
          hasFaceImage: !!loginPayload.faceImage,
          hasFaceId: !!loginPayload.faceId,
          faceIdValue: loginPayload.faceId || 'null',
          hasFingerprint: !!loginPayload.fingerprintPublicKey,
          fingerprintLength: loginPayload.fingerprintPublicKey?.length || 0,
          hasEmail: !!loginPayload.email,
          hasEmployeeNumber: !!loginPayload.employeeNumber,
        }));
        
        console.log('📤 AuthContext: Sending face login payload:', JSON.stringify({
          hasFaceEmbedding: !!loginPayload.faceEmbedding,
          faceEmbeddingLength: loginPayload.faceEmbedding?.length || 0,
          hasFaceImage: !!loginPayload.faceImage,
          hasFaceId: !!loginPayload.faceId,
          faceIdValue: loginPayload.faceId || 'null',
          hasFingerprint: !!loginPayload.fingerprintPublicKey,
          fingerprintLength: loginPayload.fingerprintPublicKey?.length || 0,
          hasEmail: !!loginPayload.email,
          hasEmployeeNumber: !!loginPayload.employeeNumber,
        }));
        
        response = await authAPI.loginWithBiometric(loginPayload);
        console.log('✅ AuthContext: Face login successful!');
        console.log('✅ AuthContext: Response user:', response?.user?.email || 'no user');
        
        // Check approval status - allow login even if pending (user will see message in home screen)
        // if (response.approvalStatus === 'pending') {
        //   throw new Error('PENDING_APPROVAL: يرجى انتظار موافقة المدير على طلب التسجيل');
        // }

        if (response.approvalStatus === 'rejected') {
          const reason = response.rejectionReason || '';
          throw new Error(`REJECTED: تم رفض طلب التسجيل. ${reason ? `السبب: ${reason}` : 'لا يمكنك تسجيل الدخول.'}`);
        }
        
        // Verify token was saved
        const savedToken = await AsyncStorage.getItem('token');
        console.log('🔍 AuthContext: Token saved after face login:', !!savedToken);
        if (!savedToken) {
          console.error('❌ AuthContext: Token NOT saved after face login!');
        }
        
        console.log('✅ AuthContext: Backend verified face (97% threshold) + device match - login successful');
      } catch (faceLoginError: any) {
        console.log('❌ AuthContext: Face login failed:', faceLoginError.message);
        console.log('❌ AuthContext: Error response:', faceLoginError.response?.data);
        console.log('❌ AuthContext: Error status:', faceLoginError.response?.status);
        console.log('❌ AuthContext: Full error:', JSON.stringify({
          message: faceLoginError.message,
          code: faceLoginError.code,
          status: faceLoginError.response?.status,
          data: faceLoginError.response?.data,
        }));
        
        // Show appropriate error message
        const errorMessage = faceLoginError.response?.data?.message || faceLoginError.message || '';
        if (errorMessage.includes('غير مسجل') || 
            errorMessage.includes('غير صحيح') ||
            errorMessage.includes('not registered') ||
            errorMessage.includes('not found') ||
            errorMessage.includes('face not')) {
          console.error('❌ Face not registered error - checking what was sent:');
          if (loginPayload) {
            console.error('   - faceEmbedding sent:', !!loginPayload.faceEmbedding, loginPayload.faceEmbedding?.length || 0);
            console.error('   - faceId sent:', loginPayload.faceId || 'null');
            console.error('   - faceImage sent:', !!loginPayload.faceImage);
            console.error('   - fingerprint sent:', !!loginPayload.fingerprintPublicKey);
          } else {
            console.error('   - loginPayload was not initialized before error occurred');
          }
          throw new Error('الوجه غير مسجل. يرجى التسجيل أولاً.');
        } else if (errorMessage.includes('البصمة غير متطابقة') ||
                   errorMessage.includes('الجهاز المسجل') ||
                   errorMessage.includes('device') ||
                   errorMessage.includes('fingerprint')) {
          throw new Error('لا يمكنك تسجيل الدخول من هذا الجهاز. يرجى استخدام جهازك المسجل.');
        }
        
        throw faceLoginError;
      }

      if (response && response.user) {
        // CRITICAL: Verify token was saved (should have been saved in api.ts)
        // Check immediately - if not there, save it from response
        let savedToken = await AsyncStorage.getItem('token');
        
        if (!savedToken) {
          console.error('❌ AuthContext: Token not found after login!');
          // Token should have been saved in api.ts, but if not, save it from response
          if (response.token) {
            console.log('🔧 AuthContext: Saving token from response...');
            await AsyncStorage.setItem('token', response.token);
            savedToken = await AsyncStorage.getItem('token');
            if (!savedToken) {
              throw new Error('فشل حفظ رمز التحقق. يرجى المحاولة مرة أخرى.');
            }
            console.log('✅ AuthContext: Token saved from response');
          } else {
            throw new Error('فشل حفظ رمز التحقق. يرجى المحاولة مرة أخرى.');
          }
        } else {
          console.log('✅ AuthContext: Token verified after login (length:', savedToken.length, ')');
        }
        
        // CRITICAL: Save user and token together atomically
        await Promise.all([
          AsyncStorage.setItem('user', JSON.stringify(response.user)),
          AsyncStorage.setItem('token', savedToken) // Re-save to ensure it persists
        ]);
        
        // Set user state immediately for instant navigation
        setUser(response.user);
        
        // Final verification: token must exist
        const finalToken = await AsyncStorage.getItem('token');
        if (!finalToken) {
          console.error('❌ AuthContext: Token lost after save! Re-saving...');
          await AsyncStorage.setItem('token', savedToken);
          const recheck = await AsyncStorage.getItem('token');
          if (!recheck) {
            throw new Error('فشل حفظ رمز التحقق. يرجى المحاولة مرة أخرى.');
          }
        }
        
        console.log('✅ AuthContext: Login complete - token and user saved');
        
        // Initialize Socket.io connection after successful login
        try {
          await initializeSocket();
          console.log('✅ Socket.io initialized after face recognition login');
        } catch (socketError) {
          console.error('⚠️ Failed to initialize Socket.io after face login:', socketError);
        }
        
        // CRITICAL: Final verification after a short delay (ensure token persisted)
        setTimeout(async () => {
          const verifyToken = await AsyncStorage.getItem('token');
          if (!verifyToken) {
            console.error('❌ AuthContext: Token lost after login! Re-saving...');
            if (response.token) {
              await AsyncStorage.setItem('token', response.token);
              console.log('✅ AuthContext: Token re-saved after verification');
            }
          } else {
            console.log('✅ AuthContext: Token verified and persisted after login');
          }
        }, 500);

        // Fire-and-forget: refresh profile in background (doesn't block UI)
        (async () => {
          try {
            const freshUserData = await authAPI.getMe();
            if (freshUserData?.user) {
              setUser(freshUserData.user);
              await AsyncStorage.setItem('user', JSON.stringify(freshUserData.user));
            }
          } catch (getMeError: any) {
            // Don't log network errors - they're expected if backend is down
            if (getMeError?.message !== 'Network Error' && getMeError?.code !== 'ERR_NETWORK') {
              console.log('⚠️ AuthContext: Optional profile refresh failed:', getMeError?.message || getMeError);
            }
          }
        })();
        
        // Save user credentials for future biometric login
        if (response.user.email) {
          await AsyncStorage.setItem('biometricEmail', response.user.email);
        }
        if (response.user.employeeNumber) {
          await AsyncStorage.setItem('biometricEmployeeNumber', response.user.employeeNumber);
        }
      } else {
        throw new Error('فشل تسجيل الدخول');
      }
    } catch (error: any) {
      // Handle specific HTTP status codes
      if (error.response?.status === 503) {
        throw new Error('الخادم غير متاح حالياً. يرجى المحاولة لاحقاً.');
      } else if (error.response?.status === 500) {
        throw new Error('خطأ في الخادم. يرجى المحاولة لاحقاً.');
      } else if (error.response?.status === 401) {
        throw new Error('فشل التحقق من الهوية. يرجى المحاولة مرة أخرى.');
      } else if (error.response?.status === 404) {
        throw new Error('المستخدم غير موجود.');
      }
      throw new Error(error.response?.data?.message || error.message || 'فشل تسجيل الدخول بالوجه');
    }
  };

  const enableBiometric = async () => {
    try {
      // First authenticate with biometrics to enable
      const authResult = await authenticateWithBiometrics(
        'تفعيل المصادقة الحيوية',
        'استخدم كلمة المرور'
      );

      if (!authResult.success) {
        throw new Error(authResult.message || 'فشل التحقق');
      }

      // Enable biometric in backend
      await authAPI.toggleFaceId(true);
      
      // Update user state
      if (user) {
        setUser({ ...user, faceIdEnabled: true });
      }

      // Store email/employee number and password for quick login
      if (user?.email) {
        await AsyncStorage.setItem('biometricEmail', user.email);
      }
      if (user?.employeeNumber) {
        await AsyncStorage.setItem('biometricEmployeeNumber', user.employeeNumber);
      }
      
      await AsyncStorage.setItem('biometricEnabled', 'true');
    } catch (error: any) {
      throw new Error(error.message || 'فشل تفعيل المصادقة الحيوية');
    }
  };

  const value: AuthContextType = {
    user,
    setUser,
    loading,
    isAuthenticated: !!user,
    biometricAvailable,
    biometricType,
    login,
    register,
    logout,
    loginWithBiometrics,
    loginWithFaceRecognition,
    enableBiometric,
    checkAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

