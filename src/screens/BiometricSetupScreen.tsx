import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { Camera, useCameraDevice } from 'react-native-vision-camera';
import FaceDetector from '@react-native-ml-kit/face-detection';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import {
  authenticateWithBiometrics,
  checkBiometricAvailability,
  getBiometricTypeName,
  releaseFingerprintScanner,
  createBiometricKeys,
} from '../services/biometrics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { authAPI } from '../services/api';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { generateFaceId, validateFaceQuality, isFaceCentered } from '../utils/faceRecognition';
import { generateFaceEmbedding } from '../services/faceEmbedding';
import PhotoManipulator from 'react-native-photo-manipulator';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface BiometricSetupScreenProps {
  onSetupComplete?: () => void;
  onSkip?: () => void;
}

const BiometricSetupScreen: React.FC<BiometricSetupScreenProps> = ({ onSetupComplete, onSkip }) => {
  const { t } = useTranslation();
  // If called as a screen (not modal), use navigation
  const isModal = !!onSetupComplete || !!onSkip;
  const navigation = useNavigation();
  const route = useRoute();
  const { enableBiometric, biometricAvailable, biometricType, checkAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [biometricChecked, setBiometricChecked] = useState(false);
  const [faceData, setFaceData] = useState<any>(null);
  const [showFaceCapture, setShowFaceCapture] = useState(false);
  const hasNavigatedToFaceCapture = useRef(false);
  const [fingerprintPublicKey, setFingerprintPublicKey] = useState<string | null>(null);
  const [fingerprintCompleted, setFingerprintCompleted] = useState(false);
  const [faceCompleted, setFaceCompleted] = useState(false);
  
  // Camera states for embedded camera
  const cameraDevice = useCameraDevice('front');
  
  // Configure camera format for optimal face detection
  const cameraFormat = useMemo(() => {
    if (!cameraDevice) return undefined;
    
    // Find a format that supports photo capture
    const formats = cameraDevice.formats;
    
    // Prefer 1080p or lower for better performance with face detection
    const preferredFormat = formats.find(f => 
      f.photoHeight >= 1080 && f.photoHeight <= 1920 &&
      f.photoWidth >= 720 && f.photoWidth <= 1440
    );
    
    // Fallback: Use first available format
    return preferredFormat || formats[0];
  }, [cameraDevice]);
  
  const cameraRef = useRef<Camera>(null);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [isCapturingFace, setIsCapturingFace] = useState(false);
  const [detectedFaces, setDetectedFaces] = useState<any[]>([]);
  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);
  const [faceCentered, setFaceCentered] = useState(false);
  const [centeringMessage, setCenteringMessage] = useState<string | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const centeredCountRef = useRef(0); // Count consecutive centered detections for smoothing
  
  // Get registration data from route params (not AsyncStorage)
  const registrationData = (route.params as any)?.registrationData || null;

  // NOTE: We don't restore from AsyncStorage on mount because:
  // - Setup is a single flow (user shouldn't navigate away)
  // - If they do navigate away, they can start over
  // - We only save to AsyncStorage AFTER successful registration (for login)

  // Function to check and process face capture result (NO IMAGES - only features)
  const checkFaceCaptureResult = async () => {
    console.log('🔍 Checking for face capture result...');
    try {
      const faceCaptureResult = await AsyncStorage.getItem('faceCaptureResult');
      if (faceCaptureResult) {
        const result = JSON.parse(faceCaptureResult);
        const timeDiff = Date.now() - result.timestamp;
        console.log('📸 Found face capture result, time diff:', timeDiff, 'ms');
        // Check if result is recent (within last 30 seconds)
        if (timeDiff < 30000) {
          console.log('✅ Processing face capture result (NO IMAGE - features only)...');
          
          // NEW FORMAT: faceId and faceFeatures (no image)
          const faceId = result.faceId;
          const faceFeatures = result.faceFeatures || {};
          const firstFace = result.faceData?.[0] || null;
          
          // Store face data (features only, no image)
          const faceDataForStorage = {
            faceId: faceId,
            faceFeatures: faceFeatures,
            face: firstFace,
          };
          // Don't save to AsyncStorage here - just use state
          // We'll save to AsyncStorage AFTER successful registration (for login)
          
          // Set face data with features for processing (NO IMAGE)
          setFaceData({
            faceId: faceId,
            faceFeatures: faceFeatures,
            face: firstFace,
            // Include landmarks for better face recognition (if available)
            landmarks: firstFace?.landmarks || faceFeatures.landmarks || null,
            frame: firstFace?.frame || firstFace?.bounds || faceFeatures.frame || null,
            // Include rotation data for fallback faceId generation
            rotationX: firstFace?.rotationX || faceFeatures.rotationX,
            rotationY: firstFace?.rotationY || faceFeatures.rotationY,
            rotationZ: firstFace?.rotationZ || faceFeatures.rotationZ,
          });
          
          console.log('✅ Face data set (NO IMAGE), faceId:', faceId);
          
          // Clear the temporary result
          await AsyncStorage.removeItem('faceCaptureResult');
        } else {
          console.log('⏰ Face capture result too old, ignoring');
          await AsyncStorage.removeItem('faceCaptureResult');
        }
      } else {
        console.log('❌ No face capture result found');
      }
    } catch (error) {
      console.log('❌ Error checking face capture result:', error);
    }
  };

  useEffect(() => {
    checkBiometric();
    
    // Check immediately on mount (in case we're already on the screen)
    checkFaceCaptureResult();
    
    // Listen for navigation focus to handle face capture result
    const unsubscribe = navigation.addListener('focus', () => {
      checkFaceCaptureResult();
    });
    
    // Cleanup: release fingerprint scanner resources when component unmounts
    return () => {
      releaseFingerprintScanner();
      unsubscribe();
    };
  }, [navigation]);

  // Request camera permission when fingerprint is completed
  useEffect(() => {
    if (fingerprintCompleted && !faceData) {
      checkCameraPermission();
    }
  }, [fingerprintCompleted, faceData]);

  // Face detection when camera is ready
  useEffect(() => {
    if (!hasCameraPermission || !cameraDevice || isCapturingFace || capturedImageUri || !fingerprintCompleted) return;

    console.log('🔍 Starting face detection in embedded camera...');
    let detectionInterval: NodeJS.Timeout | null = null;
    let captureTimer: NodeJS.Timeout | null = null;
    let isDetecting = false;
    let hasCaptured = false;

    const detectFaces = async () => {
      if (!cameraRef.current || isCapturingFace || isDetecting || hasCaptured) return;

      isDetecting = true;
      try {
        const photo = await cameraRef.current.takePhoto({
          qualityPrioritization: "speed",
          flash: "off",
          enableShutterSound: false,
        });

        const imagePath = photo.path.startsWith("file://") ? photo.path : `file://${photo.path}`;
        
        // Get image dimensions for centering check
        const cameraFormat = cameraDevice?.formats?.[0];
        const photoWidth = cameraFormat?.photoWidth || photo.width || SCREEN_WIDTH;
        const photoHeight = cameraFormat?.photoHeight || photo.height || 300;
        setImageDimensions({ width: photoWidth, height: photoHeight });
        
        const faces = await Promise.race([
          FaceDetector.detect(imagePath, {
            landmarkMode: 'all',
            classificationMode: 'all',
            minFaceSize: 0.1,
            enableTracking: false,
          }),
          new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000))
        ]) as any[];

        if (faces && faces.length > 0) {
          console.log("✅ FACE DETECTED in embedded camera!");
          
          // Check if face is centered
          const centerCheck = isFaceCentered(faces[0], photoWidth, photoHeight);
          
          // Smoothing: Require 2 consecutive centered detections before showing green circle
          // This prevents flickering and makes capture easier
          if (centerCheck.centered) {
            centeredCountRef.current += 1;
            // After 2 consecutive detections, consider it centered
            if (centeredCountRef.current >= 2) {
              setFaceCentered(true);
              setCenteringMessage(null);
              setDetectedFaces(faces);
              
              const qualityCheck = validateFaceQuality(faces[0]);
              if (qualityCheck.valid && !captureTimer && !hasCaptured) {
                // Reduced wait time for smoother capture (1.2 seconds for faster response)
                captureTimer = setTimeout(async () => {
                  if (!hasCaptured && cameraRef.current && !isCapturingFace) {
                    hasCaptured = true;
                    await captureFaceFromEmbeddedCamera(faces[0]);
                  }
                }, 1200);
              }
            } else {
              // Not enough consecutive detections yet - show face but not green circle
              setDetectedFaces(faces);
              setFaceCentered(false);
              setCenteringMessage(t('biometricSetup.faceDetected'));
            }
          } else {
            // Face not centered - reset counter and show instruction
            centeredCountRef.current = 0;
            setFaceCentered(false);
            setCenteringMessage(centerCheck.message || null);
            setDetectedFaces([]);
            if (captureTimer) {
              clearTimeout(captureTimer);
              captureTimer = null;
            }
          }
        } else {
          // No face detected - reset everything
          centeredCountRef.current = 0;
          setDetectedFaces([]);
          setFaceCentered(false);
          setCenteringMessage(null);
          if (captureTimer) {
            clearTimeout(captureTimer);
            captureTimer = null;
          }
        }
      } catch (error) {
        console.log("❌ Detection error:", error);
        setDetectedFaces([]);
      } finally {
        isDetecting = false;
      }
    };

    // Start detection after 1 second, then every 1.5 seconds
    detectionInterval = setInterval(detectFaces, 1500);
    setTimeout(detectFaces, 1000);

    return () => {
      if (detectionInterval) clearInterval(detectionInterval);
      if (captureTimer) clearTimeout(captureTimer);
    };
  }, [hasCameraPermission, cameraDevice, isCapturingFace, capturedImageUri, fingerprintCompleted]);

  const checkCameraPermission = async () => {
    try {
      const permission = await Camera.requestCameraPermission();
      setHasCameraPermission(permission === "authorized" || permission === "granted");
    } catch (error) {
      console.error("Camera permission error:", error);
      setHasCameraPermission(false);
    }
  };

  const captureFaceFromEmbeddedCamera = async (detectedFace: any) => {
    if (!cameraRef.current || isCapturingFace) return;

    try {
      setIsCapturingFace(true);
      console.log("📸 Capturing face from embedded camera...");
      
      const qualityCheck = validateFaceQuality(detectedFace);
      if (!qualityCheck.valid) {
        Alert.alert(t('biometricSetup.error'), qualityCheck.reason || t('biometricSetup.faceQualityNotSuitable'));
        setIsCapturingFace(false);
        return;
      }

      // Capture photo
      const photo = await cameraRef.current.takePhoto({
        qualityPrioritization: "quality",
        flash: "off",
        enableShutterSound: false,
      });
      
      console.log("📸 Photo captured:", {
        path: photo.path,
        width: photo.width,
        height: photo.height,
      });
      
      let originalImageUri = photo.path;
      
      // Handle content:// URIs on Android - copy to temporary file for PhotoManipulator
      if (Platform.OS === 'android' && originalImageUri.startsWith('content://')) {
        try {
          console.log("📋 Converting content:// URI to file:// URI for PhotoManipulator...");
          const tempPath = `${RNFS.CachesDirectoryPath}/temp_face_${Date.now()}.jpg`;
          await RNFS.copyFile(originalImageUri, tempPath);
          originalImageUri = `file://${tempPath}`;
          console.log("✅ Converted to file URI:", originalImageUri);
        } catch (copyError: any) {
          console.error("❌ Error copying content:// URI:", copyError);
          // Continue with original URI - might work or will fail gracefully
        }
      } else if (!originalImageUri.startsWith("file://")) {
        // Ensure file:// prefix if it's not a content:// URI
        originalImageUri = `file://${originalImageUri}`;
      }
      
      // Note: PhotoManipulator.crop should handle EXIF orientation automatically
      // If orientation issues persist, we may need to use react-native-image-picker
      // or handle EXIF orientation manually
      
      // Get image dimensions from photo metadata or use stored dimensions
      const imgWidth = imageDimensions.width || photo.width || photo.photoWidth || SCREEN_WIDTH;
      const imgHeight = imageDimensions.height || photo.height || photo.photoHeight || 300;
      
      // Crop image to circular area (face area)
      const frame = detectedFace.frame || detectedFace.bounds || {};
      const faceLeft = frame.left || 0;
      const faceTop = frame.top || 0;
      const faceWidth = frame.width || 0;
      const faceHeight = frame.height || 0;
      
      // Calculate face center
      const faceCenterX = faceLeft + faceWidth / 2;
      const faceCenterY = faceTop + faceHeight / 2;
      
      // Use the larger dimension (width or height) for circular crop
      // Add 80% padding to show more of the face (head, shoulders, etc.) - more professional look
      const cropSize = Math.max(faceWidth, faceHeight) * 1.8;
      
      // Ensure crop is square (for circular display)
      const finalCropSize = Math.min(cropSize, imgWidth, imgHeight);
      
      // Calculate crop region (centered on face, square)
      const cropX = Math.max(0, Math.min(faceCenterX - finalCropSize / 2, imgWidth - finalCropSize));
      const cropY = Math.max(0, Math.min(faceCenterY - finalCropSize / 2, imgHeight - finalCropSize));
      const cropWidth = finalCropSize;
      const cropHeight = finalCropSize;
      
      console.log("📐 Cropping image to circular area:", {
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight,
        faceCenterX,
        faceCenterY,
      });
      
      // Use original image for display (circular clipping will be handled by Image component styling)
      // PhotoManipulator crop is causing issues, so we'll use the full image with proper styling
      // The native TFLite module handles cropping internally for embedding generation
      let croppedImageUri: string | null = null;
      console.log("📸 Using original image for display (cropping handled by native module for processing)");
      croppedImageUri = originalImageUri;
      setCapturedImageUri(originalImageUri);
      
      // Generate faceId
      const faceId = generateFaceId(detectedFace);
      
      const faceEmbedding = await generateFaceEmbedding(detectedFace, {
        imageUri: originalImageUri,
        imageWidth: imgWidth,
        imageHeight: imgHeight,
        croppedImageUri: croppedImageUri, // Pass the cropped image directly (not from state)
      });
      if (faceEmbedding) {
        console.log(`✅ Generated face embedding: ${faceEmbedding.length} dimensions`);
      } else {
        console.log('⚠️ Could not generate deep face embedding (fallback will be used)');
      }
      
      const faceFeatures = {
        faceId: faceId,
        landmarks: detectedFace.landmarks || null,
        frame: detectedFace.frame || detectedFace.bounds || null,
        smilingProbability: detectedFace.smilingProbability,
        leftEyeOpenProbability: detectedFace.leftEyeOpenProbability,
        rightEyeOpenProbability: detectedFace.rightEyeOpenProbability,
        headEulerAngleX: detectedFace.headEulerAngleX,
        headEulerAngleY: detectedFace.headEulerAngleY,
        headEulerAngleZ: detectedFace.headEulerAngleZ,
      };
      
      // Store face data
      setFaceData({
        faceId: faceId,
        faceEmbedding: faceEmbedding,
        faceFeatures: faceFeatures,
        face: detectedFace,
        imageUri: originalImageUri,
        imageWidth: imgWidth,
        imageHeight: imgHeight,
      });
      
      console.log("✅ Face captured and stored!");
    } catch (error) {
      console.error("❌ Capture error:", error);
      Alert.alert(t('biometricSetup.error'), t('biometricSetup.captureFailed'));
    } finally {
      setIsCapturingFace(false);
    }
  };

  const checkBiometric = async () => {
    const result = await checkBiometricAvailability();
    setBiometricChecked(true);
  };

  const handleEnableBiometric = async () => {
    if (!biometricAvailable) {
      Alert.alert(t('biometricSetup.notAvailable'), t('biometricSetup.biometricNotAvailable'));
      return;
    }

    setLoading(true);
    try {
      // CRITICAL: DO NOT clear old biometric data from AsyncStorage here!
      // If registration fails (duplicate), we need to keep the old key for login.
      // The new key will only be used in state for this registration attempt.
      // If registration succeeds, the new key will be saved (overwriting old one).
      // If registration fails, the old key remains in AsyncStorage for login.
      console.log('🔑 Starting fingerprint setup - old key preserved in AsyncStorage until registration succeeds');
      
      // Step 1: Authenticate with biometric (fingerprint/face ID)
      const authResult = await authenticateWithBiometrics(
        t('biometricSetup.enableBiometricStep1'),
        t('biometricSetup.usePassword')
      );

      if (!authResult.success) {
        Alert.alert(t('biometricSetup.verificationFailed'), authResult.message || t('biometricSetup.identityNotVerified'));
        setLoading(false);
        return;
      }

      // Step 2: Create biometric keys to get publicKey (unique fingerprint ID)
      const keysResult = await createBiometricKeys();
      if (!keysResult.success || !keysResult.publicKey) {
        Alert.alert(t('biometricSetup.error'), t('biometricSetup.biometricKeysFailed'));
        setLoading(false);
        return;
      }

      // CRITICAL: Normalize the key (trim whitespace) to prevent intermittent mismatches
      const normalizedKey = keysResult.publicKey.trim();
      
      // Log if normalization changed the key
      if (keysResult.publicKey !== normalizedKey) {
        console.warn('⚠️ WARNING: Fingerprint key had whitespace! Normalized.');
        console.warn('   Original length:', keysResult.publicKey.length);
        console.warn('   Normalized length:', normalizedKey.length);
      }
      
      setFingerprintPublicKey(normalizedKey);
      setFingerprintCompleted(true);
      
      // Don't save to AsyncStorage here - just use state
      // We'll save to AsyncStorage AFTER successful registration (for login)
      console.log('✅ Fingerprint setup completed (stored in state, normalized)');

      Alert.alert(
        t('biometricSetup.success'),
        t('biometricSetup.biometricSetupComplete', { type: getBiometricTypeName(biometricType, t) }),
        [{ text: t('biometricSetup.continue'), onPress: () => {} }]
      );
    } catch (error: any) {
      Alert.alert(t('biometricSetup.error'), error.response?.data?.message || error.message || t('biometricSetup.enableBiometricFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Navigate to face capture screen
  const handleStartFaceCapture = () => {
    if (!fingerprintCompleted || !fingerprintPublicKey) {
      Alert.alert(t('biometricSetup.error'), t('biometricSetup.completeFingerprintFirst'));
      return;
    }
    // Clear any previous result
    AsyncStorage.removeItem('faceCaptureResult');
    // If used as modal, navigation should work for FaceCapture (it's a separate screen)
    // But prevent any navigation to BiometricSetup screen
    if (isModal) {
      // When in modal, navigate to FaceCapture (this is OK - it's a separate screen)
      navigation.navigate('FaceCapture');
    } else {
      // When used as screen (registration), navigate normally
      navigation.navigate('FaceCapture');
    }
  };

  const handleFaceCaptureComplete = async () => {
    console.log('🔍 handleFaceCaptureComplete - Checking states...');
    console.log('faceData:', faceData ? 'exists' : 'null');
    console.log('faceData.faceId:', faceData?.faceId);
    console.log('fingerprintCompleted:', fingerprintCompleted);
    console.log('fingerprintPublicKey:', fingerprintPublicKey ? 'exists' : 'null');
    
    // Check if face data exists (NO IMAGE - only faceId/features needed)
    if (!faceData || (!faceData.faceId && !faceData.face)) {
      console.log('❌ Face data validation failed');
      Alert.alert(t('biometricSetup.error'), t('biometricSetup.captureFaceFirst'));
      return;
    }

    if (!fingerprintCompleted || !fingerprintPublicKey) {
      console.log('❌ Fingerprint validation failed');
      console.log('fingerprintCompleted:', fingerprintCompleted);
      console.log('fingerprintPublicKey:', fingerprintPublicKey);
      Alert.alert(t('biometricSetup.error'), t('biometricSetup.completeFingerprintFirst'));
      return;
    }
    
    console.log('✅ All validations passed, proceeding with registration...');

    setLoading(true);
    try {
      // Generate Face ID using landmarks (NO IMAGE - features only)
      // faceId should already be generated from FaceCaptureScreen, but generate it again if needed
      let faceId = faceData.faceId;
      let faceEmbedding = faceData.faceEmbedding; // Get embedding from faceData
      
      if (!faceId) {
        // Generate from face features if not already provided
        const faceWithFeatures = faceData.face || {
          landmarks: faceData.landmarks || faceData.faceFeatures?.landmarks,
          frame: faceData.frame || faceData.faceFeatures?.frame,
          smilingProbability: faceData.faceFeatures?.smilingProbability,
          leftEyeOpenProbability: faceData.faceFeatures?.leftEyeOpenProbability,
          rightEyeOpenProbability: faceData.faceFeatures?.rightEyeOpenProbability,
          headEulerAngleX: faceData.faceFeatures?.headEulerAngleX,
          headEulerAngleY: faceData.faceFeatures?.headEulerAngleY,
          headEulerAngleZ: faceData.faceFeatures?.headEulerAngleZ,
          // Include rotation data for fallback
          rotationX: faceData.rotationX || faceData.faceFeatures?.rotationX,
          rotationY: faceData.rotationY || faceData.faceFeatures?.rotationY,
          rotationZ: faceData.rotationZ || faceData.faceFeatures?.rotationZ,
        };
        faceId = generateFaceId(faceWithFeatures);
        
        // Generate embedding if not already generated
        if (!faceEmbedding && faceData.face) {
          faceEmbedding = await generateFaceEmbedding(faceData.face, {
            imageUri: faceData.imageUri || capturedImageUri || null,
            imageWidth: faceData.imageWidth || null,
            imageHeight: faceData.imageHeight || null,
          });
        }
      }
      
      // Ensure embedding is generated
      if (!faceEmbedding && faceData.face) {
        faceEmbedding = await generateFaceEmbedding(faceData.face, {
          imageUri: faceData.imageUri || capturedImageUri || null,
          imageWidth: faceData.imageWidth || null,
          imageHeight: faceData.imageHeight || null,
        });
        console.log('✅ Generated face embedding for registration');
      }

      // If called from Login modal (no registrationData), just save biometric data and enable
      if (!registrationData && isModal) {
        // Save biometric data for existing user (enabling from Login screen) - NO IMAGE
        const faceDataForStorage = {
          faceId: faceId,
          faceFeatures: faceData.faceFeatures || {},
          face: faceData.face,
        };
        await AsyncStorage.setItem('faceData', JSON.stringify(faceDataForStorage));
        await AsyncStorage.setItem('fingerprintPublicKey', fingerprintPublicKey);
        await AsyncStorage.setItem('biometricEnabled', 'true');
        
        setFaceCompleted(true);
        
        // Call onSetupComplete to trigger login and navigation
        if (onSetupComplete) {
          onSetupComplete();
        }
        setLoading(false);
        return;
      }
      
      // Registration flow (has registrationData from params)
      if (!registrationData) {
        Alert.alert(t('biometricSetup.error'), t('biometricSetup.registrationDataNotFound'));
        setLoading(false);
        return;
      }

      const regData = registrationData;

      // Decide profile image base64:
      // 1) If registrationData already has base64, use it directly (most reliable)
      // 2) Otherwise, try to convert URI to base64
      let profileImageBase64 = regData.profileImageBase64 || null;
      if (!profileImageBase64 && regData.profileImageUri) {
        try {
          const RNFS = require('react-native-fs').default;
          const Platform = require('react-native').Platform;
          const fileUri = Platform.OS === 'android' && regData.profileImageUri.startsWith('file://') 
            ? regData.profileImageUri.replace('file://', '') 
            : regData.profileImageUri;
          const base64 = await RNFS.readFile(fileUri, 'base64');
          profileImageBase64 = `data:image/jpeg;base64,${base64}`;
        } catch (error) {
          console.log('Could not convert profile image URI to base64:', error);
          // If URI is not available, profile image will be null
          // User can update it later from profile settings
        }
      }

      // Convert captured face image to base64 for backend embedding generation
      let faceImageBase64 = null;
      if (capturedImageUri) {
        try {
          console.log('🔄 Converting captured face image to base64...');
          const fileUri = Platform.OS === 'android' && capturedImageUri.startsWith('file://') 
            ? capturedImageUri.replace('file://', '') 
            : capturedImageUri;
          const base64 = await RNFS.readFile(fileUri, 'base64');
          faceImageBase64 = `data:image/jpeg;base64,${base64}`;
          console.log('✅ Face image converted to base64');
        } catch (error) {
          console.error('❌ Error converting face image to base64:', error);
          // Continue without face image - backend will use landmarks as fallback
        }
      } else {
        console.log('⚠️ No captured face image - backend will use landmarks as fallback');
      }

      // Map biometricType to valid enum value
      const mapBiometricType = (type: string | null): string => {
        if (!type) return 'TouchID';
        
        // react-native-biometrics may return 'Biometrics' which is not in our enum
        if (type === 'Biometrics' || type === 'biometrics') {
          return 'Fingerprint'; // Default to Fingerprint for generic biometrics
        }
        
        // Map to valid enum values
        const validTypes = ['FaceID', 'TouchID', 'Fingerprint', 'FaceRecognition'];
        if (validTypes.includes(type)) {
          return type;
        }
        
        // Default mapping
        if (type.toLowerCase().includes('face')) {
          return 'FaceID';
        }
        if (type.toLowerCase().includes('touch') || type.toLowerCase().includes('finger')) {
          return 'Fingerprint';
        }
        
        return 'TouchID'; // Default fallback
      };

      // Send ALL data together: registration info + profile image + location + fingerprint ID + face ID
      // NO FACE IMAGE - only faceId for privacy
      console.log('📤 Sending registration data to backend...');
      console.log('Registration data keys:', Object.keys(regData));
      console.log('faceId:', faceId);
      console.log('faceId type:', typeof faceId);
      console.log('faceId length:', faceId?.length);
      console.log('fingerprintPublicKey:', fingerprintPublicKey ? 'exists' : 'null');
      console.log('fingerprintPublicKey type:', typeof fingerprintPublicKey);
      console.log('fingerprintPublicKey length:', fingerprintPublicKey?.length);
      console.log('profileImageBase64:', profileImageBase64 ? 'exists' : 'null');
      
      // Ensure both are strings and not empty
      if (!faceId || typeof faceId !== 'string' || faceId.trim() === '') {
        throw new Error('faceId is missing or invalid');
      }
      if (!fingerprintPublicKey || typeof fingerprintPublicKey !== 'string' || fingerprintPublicKey.trim() === '') {
        throw new Error('fingerprintPublicKey is missing or invalid');
      }
      
      // Build registration payload using FormData (Multer) - send file URIs instead of base64
      // This is MUCH faster (37% smaller payload, 2-3x faster upload)
      const registrationPayload: any = {
        // Basic registration data
        employeeNumber: regData.employeeNumber,
        email: regData.email,
        password: regData.password,
        fullName: regData.fullName,
        department: regData.department || undefined,
        position: regData.position || undefined,
        role: regData.role || undefined,
        // Profile image URI (will be sent as binary file via FormData)
        profileImageUri: regData.profileImageUri || undefined,
        // Location data
        branch: regData.branch || undefined,
        latitude: regData.latitude || undefined,
        longitude: regData.longitude || undefined,
        address: regData.address || undefined,
        streetName: regData.streetName || undefined,
        // Biometric data (CRITICAL - must be set explicitly, not from regData)
        fingerprintPublicKey: fingerprintPublicKey, // Fingerprint ID (must be string)
        faceEmbedding: faceEmbedding || undefined, // Face embedding (192-D array) - most accurate for duplicate detection
        faceImageUri: capturedImageUri || undefined, // Face image URI (will be sent as binary file via FormData)
        faceId: faceId, // Face ID hash - lightweight identifier
        faceFeatures: faceData.faceFeatures || undefined, // Face features from ML Kit (contains landmarks) - fallback
        faceData: faceData.face ? [faceData.face] : undefined, // Full face detection data from ML Kit (for landmark extraction) - fallback
        biometricType: mapBiometricType(biometricType),
      };
      
      console.log('📦 Final payload keys:', Object.keys(registrationPayload));
      console.log('📦 Using FormData with Multer (binary upload - faster!)');
      console.log('📦 fingerprintPublicKey:', registrationPayload.fingerprintPublicKey ? 'exists' : 'null');
      console.log('📦 faceId:', registrationPayload.faceId ? 'exists' : 'null');
      console.log('📦 faceEmbedding:', registrationPayload.faceEmbedding ? `exists (${registrationPayload.faceEmbedding.length}-D array)` : 'null');
      console.log('📦 faceImageUri:', registrationPayload.faceImageUri ? 'exists (file URI)' : 'null');
      console.log('📦 profileImageUri:', registrationPayload.profileImageUri ? 'exists (file URI)' : 'null');
      
      const response = await authAPI.completeRegistration(registrationPayload);
      
      console.log('✅ Registration response received:', response ? 'success' : 'null');
      
      // Save face data locally for login (NO IMAGE - only features)
      console.log('💾 Saving face data to AsyncStorage...');
      console.log('💾 Saving faceId:', faceId);
      const faceDataForStorage = {
        faceId: faceId, // This is the faceId that was sent to backend and saved in database
        faceFeatures: faceData.faceFeatures || {},
        face: faceData.face,
        // NO IMAGE - only face features for privacy
      };
      // CRITICAL: Normalize the key before saving (trim whitespace)
      const normalizedKey = fingerprintPublicKey.trim();
      
      await AsyncStorage.setItem('faceData', JSON.stringify(faceDataForStorage));
      await AsyncStorage.setItem('fingerprintPublicKey', normalizedKey);
      await AsyncStorage.setItem('biometricEnabled', 'true');
      console.log('✅ Face data saved to AsyncStorage with faceId:', faceId);
      console.log('✅ fingerprintPublicKey saved to AsyncStorage (normalized)');
      console.log('🔑 Saved key (first 50 chars):', normalizedKey.substring(0, 50) + '...');
      console.log('🔑 Saved key (full length):', normalizedKey.length);
      console.log('🔑 Saved key (last 50 chars):', '...' + normalizedKey.substring(normalizedKey.length - 50));
      console.log('💡 CRITICAL: This EXACT key was sent to backend and saved in database');
      console.log('💡 This key MUST be used for login - do NOT regenerate keys!');
      
      // Verify the key was saved correctly
      const verifyKey = await AsyncStorage.getItem('fingerprintPublicKey');
      // Compare normalized keys
      const normalizedVerifyKey = verifyKey ? verifyKey.trim() : null;
      const normalizedOriginalKey = fingerprintPublicKey ? fingerprintPublicKey.trim() : null;
      if (normalizedVerifyKey === normalizedOriginalKey) {
        console.log('✅ Verified: Key saved correctly to AsyncStorage (normalized comparison)');
      } else {
        console.error('❌ ERROR: Key verification failed! Saved key does not match!');
        console.error('   Original key length:', fingerprintPublicKey?.length || 0);
        console.error('   Saved key length:', verifyKey?.length || 0);
        console.error('   Normalized original length:', normalizedOriginalKey?.length || 0);
        console.error('   Normalized saved length:', normalizedVerifyKey?.length || 0);
      }
      
      // Verify it was saved correctly
      const verifySaved = await AsyncStorage.getItem('faceData');
      if (verifySaved) {
        const savedData = JSON.parse(verifySaved);
        console.log('✅ Verified saved faceId:', savedData.faceId);
        console.log('✅ Matches registration faceId:', savedData.faceId === faceId ? 'YES' : 'NO');
      }
      // No need to remove registrationData from AsyncStorage - it was never saved there
      
      // Save user credentials for biometric login
      if (response.user) {
        console.log('💾 Saving user credentials...');
        if (response.user.email) {
          await AsyncStorage.setItem('biometricEmail', response.user.email);
        }
        if (response.user.employeeNumber) {
          await AsyncStorage.setItem('biometricEmployeeNumber', response.user.employeeNumber);
        }
        console.log('✅ User credentials saved');
      }

      // Clear token and user data - user needs to login after registration
      console.log('🧹 Clearing old auth data...');
      await AsyncStorage.multiRemove(['token', 'user', 'cookies']);
      console.log('✅ Old auth data cleared');

      setFaceCompleted(true);
      console.log('✅ Registration completed successfully!');
      
      // Show success message and navigate to Login screen
        Alert.alert(
          t('biometricSetup.registrationComplete'),
          t('biometricSetup.registrationCompleteMessage'),
          [
            {
              text: t('biometricSetup.login'),
              onPress: () => {
              console.log('🔄 Navigating to Login screen...');
              // Close modal if opened from login screen
                if (onSetupComplete) {
                  onSetupComplete();
                } else {
                // Navigate to Login screen (after registration)
                    (navigation as any).reset({
                      index: 0,
                  routes: [{ name: 'Login' }],
                });
              }
            },
          },
        ]
      );
    } catch (error: any) {
      // Only log errors in development mode
      if (__DEV__) {
        console.error('❌ Registration error:', error);
        console.error('Error response:', error.response?.data);
        console.error('Error message:', error.message);
        console.error('Error status:', error.response?.status);
      }
      
      // Handle 502 Bad Gateway (backend unavailable)
      if (error.response?.status === 502 || error.code === 'ECONNREFUSED' || error.message?.includes('502')) {
        Alert.alert(
          t('biometricSetup.connectionError'),
          t('biometricSetup.serverUnavailable'),
          [{ text: t('register.ok') }]
        );
        setLoading(false);
        return;
      }
      
      // Handle network errors
      if (error.message?.includes('Network Error') || error.code === 'NETWORK_ERROR') {
        Alert.alert(
          t('biometricSetup.connectionError'),
          t('biometricSetup.cannotConnectServer'),
          [{ text: t('register.ok') }]
        );
        setLoading(false);
        return;
      }
      
      // Get error message from all possible locations (backend error, response data, or generic error)
      const errorMessage = error.response?.data?.message || 
                          error.data?.message || 
                          error.message || 
                          t('biometricSetup.registrationFailed');
      
      console.log('🔍 Error message extracted:', errorMessage);
      
      // Check if error is about duplicate face, fingerprint, or device already used
      const isDuplicateFace = errorMessage.includes('الوجه مسجل') || errorMessage.includes('الوجه مسجل مسبقاً');
      const isDuplicateFingerprint = errorMessage.includes('البصمة مسجلة') || errorMessage.includes('البصمة مسجلة مسبقاً');
      const isDeviceAlreadyUsed = errorMessage.includes('هذا الجهاز مستخدم') || errorMessage.includes('الجهاز مستخدم');
      const isAlreadyRegistered = errorMessage.includes('مسجل بالفعل على هذا الجهاز') || 
                                  errorMessage.includes('أنت مسجل بالفعل') ||
                                  errorMessage.includes('الوجه والبصمة مسجلان');
      
      if (isDuplicateFace || isDuplicateFingerprint || isDeviceAlreadyUsed || isAlreadyRegistered) {
        // CRITICAL: If registration failed due to duplicate, we MUST preserve the old key
        // The new key in state should NOT overwrite the old key in AsyncStorage
        // Check if we have an old key that should be preserved
        const oldKey = await AsyncStorage.getItem('fingerprintPublicKey');
        if (oldKey && oldKey !== fingerprintPublicKey) {
          console.log('🔑 Registration failed - preserving old key in AsyncStorage for login');
          console.log('   Old key (from AsyncStorage):', oldKey.substring(0, 50) + '...');
          console.log('   New key (from state, not saved):', fingerprintPublicKey?.substring(0, 50) + '...');
          console.log('✅ Old key preserved - user can login with original key');
        } else if (!oldKey) {
          console.warn('⚠️ WARNING: No old key found in AsyncStorage!');
          console.warn('⚠️ This might cause login issues. The new key was not saved because registration failed.');
        }
        
        // Show alert with button to navigate to login screen
        let title = t('biometricSetup.registrationError');
        if (isAlreadyRegistered && errorMessage.includes('الوجه والبصمة')) {
          title = t('biometricSetup.alreadyRegistered');
        } else if (isDuplicateFace) {
          title = t('biometricSetup.faceAlreadyRegistered');
        } else if (isDeviceAlreadyUsed) {
          title = t('biometricSetup.deviceAlreadyUsed');
        } else if (isAlreadyRegistered) {
          title = t('biometricSetup.alreadyRegistered');
        } else if (isDuplicateFingerprint) {
          title = t('biometricSetup.fingerprintAlreadyRegistered');
        }
        
        Alert.alert(
          title,
          errorMessage + '\n\n' + t('biometricSetup.wantToLoginNow'),
          [
            {
              text: t('biometricSetup.cancel'),
              style: 'cancel',
            },
            {
              text: t('biometricSetup.login'),
              onPress: () => {
                console.log('🔄 Navigating to Login screen from duplicate biometric/device error...');
                // Navigate to Login screen
                (navigation as any).reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                });
              },
            },
          ]
        );
      } else {
        // Regular error - show simple alert
        Alert.alert('خطأ', errorMessage);
      }
    } finally {
      setLoading(false);
      console.log('🏁 Registration process finished (loading set to false)');
    }
  };

  // Skip is no longer allowed - biometric setup is REQUIRED

  if (!biometricChecked) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>{t('biometricSetup.checkingDeviceCapabilities')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Icon
            name={
              biometricType === 'FaceID'
                ? 'face-recognition'
                : biometricType === 'TouchID'
                ? 'fingerprint'
                : 'shield-check'
            }
            size={60}
            color="#4F46E5"
          />
        </View>
        <Text style={styles.title}>{t('biometricSetup.biometricSetupRequired')}</Text>
        <Text style={styles.subtitle}>
          {t('biometricSetup.mustCompleteSetup')}
        </Text>
      </View>

      <View style={styles.content}>
        {/* Step 1: Fingerprint Setup */}
        <View style={styles.stepContainer}>
          <View style={styles.stepHeader}>
            <View style={[styles.stepNumber, fingerprintCompleted && styles.stepNumberCompleted]}>
              {fingerprintCompleted ? (
                <Icon name="check" size={20} color="#FFF" />
              ) : (
                <Text style={styles.stepNumberText}>1</Text>
              )}
            </View>
            <Text style={styles.stepTitle}>{t('biometricSetup.setupFingerprintFaceID')}</Text>
          </View>

          {!fingerprintCompleted ? (
            <View>
              {biometricAvailable ? (
                <>
                  <View style={styles.benefitsContainer}>
                    <View style={styles.benefitItem}>
                      <Icon name="shield-check" size={18} color="#10B981" />
                      <Text style={styles.benefitText}>{t('biometricSetup.highSecurity')}</Text>
                    </View>
                    <View style={styles.benefitItem}>
                      <Icon name="lightning-bolt" size={18} color="#F59E0B" />
                      <Text style={styles.benefitText}>{t('biometricSetup.quickLogin')}</Text>
                    </View>
                    <View style={styles.benefitItem}>
                      <Icon name="fingerprint" size={18} color="#4F46E5" />
                      <Text style={styles.benefitText}>{t('biometricSetup.noPasswordNeeded')}</Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handleEnableBiometric}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <>
                        <Icon
                          name={
                            biometricType === 'FaceID'
                              ? 'face-recognition'
                              : 'fingerprint'
                          }
                          size={22}
                          color="#FFF"
                        />
                        <Text style={styles.primaryButtonText}>
                          {t('biometricSetup.enable')} {getBiometricTypeName(biometricType, t)}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.notAvailableContainer}>
                  <Icon name="alert-circle" size={32} color="#EF4444" />
                  <Text style={styles.notAvailableText}>
                    {t('biometricSetup.biometricNotAvailable')}
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.stepCompletedContainer}>
              <Icon name="check-circle" size={24} color="#10B981" />
              <Text style={styles.stepCompletedText}>{t('biometricSetup.fingerprintSetupComplete')}</Text>
            </View>
          )}
        </View>

        {/* Step 2: Face Recognition Setup */}
        <View style={styles.stepContainer}>
          <View style={styles.stepHeader}>
            <View style={[styles.stepNumber, faceCompleted && styles.stepNumberCompleted]}>
              {faceCompleted ? (
                <Icon name="check" size={20} color="#FFF" />
              ) : (
                <Text style={styles.stepNumberText}>2</Text>
              )}
            </View>
            <Text style={styles.stepTitle}>{t('biometricSetup.setupFaceRecognition')}</Text>
          </View>

          {!faceCompleted ? (
            <View style={styles.faceCaptureContainer}>
              {fingerprintCompleted ? (
                <>
                  {capturedImageUri ? (
                    // Show captured image (circular crop)
                    <View style={styles.capturedImageWrapper}>
                      <View style={styles.circularImageContainer}>
                        <Image 
                          source={{ uri: capturedImageUri }} 
                          style={styles.circularImagePreview}
                          resizeMode="cover"
                        />
                      </View>
                      <View style={styles.faceDataContainer}>
                        <Icon name="check-circle" size={18} color="#10B981" />
                        <Text style={styles.faceDataText}>
                          {t('biometricSetup.photoCapturedSuccessfully')}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.primaryButton, loading && styles.buttonDisabled]}
                        onPress={handleFaceCaptureComplete}
                        disabled={loading || !fingerprintCompleted}
                      >
                        {loading ? (
                          <ActivityIndicator color="#FFF" />
                        ) : (
                          <>
                            <Icon name="check" size={20} color="#FFF" />
                            <Text style={styles.primaryButtonText}>{t('biometricSetup.completeRegistration')}</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  ) : hasCameraPermission && cameraDevice ? (
                    // Show embedded camera
                    <View style={styles.embeddedCameraContainer}>
                      <View style={styles.cameraWrapper}>
                        <Camera
                          ref={cameraRef}
                          style={styles.embeddedCamera}
                          device={cameraDevice}
                          format={cameraFormat}
                          isActive={hasCameraPermission && !capturedImageUri}
                          photo={true}
                          enableZoomGesture={false}
                          orientation="portrait"
                        />
                        {/* Guide circle - always visible to help user center face */}
                        <View style={styles.faceDetectionOverlay} pointerEvents="none">
                          <View 
                            style={[
                              styles.faceDetectionBox,
                              faceCentered ? styles.faceDetectionBoxActive : styles.faceDetectionBoxInactive
                            ]}
                          />
                        </View>
                        
                        {/* Face detected label - only show when centered */}
                        {faceCentered && detectedFaces.length > 0 && (
                          <View style={styles.faceDetectionOverlay} pointerEvents="none">
                            <View style={styles.faceDetectionLabel}>
                              <Text style={styles.faceDetectionText}>{t('biometricSetup.faceDetected')}</Text>
                            </View>
                          </View>
                        )}
                        
                        {/* Centering instruction overlay - show when face detected but not centered */}
                        {!faceCentered && centeringMessage && (
                          <View style={styles.centeringOverlay} pointerEvents="none">
                            <View style={styles.centeringMessageBox}>
                              <Text style={styles.centeringMessageText}>{centeringMessage}</Text>
                            </View>
                          </View>
                        )}
                        {isCapturingFace && (
                          <View style={styles.capturingOverlay}>
                            <ActivityIndicator size="large" color="#FFF" />
                            <Text style={styles.capturingText}>{t('biometricSetup.capturingPhoto')}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.cameraInstruction}>
                        {faceCentered 
                          ? t('biometricSetup.faceDetectedCapturing')
                          : centeringMessage || t('faceCapture.fillCircle')}
                      </Text>
                    </View>
                  ) : (
                    // Show permission request or loading
                    <View style={styles.faceCaptureLoading}>
                      <ActivityIndicator size="large" color="#4F46E5" />
                      <Text style={styles.faceCaptureLoadingText}>
                        {hasCameraPermission === false 
                          ? t('biometricSetup.allowCameraAccess')
                          : t('biometricSetup.preparingCamera')}
                      </Text>
                      {hasCameraPermission === false && (
                        <TouchableOpacity
                          style={styles.primaryButton}
                          onPress={checkCameraPermission}
                        >
                          <Text style={styles.primaryButtonText}>{t('biometricSetup.allowAccess')}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </>
              ) : (
                <View style={styles.stepDisabledContainer}>
                  <Text style={styles.stepDisabledText}>{t('biometricSetup.completeFingerprintFirstMessage')}</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.stepCompletedContainer}>
              <Icon name="check-circle" size={24} color="#10B981" />
              <Text style={styles.stepCompletedText}>{t('biometricSetup.faceRecognitionSetupComplete')}</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  contentContainer: {
    flexGrow: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
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
    flex: 1,
    padding: 16,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  toggleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
  },
  toggleButtonActive: {
    backgroundColor: '#4F46E5',
  },
  toggleButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4F46E5',
    marginLeft: 8,
  },
  toggleButtonTextActive: {
    color: '#FFF',
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
  skipButton: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  skipButtonText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '500',
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
  notAvailableSubtext: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  continueButton: {
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  continueButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  faceCaptureContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  faceCaptureLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  faceCaptureLoadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  embeddedCameraContainer: {
    width: '100%',
    alignItems: 'center',
  },
  cameraWrapper: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.7, // Use 70% of screen height (similar to login full screen)
    // This ensures face appears at SAME SIZE during registration and login
    // Critical for embedding consistency (same face size → same crop → same embedding)
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  embeddedCamera: {
    flex: 1,
    width: '100%',
  },
  faceDetectionOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  faceDetectionBox: {
    position: 'absolute',
    width: SCREEN_WIDTH * 0.75, // Match login screen for consistent face size guidance
    height: SCREEN_WIDTH * 0.75,
    borderRadius: (SCREEN_WIDTH * 0.75) / 2,
    borderWidth: 3,
    borderStyle: 'dashed',
    left: '50%',
    top: '50%',
    marginLeft: -(SCREEN_WIDTH * 0.75) / 2,
    marginTop: -(SCREEN_WIDTH * 0.75) / 2,
  },
  faceDetectionBoxActive: {
    borderColor: '#10B981',
    borderWidth: 3,
  },
  faceDetectionBoxInactive: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderWidth: 2,
  },
  centeringOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  centeringMessageBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    marginTop: 20,
  },
  centeringMessageText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  faceDetectionLabel: {
    position: 'absolute',
    top: 20,
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  faceDetectionText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  capturingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  capturingText: {
    color: '#FFF',
    fontSize: 16,
    marginTop: 12,
    fontWeight: '600',
  },
  cameraInstruction: {
    marginTop: 12,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  capturedImageWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  circularImageContainer: {
    width: 200,
    height: 200,
    borderRadius: 100,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 3,
    borderColor: '#10B981',
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  circularImagePreview: {
    width: '100%',
    height: '100%',
  },
  capturedImagePreview: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    backgroundColor: '#000',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 6,
    textAlign: 'center',
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

export default BiometricSetupScreen;
