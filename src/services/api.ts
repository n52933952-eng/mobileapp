import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RNFS from 'react-native-fs';

// Backend base URL configuration
// Priority: 1. Environment variable, 2. Server URL
// 
// Set API_BASE_URL in your .env file or use default server URL
// For production: Use your server URL (e.g., 'https://your-server.com/api')
// For local development: Use 'http://10.0.2.2:5000/api' (Android Emulator) or 'http://localhost:5000/api' (iOS Simulator)

import { Platform } from 'react-native';

const API_BASE_URL = process.env.API_BASE_URL || 'https://work-spot-6.onrender.com/api';

console.log('🔗 API Base URL:', API_BASE_URL);
console.log('📱 Platform:', Platform.OS);
console.log('💡 TIP: Ensure your device can reach the hosted API at:', API_BASE_URL);

// Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Important for cookies
  timeout: 0, // No timeout - wait indefinitely for all requests
  maxContentLength: Infinity, // Allow large responses
  maxBodyLength: Infinity, // Allow large requests (for face embeddings)
});

// Request interceptor - Add token to requests
api.interceptors.request.use(
  async (config) => {
    try {
      if (!config.headers) {
        config.headers = {};
      }
      const token = await AsyncStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        console.log('🔑 API Request: Token attached to', config.url);
      } else {
        console.warn('⚠️ API Request: No token found for', config.url);
      }
      // Get cookies if available
      const cookies = await AsyncStorage.getItem('cookies');
      if (cookies) {
        config.headers.Cookie = cookies;
      }
      // Handle FormData - remove Content-Type to let axios set it with boundary
      if (config.data instanceof FormData) {
        console.log('📎 [API Interceptor] FormData detected, removing Content-Type header');
        delete config.headers['Content-Type'];
      }
    } catch (error) {
      console.error('Error getting token:', error);
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - Handle errors
api.interceptors.response.use(
  (response) => {
    // Save cookies if present
    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader) {
      AsyncStorage.setItem('cookies', setCookieHeader.join('; '));
    }
    return response;
  },
  async (error) => {
    // Better error logging for network issues
    if (error.code === 'ECONNABORTED' || error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
      console.error('❌ Network Error Details:');
      console.error('   - URL:', error.config?.url);
      console.error('   - Base URL:', API_BASE_URL);
      console.error('   - Full URL:', error.config?.baseURL + error.config?.url);
      console.error('   - Error Code:', error.code);
      console.error('   - Error Message:', error.message);
      console.error('💡 Troubleshooting:');
      console.error('   1. Is backend running? Check:', API_BASE_URL.replace('/api', '') + '/health');
      console.error('   2. Check your API_BASE_URL environment variable');
      console.error('   3. Check Windows Firewall allows port 5000');
      console.error('   4. Ensure device/emulator is on same network');
    }
    
    if (error.response?.status === 401) {
      // Don't clear token during login requests - token might be getting saved
      const isLoginRequest = error.config?.url?.includes('/login') || 
                            error.config?.url?.includes('/auth/login');
      
      if (!isLoginRequest) {
        // Only clear token for non-login requests (user is actually unauthorized)
        console.log('⚠️ API: 401 error on non-login request - clearing token');
        await AsyncStorage.multiRemove(['token', 'user', 'cookies']);
      } else {
        console.log('⚠️ API: 401 error during login - NOT clearing token (login might be in progress)');
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  register: async (data: {
    employeeNumber: string;
    email: string;
    password: string;
    fullName: string;
    department?: string;
    position?: string;
    faceImage?: string; // Base64 image
    biometricType?: string;
  }) => {
    const response = await api.post('/auth/register', data);
    if (response.data.token) {
      await AsyncStorage.setItem('token', response.data.token);
      // Remove profileImage base64 before saving to AsyncStorage (too large)
      const userForStorage = { ...response.data.user };
      if (userForStorage.profileImage && userForStorage.profileImage.startsWith('data:')) {
        delete userForStorage.profileImage; // Don't save base64 images to AsyncStorage
      }
      await AsyncStorage.setItem('user', JSON.stringify(userForStorage));
    }
    return response.data;
  },

  login: async (data: {
    email?: string;
    employeeNumber?: string;
    password: string;
  }) => {
    const response = await api.post('/auth/login', data);
    if (response.data.token) {
      await AsyncStorage.setItem('token', response.data.token);
      // Remove profileImage base64 before saving to AsyncStorage (too large)
      const userForStorage = { ...response.data.user };
      if (userForStorage.profileImage && userForStorage.profileImage.startsWith('data:')) {
        delete userForStorage.profileImage; // Don't save base64 images to AsyncStorage
      }
      await AsyncStorage.setItem('user', JSON.stringify(userForStorage));
    }
    return response.data;
  },

  logout: async () => {
    await api.post('/auth/logout', {});
    await AsyncStorage.multiRemove(['token', 'user', 'cookies']);
  },

  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },

  toggleFaceId: async (enabled: boolean) => {
    const response = await api.put('/auth/face-id', { enabled });
    return response.data;
  },

  // Complete registration with biometric data using FormData (faster with multer)
  completeRegistration: async (data: {
    employeeNumber: string;
    email: string;
    password: string;
    fullName: string;
    department?: string;
    position?: string;
    role?: string;
    profileImageUri?: string; // File URI (not base64)
    branch?: string;
    latitude?: number;
    longitude?: number;
    address?: string;
    streetName?: string;
    fingerprintPublicKey: string;
    faceImageUri?: string; // File URI (not base64)
    faceId: string;
    faceEmbedding?: number[];
    faceFeatures?: any;
    faceData?: any;
    biometricType: string;
  }) => {
    const startTime = Date.now();
    console.log('⏱️ Frontend: Sending registration request with FormData (multer)...');
    
    try {
      // Create FormData for multipart/form-data upload
      const formData = new FormData();
      
      // Add text fields
      formData.append('employeeNumber', data.employeeNumber);
      formData.append('email', data.email);
      formData.append('password', data.password);
      formData.append('fullName', data.fullName);
      if (data.department) formData.append('department', data.department);
      if (data.position) formData.append('position', data.position);
      if (data.role) formData.append('role', data.role);
      if (data.branch) formData.append('branch', data.branch);
      if (data.latitude) formData.append('latitude', data.latitude.toString());
      if (data.longitude) formData.append('longitude', data.longitude.toString());
      if (data.address) formData.append('address', data.address);
      if (data.streetName) formData.append('streetName', data.streetName);
      formData.append('fingerprintPublicKey', data.fingerprintPublicKey);
      formData.append('faceId', data.faceId);
      formData.append('biometricType', data.biometricType);
      
      // Add arrays/objects as JSON strings
      if (data.faceEmbedding) formData.append('faceEmbedding', JSON.stringify(data.faceEmbedding));
      if (data.faceFeatures) formData.append('faceFeatures', JSON.stringify(data.faceFeatures));
      if (data.faceData) formData.append('faceData', JSON.stringify(data.faceData));
      
      // Add image files (binary upload - much faster than base64!)
      // Convert content:// URIs to file:// URIs for React Native FormData
      if (data.profileImageUri) {
        let imageUri = data.profileImageUri;
        
        // If it's a content:// URI, copy to temporary file:// URI
        if (imageUri.startsWith('content://')) {
          try {
            const tempPath = `${RNFS.CachesDirectoryPath}/temp_profile_${Date.now()}.jpg`;
            await RNFS.copyFile(imageUri, tempPath);
            imageUri = `file://${tempPath}`;
            console.log('📤 Converted profile image from content:// to file://');
          } catch (error) {
            console.error('❌ Error copying profile image:', error);
            throw new Error('Failed to process profile image');
          }
        }
        
        // Check if file exists
        const filePath = imageUri.replace('file://', '');
        const fileExists = await RNFS.exists(filePath);
        if (!fileExists) {
          throw new Error('Profile image file not found');
        }
        
        formData.append('profileImage', {
          uri: imageUri,
          type: 'image/jpeg',
          name: 'profile.jpg',
        } as any);
        console.log('📤 Profile image added to FormData');
      }
      
      if (data.faceImageUri) {
        let imageUri = data.faceImageUri;
        
        // If it's a content:// URI, copy to temporary file:// URI
        if (imageUri.startsWith('content://')) {
          try {
            const tempPath = `${RNFS.CachesDirectoryPath}/temp_face_${Date.now()}.jpg`;
            await RNFS.copyFile(imageUri, tempPath);
            imageUri = `file://${tempPath}`;
            console.log('📤 Converted face image from content:// to file://');
          } catch (error) {
            console.error('❌ Error copying face image:', error);
            throw new Error('Failed to process face image');
          }
        }
        
        // Check if file exists
        const filePath = imageUri.replace('file://', '');
        const fileExists = await RNFS.exists(filePath);
        if (!fileExists) {
          throw new Error('Face image file not found');
        }
        
        formData.append('faceImage', {
          uri: imageUri,
          type: 'image/jpeg',
          name: 'face.jpg',
        } as any);
        console.log('📤 Face image added to FormData');
      }
      
      console.log('📤 FormData prepared, sending...');
      
      // Use fetch API for file uploads (more reliable than axios for FormData in React Native)
      // React Native's axios doesn't handle FormData with file URIs well
      const response = await fetch(`${API_BASE_URL}/auth/complete-registration`, {
        method: 'POST',
        headers: {
          // Don't set Content-Type - let fetch set it with boundary automatically
        },
        body: formData,
      });

      const requestTime = Date.now() - startTime;
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
        throw {
          message: errorData.message || `Request failed with status ${response.status}`,
          code: 'ERR_NETWORK',
          response: {
            status: response.status,
            statusText: response.statusText,
            data: errorData,
          },
        };
      }

      const responseData = await response.json();
      console.log(`✅ Frontend: Registration response received in ${requestTime}ms`);
      console.log('📥 Response status:', response.status);
      console.log('📥 Response has token?', !!responseData?.token);
      console.log('📥 Response has user?', !!responseData?.user);
      
      if (responseData.token) {
        await AsyncStorage.setItem('token', responseData.token);
        // Remove profileImage base64 before saving to AsyncStorage (too large)
        const userForStorage = { ...responseData.user };
        if (userForStorage.profileImage && userForStorage.profileImage.startsWith('data:')) {
          delete userForStorage.profileImage; // Don't save base64 images to AsyncStorage
        }
        await AsyncStorage.setItem('user', JSON.stringify(userForStorage));
      }
      return responseData;
    } catch (error: any) {
      const requestTime = Date.now() - startTime;
      console.error(`❌ Frontend: Registration failed after ${requestTime}ms`);
      console.error('❌ Error details:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
      });
      
      // If request took a long time (>25 seconds), backend might have processed it
      // Check if user was created by trying to login
      if (requestTime >= 25000 && (error.code === 'ECONNABORTED' || error.message === 'Network Error' || error.code === 'ERR_NETWORK')) {
        console.warn('⚠️ Request timed out, but backend might have processed it. User may have been created.');
        console.warn('💡 Suggestion: Try logging in with the credentials you just registered.');
        throw new Error('انتهت مهلة الاتصال، لكن الحساب قد يكون تم إنشاؤه. يرجى محاولة تسجيل الدخول.');
      }
      
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error('انتهت مهلة الاتصال. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
      }
      
      if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
        // Check if it's a quick failure (likely server down or unreachable)
        if (requestTime < 1000) {
          console.error('⚠️ Quick network failure - server might be down or unreachable');
          console.error('💡 Check if backend is running at:', API_BASE_URL.replace('/api', ''));
          console.error('💡 Try checking server health:', API_BASE_URL.replace('/api', '') + '/health');
        }
        throw new Error('فشل الاتصال بالخادم. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
      }
      
      throw error;
    }
  },

  loginWithBiometric: async (data: {
    faceId?: string; // Face ID (generated from landmarks) - NO IMAGE for privacy
    faceEmbedding?: number[]; // Face embedding (128-D array) - generated on-device (NEW - most accurate)
    faceImage?: string; // Base64 image (optional, fallback for backward compatibility)
    faceLandmarks?: any; // Raw ML Kit landmarks for verification (fallback)
    fingerprintPublicKey?: string; // Fingerprint public key for verification
    email?: string;
    employeeNumber?: string;
  }) => {
    // Remove undefined fields to avoid sending them to backend
    const cleanData: any = {};
    // Priority: faceEmbedding (most accurate) > faceId > faceImage
    if (data.faceEmbedding && Array.isArray(data.faceEmbedding) && data.faceEmbedding.length > 0) {
      cleanData.faceEmbedding = data.faceEmbedding;
    } else if (data.faceId) {
      cleanData.faceId = data.faceId;
    } else if (data.faceImage) {
      cleanData.faceImage = data.faceImage; // Fallback for backward compatibility
    }
    if (data.faceLandmarks) cleanData.faceLandmarks = data.faceLandmarks;
    if (data.fingerprintPublicKey) cleanData.fingerprintPublicKey = data.fingerprintPublicKey;
    if (data.email) cleanData.email = data.email;
    if (data.employeeNumber) cleanData.employeeNumber = data.employeeNumber;
    
    console.log('Login with biometric - sending data keys:', Object.keys(cleanData));
    console.log('Has fingerprintPublicKey:', !!cleanData.fingerprintPublicKey);
    console.log('Has faceId:', !!cleanData.faceId);
    console.log('Has faceEmbedding:', !!cleanData.faceEmbedding, cleanData.faceEmbedding ? `(${cleanData.faceEmbedding.length}-D array)` : '');
    console.log('Has faceImage:', !!cleanData.faceImage);
    console.log('Has faceLandmarks:', !!cleanData.faceLandmarks);
    
    // If only fingerprintPublicKey is provided (no face data), make sure face data is NOT sent
    if (cleanData.fingerprintPublicKey && !cleanData.faceEmbedding && !cleanData.faceId && !cleanData.faceImage && !cleanData.faceLandmarks) {
      // Explicitly ensure face data is not in the request (fingerprint-only login)
      delete cleanData.faceImage;
      delete cleanData.faceId;
      delete cleanData.faceEmbedding;
      delete cleanData.faceLandmarks;
      console.log('Fingerprint-only login - face data removed from request');
    }
    
    // Use fetch API instead of axios for better reliability
    const token = await AsyncStorage.getItem('token');
    const cookies = await AsyncStorage.getItem('cookies');
    
    console.log('📤 Sending biometric login request to /auth/login/biometric');
    console.log('📤 Request data summary:', JSON.stringify({
      hasFingerprint: !!cleanData.fingerprintPublicKey,
      fingerprintLength: cleanData.fingerprintPublicKey?.length || 0,
      fingerprintPreview: cleanData.fingerprintPublicKey ? cleanData.fingerprintPublicKey.substring(0, 100) + '...' : 'null',
      fingerprintEnd: cleanData.fingerprintPublicKey ? '...' + cleanData.fingerprintPublicKey.substring(cleanData.fingerprintPublicKey.length - 100) : 'null',
      hasFaceId: !!cleanData.faceId,
      faceIdValue: cleanData.faceId || 'null',
      hasFaceEmbedding: !!cleanData.faceEmbedding,
      faceEmbeddingLength: cleanData.faceEmbedding?.length || 0,
      faceEmbeddingType: cleanData.faceEmbedding ? (Array.isArray(cleanData.faceEmbedding) ? 'array' : typeof cleanData.faceEmbedding) : 'null',
      faceEmbeddingFirst3: cleanData.faceEmbedding && Array.isArray(cleanData.faceEmbedding) ? cleanData.faceEmbedding.slice(0, 3) : 'null',
      faceEmbeddingLast3: cleanData.faceEmbedding && Array.isArray(cleanData.faceEmbedding) ? cleanData.faceEmbedding.slice(-3) : 'null',
      hasEmail: !!cleanData.email,
      hasEmployeeNumber: !!cleanData.employeeNumber,
    }));
    
    // Log full faceEmbedding for debugging (first and last values)
    if (cleanData.faceEmbedding && Array.isArray(cleanData.faceEmbedding)) {
      console.log('🔍 FULL faceEmbedding being sent:');
      console.log('   Type:', typeof cleanData.faceEmbedding, 'IsArray:', Array.isArray(cleanData.faceEmbedding));
      console.log('   Length:', cleanData.faceEmbedding.length);
      console.log('   First 5 values:', cleanData.faceEmbedding.slice(0, 5));
      console.log('   Last 5 values:', cleanData.faceEmbedding.slice(-5));
      console.log('   Min value:', Math.min(...cleanData.faceEmbedding));
      console.log('   Max value:', Math.max(...cleanData.faceEmbedding));
    }
    
    // Log the actual fingerprint key being sent (for debugging)
    if (cleanData.fingerprintPublicKey) {
      console.log('🔍 FULL fingerprintPublicKey being sent:');
      console.log('   First 200 chars:', cleanData.fingerprintPublicKey.substring(0, 200));
      console.log('   Last 200 chars:', cleanData.fingerprintPublicKey.substring(Math.max(0, cleanData.fingerprintPublicKey.length - 200)));
      console.log('   Full length:', cleanData.fingerprintPublicKey.length);
    }
    
    const response = await fetch(`${API_BASE_URL}/auth/login/biometric`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        'Cookie': cookies || '',
      },
      body: JSON.stringify(cleanData),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
      console.error('❌ loginWithBiometric failed:', errorData);
      console.error('❌ Response status:', response.status);
      
      // If it's a fingerprint mismatch, log the key that was sent for comparison
      if (errorData.message?.includes('البصمة') || errorData.message?.includes('fingerprint') || errorData.message?.includes('not registered')) {
        console.error('❌ FINGERPRINT MISMATCH ERROR');
        console.error('❌ The key that was sent:');
        if (cleanData.fingerprintPublicKey) {
          console.error('   First 200 chars:', cleanData.fingerprintPublicKey.substring(0, 200));
          console.error('   Last 200 chars:', cleanData.fingerprintPublicKey.substring(Math.max(0, cleanData.fingerprintPublicKey.length - 200)));
          console.error('   Full length:', cleanData.fingerprintPublicKey.length);
        }
        console.error('❌ This key does NOT match what is in the database');
        console.error('💡 Check if the key in AsyncStorage matches what was saved during registration');
        console.error('💡 If keys don\'t match, you may need to re-register');
      }
      
      throw {
        message: errorData.message || `Request failed with status ${response.status}`,
        code: 'ERR_NETWORK',
        response: {
          status: response.status,
          statusText: response.statusText,
          data: errorData,
        },
      };
    }

    const responseData = await response.json();
    
    console.log('🔍 loginWithBiometric response keys:', Object.keys(responseData || {}));
    console.log('🔍 loginWithBiometric response has token?', !!responseData?.token);
    console.log('🔍 loginWithBiometric response has user?', !!responseData?.user);
    console.log('🔍 loginWithBiometric full response.data:', JSON.stringify({
      hasToken: !!responseData?.token,
      hasUser: !!responseData?.user,
      tokenLength: responseData?.token?.length || 0,
      userEmail: responseData?.user?.email || 'no email'
    }));
    
    if (!responseData?.token) {
      console.error('❌ CRITICAL: Backend did not return a token!');
      console.error('❌ Response data:', JSON.stringify(responseData, null, 2));
      throw new Error('الخادم لم يُرجع رمز التحقق. يرجى المحاولة مرة أخرى.');
    }
    
    // Save token with multiple retries
    let tokenSaved = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await AsyncStorage.setItem('token', responseData.token);
      const savedToken = await AsyncStorage.getItem('token');
      if (savedToken === responseData.token) {
        tokenSaved = true;
        console.log(`✅ Token saved successfully on attempt ${attempt}`);
        break;
      } else {
        console.warn(`⚠️ Token save attempt ${attempt} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    if (!tokenSaved) {
      console.error('❌ CRITICAL: Token save failed after 5 attempts!');
      throw new Error('فشل حفظ رمز التحقق. يرجى المحاولة مرة أخرى.');
    }
    
    // Final verification with multiple checks
    let finalToken = await AsyncStorage.getItem('token');
    console.log('✅ Token saved to AsyncStorage after biometric login');
    console.log('🔍 Final verified token exists:', !!finalToken, finalToken ? `(length: ${finalToken.length})` : '');
    
    // If token doesn't match, try saving again
    if (!finalToken || finalToken !== responseData.token) {
      console.warn('⚠️ Token verification failed - re-saving...');
      await AsyncStorage.setItem('token', responseData.token);
      // Wait a bit and check again
      await new Promise(resolve => setTimeout(resolve, 100));
      finalToken = await AsyncStorage.getItem('token');
      
      if (!finalToken || finalToken !== responseData.token) {
        console.error('❌ CRITICAL: Token verification failed after retry!');
        throw new Error('فشل التحقق من حفظ رمز التحقق. يرجى المحاولة مرة أخرى.');
      }
      console.log('✅ Token re-saved and verified');
    }
    
    // Remove profileImage base64 before saving to AsyncStorage (too large)
    const userForStorage = { ...responseData.user };
    if (userForStorage.profileImage && userForStorage.profileImage.startsWith('data:')) {
      delete userForStorage.profileImage; // Don't save base64 images to AsyncStorage
    }
    
    // Save user data
    await AsyncStorage.setItem('user', JSON.stringify(userForStorage));
    
    // Final check: verify both token and user are saved
    const verifyToken = await AsyncStorage.getItem('token');
    const verifyUser = await AsyncStorage.getItem('user');
    console.log('🔍 Final storage verification - Token:', !!verifyToken, 'User:', !!verifyUser);
    
    if (!verifyToken) {
      console.error('❌ CRITICAL: Token lost after user save!');
      // Last attempt to save token
      await AsyncStorage.setItem('token', responseData.token);
    }
    
    // Return the response data (not response.data - we're using fetch, not axios)
    console.log('✅ loginWithBiometric returning responseData with user:', responseData.user?.email || responseData.user?.employeeNumber);
    return responseData;
  },
};

// Attendance API
export const attendanceAPI = {
  checkIn: async (data: {
    latitude: number;
    longitude: number;
    address?: string;
    faceIdVerified?: boolean;
    qrCodeId?: string;
    faceId?: string | null;
    faceEmbedding?: number[] | null; // Face embedding (128-D array) - generated on-device
    faceImage?: string | null; // Face image (base64) - for backward compatibility
    faceLandmarks?: any; // Fallback to landmarks if embedding/image not available
  }) => {
    const startTime = Date.now();
    console.log('⏱️ Frontend: Sending check-in request...');
    console.log('📤 Request payload size:', JSON.stringify(data).length, 'bytes');
    try {
      const response = await api.post('/attendance/checkin', data, {
        maxContentLength: Infinity, // Allow large responses
        maxBodyLength: Infinity, // Allow large requests
      });
      const requestTime = Date.now() - startTime;
      console.log(`✅ Frontend: Check-in response received in ${requestTime}ms`);
      console.log('📥 Response status:', response.status);
      console.log('📥 Response data keys:', Object.keys(response.data || {}));
      console.log('📥 Response message:', response.data?.message || 'no message');
      return response.data;
    } catch (error: any) {
      const requestTime = Date.now() - startTime;
      console.error(`❌ Frontend: Check-in failed after ${requestTime}ms`);
      console.error('❌ Error details:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          timeout: error.config?.timeout,
        }
      });
      
      // Better error messages
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        // If backend processed successfully but response timed out, it might have succeeded
        if (requestTime >= 29000) { // Close to timeout
          console.warn('⚠️ Request timed out, but backend might have processed it. Check backend logs.');
        }
        throw new Error('انتهت مهلة الاتصال. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
      }
      
      if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
        throw new Error('فشل الاتصال بالخادم. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
      }
      
      throw error;
    }
  },

  checkOut: async (data: {
    latitude: number;
    longitude: number;
    address?: string;
    faceIdVerified?: boolean;
    qrCodeId?: string;
    faceId?: string | null;
    faceEmbedding?: number[] | null; // Face embedding (128-D array) - generated on-device
    faceImage?: string | null; // Face image (base64) - for backward compatibility
    faceLandmarks?: any; // Fallback to landmarks if embedding/image not available
  }) => {
    const startTime = Date.now();
    console.log('⏱️ Frontend: Sending check-out request...');
    try {
      const response = await api.post('/attendance/checkout', data, {
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      const requestTime = Date.now() - startTime;
      console.log(`✅ Frontend: Check-out response received in ${requestTime}ms`);
      return response.data;
    } catch (error: any) {
      const requestTime = Date.now() - startTime;
      console.error(`❌ Frontend: Check-out failed after ${requestTime}ms:`, error.message);
      
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error('انتهت مهلة الاتصال. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
      }
      
      if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
        throw new Error('فشل الاتصال بالخادم. يرجى التحقق من الاتصال بالإنترنت والمحاولة مرة أخرى.');
      }
      
      throw error;
    }
  },

  getToday: async () => {
    const response = await api.get('/attendance/today');
    return response.data;
  },

  getMonthly: async (year?: number, month?: number) => {
    const params: any = {};
    if (year) params.year = year;
    if (month) params.month = month;
    const response = await api.get('/attendance/monthly', { params });
    return response.data;
  },

  getWeekly: async (startDate: string, endDate: string) => {
    const response = await api.get('/attendance/weekly', {
      params: {
        startDate,
        endDate,
      },
    });
    return response.data;
  },
};

// Holiday API
export const holidayAPI = {
  getHolidays: async (year?: number) => {
    const params: any = {};
    if (year) params.year = year;
    const response = await api.get('/holidays', { params });
    return response.data;
  },

  getUpcoming: async () => {
    const response = await api.get('/holidays/upcoming');
    return response.data;
  },

  getCalendar: async (year?: number, month?: number) => {
    const params: any = {};
    if (year) params.year = year;
    if (month) params.month = month;
    const response = await api.get('/holidays/calendar', { params });
    return response.data;
  },

  checkByDate: async (date: string) => {
    const response = await api.get(`/holidays/check/${date}`);
    return response.data;
  },
};

// Leave API
export const leaveAPI = {
  // Get user's leaves
  getMyLeaves: async () => {
    const response = await api.get('/leaves/my');
    return response.data;
  },

  // Create leave request
  createLeave: async (data: {
    type: 'annual' | 'sick' | 'emergency' | 'unpaid' | 'half-day';
    startDate: string;
    endDate: string;
    reason: string;
    attachments?: Array<{ url: string; filename: string }>;
    pdfFile?: { uri: string; name: string; type: string; size: number } | null;
  }) => {
    // If PDF file is provided, use FormData and fetch API
    if (data.pdfFile) {
      console.log('📎 [API] Creating FormData for PDF upload');
      console.log('  - PDF URI:', data.pdfFile.uri);
      console.log('  - PDF Name:', data.pdfFile.name);
      console.log('  - PDF Type:', data.pdfFile.type);
      console.log('  - PDF Size:', data.pdfFile.size);

      const formData = new FormData();
      
      // Add text fields
      formData.append('type', data.type);
      formData.append('startDate', data.startDate);
      formData.append('endDate', data.endDate);
      formData.append('reason', data.reason);

      // Check if file exists
      const filePath = data.pdfFile.uri.replace('file://', '');
      const fileExists = await RNFS.exists(filePath);
      if (!fileExists) {
        throw new Error('PDF file not found');
      }

      // Add PDF file
      formData.append('attachment', {
        uri: data.pdfFile.uri,
        type: data.pdfFile.type || 'application/pdf',
        name: data.pdfFile.name || 'document.pdf',
      } as any);

      console.log('📤 [API] Sending FormData POST request to /leaves');

      // Use fetch API for file uploads (more reliable than axios for FormData in React Native)
      const token = await AsyncStorage.getItem('token');
      const cookies = await AsyncStorage.getItem('cookies');
      
      const response = await fetch(`${API_BASE_URL}/leaves`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Cookie': cookies || '',
          // Don't set Content-Type - let fetch set it with boundary
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
      }

      return await response.json();
    } else {
      // No PDF file - use regular axios request
      const response = await api.post('/leaves', data);
      return response.data;
    }
  },

  // Cancel leave request
  cancelLeave: async (id: string) => {
    const response = await api.delete(`/leaves/${id}`);
    return response.data;
  },
};

// Announcements API
export const announcementAPI = {
  getMy: async (params?: { type?: string }) => {
    const response = await api.get('/announcements/my', { params });
    return response.data;
  },
};

export default api;

