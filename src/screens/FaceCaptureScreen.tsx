import React, { useRef, useState, useEffect, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity, Dimensions, Image, Platform, InteractionManager, PermissionsAndroid } from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import FaceDetector from "@react-native-ml-kit/face-detection";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { generateFaceId, validateFaceQuality, isFaceCentered } from "../utils/faceRecognition";
import { generateFaceEmbedding } from "../services/faceEmbedding";
import { useTranslation } from 'react-i18next';
import PhotoManipulator from "react-native-photo-manipulator";
import RNFS from "react-native-fs";

type NavigationProp = NativeStackNavigationProp<any>;
type RouteParams = {
  emailOrEmployeeNumber?: string;
  onFaceCaptured?: (imageUri: string, faceData: any[]) => void;
  autoSubmit?: boolean;
  origin?: string;
};

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function FaceCaptureScreen() {
  const { t } = useTranslation();
  const device = useCameraDevice("front");
  
  // Configure camera format for optimal face detection
  const format = useMemo(() => {
    if (!device) return undefined;
    
    // Find a format that supports photo capture
    // Prefer 1080p or lower for better performance
    const formats = device.formats;
    
    // Try to find a good format for face detection (not too high res, not too low)
    const preferredFormat = formats.find(f => 
      f.photoHeight >= 1080 && f.photoHeight <= 1920 &&
      f.photoWidth >= 720 && f.photoWidth <= 1440
    );
    
    // Fallback: Use first available format
    return preferredFormat || formats[0];
  }, [device]);
  
  const cameraRef = useRef<Camera>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [capturedImageUri, setCapturedImageUri] = useState<string | null>(null);
  const [capturedFaceData, setCapturedFaceData] = useState<any | null>(null);
  const [faceCentered, setFaceCentered] = useState(false);
  const [centeringMessage, setCenteringMessage] = useState<string | null>(null);
  const [isScreenFocused, setIsScreenFocused] = useState(true);
  const centeredCountRef = useRef(0);
  const captureTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasCapturedRef = useRef(false);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDetectionRef = useRef(false);
  const lastDetectionPhotoRef = useRef<{photo: any; face: any; imagePath: string; width: number; height: number} | null>(null);
  const permissionRetryCountRef = useRef(0);
  const permissionRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProp<{ params: RouteParams }, 'params'>>();
  const { onFaceCaptured, autoSubmit = false } = route.params || {};

  useEffect(() => {
    console.log('📸 FaceCaptureScreen mounted');
    
    // Listen to navigation focus/blur to control camera
    const unsubscribeFocus = navigation.addListener('focus', () => {
      console.log('📸 FaceCaptureScreen focused - activating camera');
      setIsScreenFocused(true);
      // Reset capture state on focus (allows new capture attempt)
      hasCapturedRef.current = false;
      
      // Wait for all interactions to complete, then wait longer for Activity to be ready
      InteractionManager.runAfterInteractions(() => {
        // Longer delay to ensure Activity is fully attached (Android needs more time)
        setTimeout(() => {
          checkPermission();
        }, 1500); // Increased to 1.5 seconds for Android
      });
    });
    
    const unsubscribeBlur = navigation.addListener('blur', () => {
      console.log('📸 FaceCaptureScreen blurred - deactivating camera');
      setIsScreenFocused(false);
      // Clear any pending capture timers when screen blurs
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
    });
    
    // Cleanup: Deactivate camera when component unmounts
    return () => {
      console.log('📸 FaceCaptureScreen unmounting - cleaning up camera...');
      if (permissionRetryTimerRef.current) {
        clearTimeout(permissionRetryTimerRef.current);
        permissionRetryTimerRef.current = null;
      }
      permissionRetryCountRef.current = 0;
      unsubscribeFocus();
      unsubscribeBlur();
      setIsScreenFocused(false);
    };
  }, [navigation]);

  // Real-time face detection on camera preview
  useEffect(() => {
    if (!hasPermission || !device || isCapturing || !isScreenFocused) return;
    
    // Don't restart detection if we've already attempted capture
    if (hasCapturedRef.current) {
      console.log("⚠️ Skipping detection restart - capture already attempted");
      return;
    }

    console.log("🔍 Starting face detection...");
    let isDetecting = false;

    const detectFaces = async () => {
      // Don't detect if we're capturing or already captured
      if (!cameraRef.current || isCapturing || isDetecting || hasCapturedRef.current || !isScreenFocused || pendingDetectionRef.current) return;

      isDetecting = true;
      pendingDetectionRef.current = true;
      try {
        // Double-check capture hasn't started while we were waiting
        if (hasCapturedRef.current || isCapturing) {
          isDetecting = false;
          pendingDetectionRef.current = false;
          return;
        }
        
        // Take snapshot for detection
        const photo = await cameraRef.current.takePhoto({
          qualityPrioritization: "speed",
          flash: "off",
          enableShutterSound: false,
        });
        
        // Check again after photo is taken (in case capture started during the async operation)
        if (hasCapturedRef.current || isCapturing) {
          isDetecting = false;
          pendingDetectionRef.current = false;
          return;
        }

        const imagePath = photo.path.startsWith("file://") ? photo.path : `file://${photo.path}`;
        
        const cameraFormat = device?.formats?.[0];
        const photoWidth = cameraFormat?.photoWidth || photo.width || SCREEN_WIDTH;
        const photoHeight = cameraFormat?.photoHeight || photo.height || SCREEN_HEIGHT;
        
        // Detect faces with landmarks and classification enabled
        const faces = await Promise.race([
          FaceDetector.detect(imagePath, {
            landmarkMode: 'all', // Enable all landmarks (eyes, nose, mouth, etc.)
            classificationMode: 'all', // Enable classification (smiling, eyes open, etc.)
            minFaceSize: 0.1, // Minimum face size (10% of image)
            enableTracking: false, // Don't track faces across frames
          }),
          new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 2000))
        ]) as any[];

        if (faces && faces.length > 0) {
          console.log("✅ FACE DETECTED! Count:", faces.length);
          const centerCheck = isFaceCentered(faces[0], photoWidth, photoHeight);
          if (centerCheck.centered) {
            centeredCountRef.current += 1;
            if (centeredCountRef.current >= 2) {
              setFaceCentered(true);
              setCenteringMessage(null);

              if (!captureTimerRef.current && !hasCapturedRef.current) {
                const qualityCheck = validateFaceQuality(faces[0]);
                if (qualityCheck.valid) {
                  // Store the detection photo and face data for reuse
                  lastDetectionPhotoRef.current = {
                    photo,
                    face: faces[0],
                    imagePath,
                    width: photoWidth,
                    height: photoHeight
                  };
                  
                  console.log("⏰ Face centered - setting capture timer (1.2s)...");
                  captureTimerRef.current = setTimeout(async () => {
                    // Check all conditions before capturing
                    if (!hasCapturedRef.current && cameraRef.current && !isCapturing && isScreenFocused && hasPermission) {
                      hasCapturedRef.current = true; // Mark as captured to stop detection
                      // Stop detection interval immediately
                      if (detectionIntervalRef.current) {
                        clearInterval(detectionIntervalRef.current);
                        detectionIntervalRef.current = null;
                        console.log("🛑 Stopped detection interval");
                      }
                      // Wait for any pending detection operations to complete
                      console.log("⏳ Waiting for camera to be ready...");
                      let waitCount = 0;
                      while (pendingDetectionRef.current && waitCount < 20) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                        waitCount++;
                      }
                      if (pendingDetectionRef.current) {
                        console.warn("⚠️ Detection still pending after 2 seconds, proceeding anyway");
                      }
                      console.log("📸 CAPTURING FACE FEATURES NOW - FACE DETECTED & CENTERED!");
                      captureTimerRef.current = null; // Clear timer before capture
                      
                      // Use the stored detection photo instead of taking a new one
                      if (lastDetectionPhotoRef.current) {
                        captureFaceFeaturesFromPhoto(
                          lastDetectionPhotoRef.current.face,
                          lastDetectionPhotoRef.current.imagePath,
                          lastDetectionPhotoRef.current.width,
                          lastDetectionPhotoRef.current.height
                        );
                      } else {
                        // Fallback to old method if no stored photo
                        captureFaceFeatures(faces[0]);
                      }
                    } else {
                      console.log("⚠️ Capture timer fired but conditions not met:", {
                        hasCaptured: hasCapturedRef.current,
                        hasCamera: !!cameraRef.current,
                        isCapturing,
                        isScreenFocused,
                        hasPermission
                      });
                      captureTimerRef.current = null;
                    }
                  }, 1200);
                } else {
                  console.log("⚠️ Face quality not good:", qualityCheck.reason);
                }
              }
            } else {
              setFaceCentered(false);
              setCenteringMessage(t('faceCapture.faceDetected'));
            }
          } else {
            centeredCountRef.current = 0;
            setFaceCentered(false);
            setCenteringMessage(centerCheck.message || null);
            if (captureTimerRef.current) {
              clearTimeout(captureTimerRef.current);
              captureTimerRef.current = null;
            }
          }
        } else {
          // NO FACE - clear boxes and cancel capture, reset zoom
          console.log("❌ No face detected - clearing boxes");
          setFaceCentered(false);
          setCenteringMessage(t('faceCapture.fillCircle'));
          if (captureTimerRef.current) {
            clearTimeout(captureTimerRef.current);
            captureTimerRef.current = null;
          }
          centeredCountRef.current = 0;
        }
      } catch (error: any) {
        // Handle camera closed errors gracefully in detection loop
        if (error?.message?.includes("Camera is closed") || error?.message?.includes("camera is closed")) {
          console.warn("⚠️ Camera closed during detection - stopping detection");
          // Don't show error message to user, just stop detection
          isDetecting = false;
          return;
        }
        
        console.log("❌ Detection error:", error);
        setFaceCentered(false);
        setCenteringMessage(t('faceCapture.adjustLighting'));
        if (captureTimerRef.current) {
          clearTimeout(captureTimerRef.current);
          captureTimerRef.current = null;
        }
        centeredCountRef.current = 0;
      } finally {
        isDetecting = false;
        pendingDetectionRef.current = false;
      }
    };

    // Start detection after 1 second, then every 1.5 seconds
    const startTimer = setTimeout(() => {
      detectFaces();
      detectionIntervalRef.current = setInterval(() => {
        if (!hasCapturedRef.current) {
          detectFaces();
        }
      }, 1500);
    }, 1000);

    return () => {
      clearTimeout(startTimer);
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      // Don't reset hasCapturedRef here - let it persist to prevent restart
    };
  }, [hasPermission, device, isCapturing, isScreenFocused]);

  const checkPermission = async () => {
    // Only check permission if screen is focused (Activity is available)
    if (!isScreenFocused) {
      console.log("⏳ Screen not focused, skipping permission check");
      return;
    }
    
    try {
      // Use React Native's PermissionsAndroid for Android (more reliable)
      if (Platform.OS === 'android') {
        console.log("📸 Requesting camera permission (Android)...");
        
        // Check if permission is already granted first
        const checkResult = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
        if (checkResult) {
          console.log("📸 Camera permission already granted");
          setHasPermission(true);
          permissionRetryCountRef.current = 0;
          return;
        }
        
        // Request permission
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'This app needs access to your camera for face recognition',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        const hasPerm = granted === PermissionsAndroid.RESULTS.GRANTED;
        console.log("📸 Android camera permission:", granted, "granted:", hasPerm);
        setHasPermission(hasPerm);
        
        // Reset retry count on success
        permissionRetryCountRef.current = 0;
        
        if (!hasPerm) {
          // Show alert to user
          setTimeout(() => {
            alert("Camera permission is required. Please grant camera permission in settings.");
          }, 500);
        }
      } else {
        // iOS - use Camera API
        console.log("📸 Requesting camera permission (iOS)...");
        const permission = await Camera.requestCameraPermission();
        console.log("📸 iOS camera permission status:", permission);
        const hasPerm = permission === "authorized" || permission === "granted";
        setHasPermission(hasPerm);
        console.log("📸 hasPermission set to:", hasPerm);
        
        // Reset retry count on success
        permissionRetryCountRef.current = 0;
        
        if (!hasPerm) {
          // Show alert to user
          setTimeout(() => {
            alert("Camera permission is required. Please grant camera permission in settings.");
          }, 500);
        }
      }
    } catch (error: any) {
      console.error("❌ Permission error:", error);
      setHasPermission(false);
      
      // On Android, retry if Activity not attached
      if (Platform.OS === 'android') {
        if (error.message?.includes('not attached to an Activity') || error.message?.includes('IllegalStateException')) {
          permissionRetryCountRef.current += 1;
          
          // Stop retrying after 5 attempts
          if (permissionRetryCountRef.current > 5) {
            console.error("❌ Android permission request failed after 5 retries. Activity may not be ready.");
            return;
          }
          
          // Only retry if screen is still focused
          if (isScreenFocused) {
            const delay = permissionRetryCountRef.current * 1000; // Increasing delay: 1s, 2s, 3s, 4s, 5s
            console.log(`⏳ Activity not ready - retrying permission request in ${delay}ms... (attempt ${permissionRetryCountRef.current}/5)`);
            
            // Clear any existing retry timer
            if (permissionRetryTimerRef.current) {
              clearTimeout(permissionRetryTimerRef.current);
            }
            
            permissionRetryTimerRef.current = setTimeout(() => {
              if (isScreenFocused) {
                checkPermission();
              } else {
                console.log("⏳ Screen no longer focused, canceling retry");
              }
            }, delay);
          } else {
            console.log("⏳ Screen not focused, canceling retry");
          }
        } else {
          console.error("❌ Android permission request failed:", error.message);
        }
        return;
      }
      
      // iOS - retry with limit
      if (error.message?.includes('NO_ACTIVITY') || error.message?.includes('PermissionAwareActivity')) {
        permissionRetryCountRef.current += 1;
        
        // Stop retrying after 3 attempts
        if (permissionRetryCountRef.current > 3) {
          console.error("❌ Permission request failed after 3 retries. Screen may not be ready.");
          setHasPermission(false);
          return;
        }
        
        // Only retry if screen is still focused
        if (isScreenFocused) {
          const delay = permissionRetryCountRef.current * 1000; // Increasing delay: 1s, 2s, 3s
          console.log(`⏳ NO_ACTIVITY error - retrying permission request in ${delay}ms... (attempt ${permissionRetryCountRef.current}/3)`);
          
          // Clear any existing retry timer
          if (permissionRetryTimerRef.current) {
            clearTimeout(permissionRetryTimerRef.current);
          }
          
          permissionRetryTimerRef.current = setTimeout(() => {
            if (isScreenFocused) {
              checkPermission();
            } else {
              console.log("⏳ Screen no longer focused, canceling retry");
            }
          }, delay);
        } else {
          console.log("⏳ Screen not focused, canceling retry");
          setHasPermission(false);
        }
      }
    }
  };

  // NEW APPROACH: Capture face detection result (ML Kit liveness check)
  // Then trigger biometric authentication (Face ID) in parent screen
  const storeFaceCaptureResult = async (payload: {
    faceDetected: boolean;
    faceId: string;
    faceEmbedding?: number[] | null;
    faceFeatures: any;
    faceData: any[];
    imageUri?: string | null;
    imageBase64?: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
  }) => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    // Don't store imageBase64 in AsyncStorage - it's too large and causes "Row too big" errors
    // We only need imageUri, the base64 can be generated on-demand if needed
    const { imageBase64, ...payloadWithoutBase64 } = payload;
    await AsyncStorage.setItem(
      'faceCaptureResult',
      JSON.stringify({
        ...payloadWithoutBase64,
        timestamp: Date.now(),
      })
    );
  };

  // New function: Use already-taken photo from detection (avoids camera conflicts)
  const captureFaceFeaturesFromPhoto = async (
    detectedFace: any,
    imagePath: string,
    photoWidth: number,
    photoHeight: number
  ) => {
    if (isCapturing || !isScreenFocused) {
      console.log("⚠️ Cannot capture: already capturing or screen not focused");
      return;
    }

    try {
      console.log("=== ML KIT FACE DETECTED (LIVENESS CHECK) ===");
      setIsCapturing(true);
      
      const qualityCheck = validateFaceQuality(detectedFace);
      if (!qualityCheck.valid) {
        alert(qualityCheck.reason || "Face quality not suitable for recognition");
        setIsCapturing(false);
        hasCapturedRef.current = false; // Reset to allow retry
        return;
      }

      console.log("✅ ML Kit liveness check passed - real face detected");
      console.log("📸 Using detection photo (no new photo needed):", imagePath);
      
      const imageUri = imagePath;
      let analyzedFace = detectedFace;
      
      // Re-detect on the photo to get fresh face data (optional, but ensures accuracy)
      try {
        const facesOnPhoto = await FaceDetector.detect(imageUri, {
          landmarkMode: 'all',
          classificationMode: 'all',
          minFaceSize: 0.1,
          enableTracking: false,
        });
        if (facesOnPhoto && facesOnPhoto.length > 0) {
          analyzedFace = facesOnPhoto[0];
        }
      } catch (analysisError) {
        console.warn('⚠️ Unable to re-run detection on photo, using original face data:', analysisError);
      }
      
      const faceId = generateFaceId(analyzedFace);
      console.log("✅ Generated faceId from features:", faceId);
      
      // Try to crop face for TFLite (if on Android)
      let croppedImageUri: string | null = null;
      if (Platform.OS === 'android') {
        try {
          const frame = analyzedFace?.frame || analyzedFace?.bounds || {};
          const left = frame.left ?? frame.originX ?? frame.x ?? 0;
          const top = frame.top ?? frame.originY ?? frame.y ?? 0;
          const width = frame.width ?? frame.size?.width ?? (frame.right ? frame.right - left : 0);
          const height = frame.height ?? frame.size?.height ?? (frame.bottom ? frame.bottom - top : 0);
          
          // Add padding and crop to 112x112 for TFLite
          const padding = Math.max(width, height) * 0.2;
          const cropX = Math.max(0, Math.round(left - padding));
          const cropY = Math.max(0, Math.round(top - padding));
          const cropWidth = Math.min(photoWidth - cropX, Math.round(width + padding * 2));
          const cropHeight = Math.min(photoHeight - cropY, Math.round(height + padding * 2));
          
          // Normalize URI - ensure it's a file path
          let normalizedUri = imageUri;
          if (normalizedUri.startsWith('file://')) {
            normalizedUri = normalizedUri.replace('file://', '');
          }
          
          // Verify file exists
          const fileExists = await RNFS.exists(normalizedUri);
          if (!fileExists) {
            console.warn('⚠️ Image file does not exist for cropping:', normalizedUri);
          } else {
            croppedImageUri = await PhotoManipulator.crop(
              normalizedUri,
              { x: cropX, y: cropY, width: cropWidth, height: cropHeight },
              { width: 112, height: 112 }
            );
            console.log('✅ Cropped face for TFLite:', croppedImageUri);
          }
        } catch (cropError: any) {
          console.warn('⚠️ Could not crop face for TFLite:', cropError.message);
        }
      }
      
      const faceEmbedding = await generateFaceEmbedding(analyzedFace, {
        imageUri,
        imageWidth: photoWidth,
        imageHeight: photoHeight,
        croppedImageUri: croppedImageUri, // Pass cropped image for TFLite
      });
      if (faceEmbedding) {
        console.log(`✅ Generated face embedding: ${faceEmbedding.length} dimensions`);
      } else {
        console.log('⚠️ Could not generate face embedding');
      }
      
      const faceFeatures = {
        faceId: faceId,
        landmarks: analyzedFace.landmarks || null,
        frame: analyzedFace.frame || analyzedFace.bounds || null,
        smilingProbability: analyzedFace.smilingProbability,
        leftEyeOpenProbability: analyzedFace.leftEyeOpenProbability,
        rightEyeOpenProbability: analyzedFace.rightEyeOpenProbability,
        headEulerAngleX: analyzedFace.headEulerAngleX,
        headEulerAngleY: analyzedFace.headEulerAngleY,
        headEulerAngleZ: analyzedFace.headEulerAngleZ,
        rotationX: analyzedFace.rotationX,
        rotationY: analyzedFace.rotationY,
        rotationZ: analyzedFace.rotationZ,
      };
      
      let imageBase64: string | null = null;
      try {
        // RNFS is already imported at the top
        const fileUri = Platform.OS === 'android' && imageUri.startsWith('file://') 
          ? imageUri.replace('file://', '') 
          : imageUri;
        const base64 = await RNFS.readFile(fileUri, 'base64');
        imageBase64 = `data:image/jpeg;base64,${base64}`;
        console.log('✅ Face image converted to base64');
      } catch (error) {
        console.error('❌ Error converting face image to base64:', error);
      }

      const faceCapturePayload = {
        faceDetected: true,
        faceId: faceId,
        faceEmbedding: faceEmbedding,
        faceFeatures: faceFeatures,
        faceData: [analyzedFace],
        imageUri,
        imageBase64,
        imageWidth: photoWidth,
        imageHeight: photoHeight,
      };
      
      if (autoSubmit) {
        console.log("⚡ Auto-submit enabled - saving result and returning immediately");
        await storeFaceCaptureResult(faceCapturePayload);
        
        if (onFaceCaptured && typeof onFaceCaptured === 'function') {
          try {
            await onFaceCaptured(faceId, [analyzedFace]);
          } catch (cbError) {
            console.log("Callback error (non-critical):", cbError);
          }
        }
        
        setIsCapturing(false);
        navigation.goBack();
      } else {
        setCapturedImageUri(imageUri);
        setCapturedFaceData(faceCapturePayload);
        setIsCapturing(false);
      }
      
    } catch (error: any) {
      console.error("CAPTURE ERROR:", error);
      setIsCapturing(false);
      hasCapturedRef.current = false; // Reset to allow retry
      alert(`Error: ${error?.message || String(error)}. Please try again.`);
    }
  };

  const captureFaceFeatures = async (detectedFace: any) => {
    // Check if camera is still available and screen is focused
    if (!cameraRef.current || isCapturing || !isScreenFocused) {
      console.log("⚠️ Cannot capture: camera not ready or screen not focused");
      return;
    }
    
    // Ensure detection is stopped before capture
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
      console.log("🛑 Stopped detection interval before capture");
    }

    try {
      console.log("=== ML KIT FACE DETECTED (LIVENESS CHECK) ===");
      setIsCapturing(true);
      
      const qualityCheck = validateFaceQuality(detectedFace);
      if (!qualityCheck.valid) {
        alert(qualityCheck.reason || "Face quality not suitable for recognition");
        setIsCapturing(false);
        return;
      }

      console.log("✅ ML Kit liveness check passed - real face detected");
      
      // Double-check camera is still available before taking photo
      if (!cameraRef.current || !isScreenFocused) {
        console.warn("⚠️ Camera closed or screen blurred, aborting capture");
        setIsCapturing(false);
        return;
      }
      
      // Wait for any pending detection operations to complete
      console.log("⏳ Waiting for camera to stabilize...");
      let waitCount = 0;
      while (pendingDetectionRef.current && waitCount < 30) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
      if (pendingDetectionRef.current) {
        console.warn("⚠️ Detection still pending after 3 seconds, proceeding anyway");
      }
      // Additional small delay for camera to be fully ready
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Check again after delay
      if (!cameraRef.current || !isScreenFocused) {
        console.warn("⚠️ Camera unavailable after delay, aborting capture");
        setIsCapturing(false);
        return;
      }
      
      // Wrap takePhoto in try-catch to handle camera errors gracefully
      let photo;
      try {
        photo = await cameraRef.current.takePhoto({
          qualityPrioritization: "quality",
          flash: "off",
          enableShutterSound: false,
        });
      } catch (photoError: any) {
        // Handle various camera errors gracefully
        const errorMessage = photoError?.message || String(photoError);
        if (
          errorMessage.includes("Camera is closed") || 
          errorMessage.includes("camera is closed") ||
          errorMessage.includes("Failed to submit capture request") ||
          errorMessage.includes("capture request")
        ) {
          console.warn("⚠️ Camera error during photo capture - aborting:", errorMessage);
          setIsCapturing(false);
          return;
        }
        // Re-throw unexpected errors
        throw photoError;
      }
      const imageUri = photo.path.startsWith("file://") ? photo.path : `file://${photo.path}`;
      const photoWidth = photo.width || photo.photoWidth || SCREEN_WIDTH;
      const photoHeight = photo.height || photo.photoHeight || SCREEN_HEIGHT;
      console.log("✅ Captured image:", imageUri);

      let analyzedFace = detectedFace;
      try {
        const facesOnPhoto = await FaceDetector.detect(imageUri, {
          landmarkMode: 'all',
          classificationMode: 'all',
          minFaceSize: 0.1,
          enableTracking: false,
        });
        if (facesOnPhoto && facesOnPhoto.length > 0) {
          analyzedFace = facesOnPhoto[0];
        }
      } catch (analysisError) {
        console.warn('⚠️ Unable to re-run detection on captured image:', analysisError);
      }
      
      const faceId = generateFaceId(analyzedFace);
      console.log("✅ Generated faceId from features:", faceId);
      
      const faceEmbedding = await generateFaceEmbedding(analyzedFace, {
        imageUri,
        imageWidth: photoWidth,
        imageHeight: photoHeight,
      });
      if (faceEmbedding) {
        console.log(`✅ Generated face embedding: ${faceEmbedding.length} dimensions (deep model)`);
      } else {
        console.log('⚠️ Could not generate deep face embedding, falling back to landmarks');
      }
      
      const faceFeatures = {
        faceId: faceId,
        landmarks: analyzedFace.landmarks || null,
        frame: analyzedFace.frame || analyzedFace.bounds || null,
        smilingProbability: analyzedFace.smilingProbability,
        leftEyeOpenProbability: analyzedFace.leftEyeOpenProbability,
        rightEyeOpenProbability: analyzedFace.rightEyeOpenProbability,
        headEulerAngleX: analyzedFace.headEulerAngleX,
        headEulerAngleY: analyzedFace.headEulerAngleY,
        headEulerAngleZ: analyzedFace.headEulerAngleZ,
        rotationX: analyzedFace.rotationX,
        rotationY: analyzedFace.rotationY,
        rotationZ: analyzedFace.rotationZ,
      };
      
      let imageBase64: string | null = null;
      try {
        // RNFS is already imported at the top
        const fileUri = Platform.OS === 'android' && imageUri.startsWith('file://') 
          ? imageUri.replace('file://', '') 
          : imageUri;
        const base64 = await RNFS.readFile(fileUri, 'base64');
        imageBase64 = `data:image/jpeg;base64,${base64}`;
        console.log('✅ Face image converted to base64');
      } catch (error) {
        console.error('❌ Error converting face image to base64:', error);
      }

      const faceCapturePayload = {
        faceDetected: true,
        faceId: faceId,
        faceEmbedding: faceEmbedding,
        faceFeatures: faceFeatures,
        faceData: [analyzedFace],
        imageUri,
        imageBase64,
        imageWidth: photoWidth,
        imageHeight: photoHeight,
      };
      
      if (autoSubmit) {
        console.log("⚡ Auto-submit enabled - saving result and returning immediately");
        await storeFaceCaptureResult(faceCapturePayload);
        
        if (onFaceCaptured && typeof onFaceCaptured === 'function') {
          try {
            await onFaceCaptured(faceId, [analyzedFace]);
          } catch (cbError) {
            console.log("Callback error (non-critical):", cbError);
          }
        }
        
        navigation.goBack();
      } else {
        setCapturedImageUri(imageUri);
        setCapturedFaceData(faceCapturePayload);
      }
      
      setIsCapturing(false);
      
    } catch (error: any) {
      console.error("CAPTURE ERROR:", error);
      setIsCapturing(false);
      
      // Handle camera-related errors gracefully (don't show alerts)
      const errorMessage = error?.message || String(error);
      if (
        errorMessage.includes("Camera is closed") || 
        errorMessage.includes("camera is closed") ||
        errorMessage.includes("Failed to submit capture request") ||
        errorMessage.includes("capture request")
      ) {
        console.warn("⚠️ Camera error during capture - resetting to allow retry");
        // Reset capture state to allow user to try again
        hasCapturedRef.current = false;
        setIsCapturing(false);
        // Show a message to user
        alert("Camera is busy. Please try again by moving your face slightly.");
        return;
      }
      
      // Only show alert for unexpected errors
      console.error("❌ Unexpected capture error:", errorMessage);
      hasCapturedRef.current = false; // Reset to allow retry
      alert(`Error: ${errorMessage}. Please try again.`);
    }
  };
  
  // OLD CODE REMOVED - No longer saving images, only extracting face features
  
  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Loading camera...</Text>
      </View>
    );
  }

  if (!hasPermission) {
    console.log("⚠️ FaceCaptureScreen: No camera permission, showing permission request UI");
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission required</Text>
        <Text style={styles.text}>Please grant camera permission</Text>
        <TouchableOpacity style={styles.button} onPress={checkPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }
  
  console.log("✅ FaceCaptureScreen: Has permission, showing camera");

  // Handle using the captured image
  const handleUseImage = async () => {
    if (!capturedFaceData) return;

    try {
      // Convert image to base64 if not already converted
      let imageBase64: string | null = capturedFaceData.imageBase64 || null;
      if (!imageBase64 && capturedImageUri) {
        try {
          // RNFS is already imported at the top
          const fileUri = Platform.OS === 'android' && capturedImageUri.startsWith('file://') 
            ? capturedImageUri.replace('file://', '') 
            : capturedImageUri;
          const base64 = await RNFS.readFile(fileUri, 'base64');
          imageBase64 = `data:image/jpeg;base64,${base64}`;
        } catch (error) {
          console.error('❌ Error converting face image to base64:', error);
        }
      }

      let faceEmbedding = capturedFaceData.faceEmbedding || null;
      if (!faceEmbedding && capturedFaceData.faceData && capturedFaceData.faceData[0] && capturedImageUri) {
        faceEmbedding = await generateFaceEmbedding(capturedFaceData.faceData[0], {
          imageUri: capturedImageUri,
          imageWidth: capturedFaceData.imageWidth || null,
          imageHeight: capturedFaceData.imageHeight || null,
        });
      }

      await storeFaceCaptureResult({
        faceDetected: true,
        faceId: capturedFaceData.faceId,
        faceEmbedding: faceEmbedding, // Include embedding (generated on-device)
        faceFeatures: capturedFaceData.faceFeatures,
        faceData: capturedFaceData.faceData,
        imageUri: capturedImageUri,
        imageBase64,
        imageWidth: capturedFaceData.imageWidth || null,
        imageHeight: capturedFaceData.imageHeight || null,
      });
      console.log("✅ Stored face capture result with image");
      
      // If callback provided, call it
      if (onFaceCaptured) {
        try {
          if (typeof onFaceCaptured === 'function') {
            await onFaceCaptured(capturedFaceData.faceId, capturedFaceData.faceData);
          }
        } catch (error) {
          console.log("Callback error (non-critical):", error);
        }
      }
      
      // Go back - parent screen will handle the result
      navigation.goBack();
    } catch (error) {
      console.error("Error using image:", error);
      alert(t('faceCapture.errorSaving'));
    }
  };

  // Handle retry - reset and capture again
  const handleRetry = () => {
    setCapturedImageUri(null);
    setCapturedFaceData(null);
    setDetectedFaces([]);
    // Restart detection
  };

  return (
    <View style={styles.container}>
      {capturedImageUri ? (
        // Show captured image
        <View style={styles.capturedImageContainer}>
          <Image 
            source={{ uri: capturedImageUri }} 
            style={[styles.capturedImage, { transform: [{ scaleX: -1 }] }]}
            resizeMode="cover"
          />
          <View style={styles.capturedImageOverlay}>
            <View style={styles.capturedImageActions}>
              <TouchableOpacity 
                style={styles.retryButton}
                onPress={handleRetry}
              >
                <Text style={styles.retryButtonText}>{t('faceCapture.retry')}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.useButton}
                onPress={handleUseImage}
              >
                <Text style={styles.useButtonText}>{t('faceCapture.useThisImage')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        // Show camera
        device && (
          <View style={styles.cameraContainer}>
            <Camera
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              device={device}
              format={format}
              isActive={hasPermission && !capturedImageUri && isScreenFocused && !isCapturing}
              photo={true}
              enableZoomGesture={false}
              orientation="portrait"
            />
          </View>
        )
      )}
      {!capturedImageUri && (
        <View style={styles.centeringOverlay} pointerEvents="none">
          <View style={[styles.faceCircle, faceCentered && styles.faceCircleActive]} />
          <View style={styles.centerInstructionWrapper}>
            <Text
              style={[
                styles.centerInstructionText,
                faceCentered && styles.centerInstructionTextActive,
              ]}
            >
              {faceCentered
                ? t('faceCapture.faceDetectedCapturing')
                : centeringMessage || t('faceCapture.fillCircle')}
            </Text>
          </View>
        </View>
      )}
      {isCapturing && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>Processing...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  cameraContainer: {
    flex: 1,
    overflow: "hidden",
  },
  text: {
    color: "#fff",
    fontSize: 18,
    textAlign: "center",
    marginTop: 50,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  overlayText: {
    color: "#fff",
    fontSize: 18,
    marginTop: 10,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    marginTop: 20,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  centeringOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  faceCircle: {
    width: SCREEN_WIDTH * 0.85, // Increased to 85% to better match registration camera field of view
    // Full screen camera has wider field of view, so need bigger circle to match face size
    aspectRatio: 1,
    borderRadius: (SCREEN_WIDTH * 0.85) / 2,
    borderWidth: 4,
    borderStyle: "dashed",
    borderColor: "rgba(255,255,255,0.75)",
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  faceCircleActive: {
    borderColor: "#34D399",
    backgroundColor: "rgba(52,211,153,0.15)",
  },
  centerInstructionWrapper: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  centerInstructionText: {
    color: "#F87171",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  centerInstructionTextActive: {
    color: "#10B981",
    backgroundColor: "rgba(0,0,0,0.7)",
  },
  capturedImageContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  capturedImage: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  capturedImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "flex-end",
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  capturedImageActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 15,
  },
  retryButton: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
  },
  retryButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  useButton: {
    flex: 1,
    backgroundColor: "#4F46E5",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
  },
  useButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
});

