import { NativeModules, Platform } from 'react-native';

const { FaceRecognitionModule } = NativeModules;

/**
 * Generate face embedding using TensorFlow Lite MobileFaceNet model
 * This provides 192-D embeddings (better accuracy than landmark-based 128-D)
 * 
 * @param imageUri - Path to the face image file (must be a local file path)
 * @param cropRect - Optional crop rectangle {x, y, width, height} to crop face region before processing
 * @returns Promise<number[]> - 192-D embedding array
 */
export const generateTFLiteEmbedding = async (
  imageUri: string,
  cropRect?: { x: number; y: number; width: number; height: number } | null
): Promise<number[] | null> => {
  if (Platform.OS !== 'android') {
    console.warn('⚠️ TensorFlow Lite face recognition is only available on Android');
    return null;
  }

  if (!FaceRecognitionModule) {
    console.error('❌ FaceRecognitionModule not found. Make sure native module is properly linked.');
    return null;
  }

  try {
    // Remove file:// prefix if present
    const cleanPath = imageUri.replace('file://', '');
    
    console.log('🚀 Generating TFLite embedding from:', cleanPath);
    
    // Use crop version if crop coordinates provided, otherwise use full image
    const embedding = cropRect
      ? await FaceRecognitionModule.generateEmbeddingWithCrop(cleanPath, cropRect)
      : await FaceRecognitionModule.generateEmbedding(cleanPath);
    
    if (embedding && Array.isArray(embedding) && embedding.length === 192) {
      console.log(`✅ Generated TFLite embedding: ${embedding.length} dimensions`);
      return embedding;
    } else {
      console.error('❌ Invalid embedding format:', embedding);
      return null;
    }
  } catch (error: any) {
    console.error('❌ Error generating TFLite embedding:', error.message);
    return null;
  }
};

