import { generateTFLiteEmbedding } from './tfliteFaceRecognition';
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';

/**
 * Generate face embedding from face detection data
 * 
 * Priority:
 * 1. TensorFlow Lite MobileFaceNet (192-D) - Android only, most accurate
 * 2. Landmark-based (128-D) - Fallback, works on all platforms
 * 
 * @param faceData - Face detection data from ML Kit (contains landmarks, frame, etc.)
 * @param options - Image context for TFLite model (imageUri, imageWidth, imageHeight)
 * @returns Embedding vector (192-D from TFLite or 128-D from landmarks) or null
 */
export const generateFaceEmbedding = async (
  faceData: any,
  options?: { imageUri?: string | null; imageWidth?: number | null; imageHeight?: number | null; croppedImageUri?: string | null }
): Promise<number[] | null> => {
  // Try TFLite first (Android only, requires image)
  if (Platform.OS === 'android') {
    try {
      console.log('🔍 Attempting TFLite embedding generation...');
      
      let croppedImageUri: string | null = null;
      
      // If we have a pre-cropped image (square face crop), use it directly
      // The native module will handle resizing to 112x112
      if (options?.croppedImageUri) {
        console.log('📸 Pre-cropped image provided:', options.croppedImageUri);
        let normalizedUri = options.croppedImageUri;
        if (normalizedUri.startsWith('file://')) {
          normalizedUri = normalizedUri.replace('file://', '');
        }
        
        console.log('🔍 Checking if file exists:', normalizedUri);
        const fileExists = await RNFS.exists(normalizedUri);
        console.log('📁 File exists:', fileExists);
        
        if (fileExists) {
          croppedImageUri = normalizedUri; // Native module will resize it
          console.log('✅ Using pre-cropped image (native module will resize to 112x112)');
        } else {
          console.warn('⚠️ Pre-cropped image file does not exist:', normalizedUri);
        }
      } else {
        console.log('⚠️ No pre-cropped image provided, will try native module crop');
      }
      
      // Try TFLite with crop coordinates using native module (no PhotoManipulator needed)
      if (options?.imageUri && options.imageWidth && options.imageHeight && faceData) {
        const frame = faceData?.frame || faceData?.bounds || {};
        const left = frame.left ?? frame.originX ?? frame.x ?? 0;
        const top = frame.top ?? frame.originY ?? frame.y ?? 0;
        const width = frame.width ?? frame.size?.width ?? (frame.right ? frame.right - left : 0);
        const height = frame.height ?? frame.size?.height ?? (frame.bottom ? frame.bottom - top : 0);
        
        // STANDARDIZED SQUARE CROP for consistent embeddings:
        // 1. Find face center
        const centerX = left + width / 2;
        const centerY = top + height / 2;
        
        // 2. Create square crop (use larger dimension + 40% padding)
        const maxDim = Math.max(width, height);
        const cropSize = Math.round(maxDim * 1.4); // 40% total padding (20% each side)
        
        // 3. Center the square crop on face
        const cropX = Math.max(0, Math.round(centerX - cropSize / 2));
        const cropY = Math.max(0, Math.round(centerY - cropSize / 2));
        
        // 4. Ensure crop stays within image bounds
        const cropWidth = Math.min(options.imageWidth - cropX, cropSize);
        const cropHeight = Math.min(options.imageHeight - cropY, cropSize);
        
        console.log(`📐 Face crop: center=(${centerX.toFixed(0)}, ${centerY.toFixed(0)}), size=${cropSize}x${cropSize}`);
        console.log(`📊 DIAGNOSTIC: Face bounds=(${left.toFixed(0)},${top.toFixed(0)}), size=${width.toFixed(0)}x${height.toFixed(0)}`);
        console.log(`📊 DIAGNOSTIC: Crop=(${cropX},${cropY}), size=${cropWidth}x${cropHeight}`);
        
        let normalizedUri = options.imageUri;
        if (normalizedUri.startsWith('file://')) {
          normalizedUri = normalizedUri.replace('file://', '');
        }
        
        // Check if file exists
        const fileExists = await RNFS.exists(normalizedUri);
        if (fileExists) {
          console.log('📸 Using native module crop (no PhotoManipulator needed)');
          const tfliteEmbedding = await generateTFLiteEmbedding(normalizedUri, {
            x: cropX,
            y: cropY,
            width: cropWidth,
            height: cropHeight,
          });
          if (tfliteEmbedding && tfliteEmbedding.length === 192) {
            // Calculate embedding statistics for debugging
            const embeddingSum = tfliteEmbedding.reduce((a, b) => a + b, 0);
            const embeddingMean = embeddingSum / tfliteEmbedding.length;
            const embeddingMin = Math.min(...tfliteEmbedding);
            const embeddingMax = Math.max(...tfliteEmbedding);
            console.log(`✅ Using TFLite embedding (192-D)`);
            console.log(`📊 DIAGNOSTIC: Embedding stats - mean=${embeddingMean.toFixed(4)}, min=${embeddingMin.toFixed(4)}, max=${embeddingMax.toFixed(4)}`);
            return tfliteEmbedding;
          }
        }
      }
      
      // Fallback: try with pre-cropped image if available
      if (croppedImageUri) {
        console.log('✅ Face image ready for TFLite:', croppedImageUri);
        const tfliteEmbedding = await generateTFLiteEmbedding(croppedImageUri);
        if (tfliteEmbedding && tfliteEmbedding.length === 192) {
          console.log('✅ Using TFLite embedding (192-D)');
          return tfliteEmbedding;
        } else {
          console.warn('⚠️ TFLite embedding invalid, falling back to landmarks');
        }
      } else {
        console.warn('⚠️ Could not prepare image for TFLite, falling back to landmarks');
      }
    } catch (error: any) {
      console.warn('⚠️ TFLite embedding failed, falling back to landmarks:', error.message);
    }
  }
  
  // Fallback to landmark-based embedding
  if (!faceData || !faceData.landmarks) {
    console.log('⚠️ No face landmarks available for embedding generation');
    return null;
  }

  const landmarks = faceData.landmarks;
  const frame = faceData.frame || faceData.bounds || {};
  const frameWidth = frame.width || 1;
  const frameHeight = frame.height || 1;
  const embedding: number[] = [];

  const getNormalizedPos = (landmark: any) => {
    if (!landmark) return [0, 0];
    const x = landmark.position?.x ?? landmark.x ?? 0;
    const y = landmark.position?.y ?? landmark.y ?? 0;
    return [
      frameWidth > 0 ? (x - (frame.left || 0)) / frameWidth : 0,
      frameHeight > 0 ? (y - (frame.top || 0)) / frameHeight : 0,
    ];
  };

  // Extract key facial landmarks
  const keyLandmarks = [
    landmarks.leftEye,
    landmarks.rightEye,
    landmarks.noseBase,
    landmarks.mouthLeft,
    landmarks.mouthRight,
    landmarks.mouthBottom,
    landmarks.leftCheek,
    landmarks.rightCheek,
  ];

  // Add normalized landmark positions (16 values: 8 landmarks × 2 coordinates)
  for (const landmark of keyLandmarks) {
    const [x, y] = getNormalizedPos(landmark);
    embedding.push(x, y);
  }

  // Add face geometry and expression features
  const normalizeAngle = (angle: number) => (angle + 180) / 360;
  embedding.push(frameWidth / (frameHeight || 1)); // Aspect ratio
  embedding.push(faceData.smilingProbability ?? 0);
  embedding.push(faceData.leftEyeOpenProbability ?? 0);
  embedding.push(faceData.rightEyeOpenProbability ?? 0);
  embedding.push(normalizeAngle(faceData.headEulerAngleX ?? 0));
  embedding.push(normalizeAngle(faceData.headEulerAngleY ?? 0));
  embedding.push(normalizeAngle(faceData.headEulerAngleZ ?? 0));

  // Pad to 128 dimensions if needed
  while (embedding.length < 128) {
    embedding.push(0);
  }

  const finalEmbedding = embedding.slice(0, 128);
  console.log(`✅ Generated landmark-based embedding: ${finalEmbedding.length} dimensions`);
  return finalEmbedding;
};

