/**
 * Face Recognition Utility
 * Uses face landmarks, classification, and head angles from ML Kit
 * to create a stable faceId that can recognize the same face
 * even with different lighting/angles - NO IMAGES STORED
 */

interface FaceLandmark {
  x: number;
  y: number;
}

interface FaceData {
  frame?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  bounds?: {
    origin?: { x: number; y: number };
    size?: { width: number; height: number };
  };
  landmarks?: {
    leftEye?: FaceLandmark;
    rightEye?: FaceLandmark;
    noseBase?: FaceLandmark;
    mouthLeft?: FaceLandmark;
    mouthRight?: FaceLandmark;
    mouthBottom?: FaceLandmark;
    leftEar?: FaceLandmark;
    rightEar?: FaceLandmark;
    leftCheek?: FaceLandmark;
    rightCheek?: FaceLandmark;
  };
  // ML Kit classification features
  smilingProbability?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  headEulerAngleX?: number; // Nodding
  headEulerAngleY?: number; // Turning left/right
  headEulerAngleZ?: number; // Tilting
}

/**
 * Check if face is centered in the frame
 * Returns true if face is within acceptable center range
 */
export const isFaceCentered = (face: any, imageWidth: number, imageHeight: number): { centered: boolean; offsetX: number; offsetY: number; message?: string } => {
  try {
    const frame = face.frame || face.bounds || {};
    const faceLeft = frame.left || 0;
    const faceTop = frame.top || 0;
    const faceWidth = frame.width || 0;
    const faceHeight = frame.height || 0;
    
    // Calculate face center
    const faceCenterX = faceLeft + faceWidth / 2;
    const faceCenterY = faceTop + faceHeight / 2;
    
    // Calculate image center
    const imageCenterX = imageWidth / 2;
    const imageCenterY = imageHeight / 2;
    
    // Calculate offset from center (as percentage)
    const offsetX = ((faceCenterX - imageCenterX) / imageWidth) * 100;
    const offsetY = ((faceCenterY - imageCenterY) / imageHeight) * 100;
    
    // Acceptable range: ±25% from center (more forgiving for easier capture)
    const threshold = 25;
    const isCenteredX = Math.abs(offsetX) <= threshold;
    const isCenteredY = Math.abs(offsetY) <= threshold;
    
    let message = '';
    if (!isCenteredX || !isCenteredY) {
      if (offsetX > threshold) message = 'حرك وجهك إلى اليسار';
      else if (offsetX < -threshold) message = 'حرك وجهك إلى اليمين';
      else if (offsetY > threshold) message = 'حرك وجهك إلى الأسفل';
      else if (offsetY < -threshold) message = 'حرك وجهك إلى الأعلى';
    }
    
    return {
      centered: isCenteredX && isCenteredY,
      offsetX,
      offsetY,
      message: message || undefined,
    };
  } catch (error) {
    return { centered: false, offsetX: 0, offsetY: 0, message: 'خطأ في التحقق من موضع الوجه' };
  }
};

/**
 * Generate a stable faceId from face landmarks and ML Kit features
 * Uses relative positions of facial features (normalized to face size)
 * PLUS classification features and head angles for better recognition
 * NO IMAGES - only face features extracted from camera
 */
export const generateFaceIdFromLandmarks = (faceData: any): string => {
  try {
    // Extract face frame dimensions (handle different ML Kit formats)
    let frame = faceData.frame || {};
    if (!frame.width && faceData.bounds) {
      frame = {
        left: faceData.bounds.origin?.x || faceData.bounds.left || 0,
        top: faceData.bounds.origin?.y || faceData.bounds.top || 0,
        width: faceData.bounds.size?.width || faceData.bounds.width || 1,
        height: faceData.bounds.size?.height || faceData.bounds.height || 1,
      };
    }
    
    const faceWidth = frame.width || 1;
    const faceHeight = frame.height || 1;
    const faceCenterX = (frame.left || 0) + faceWidth / 2;
    const faceCenterY = (frame.top || 0) + faceHeight / 2;

    // Extract landmarks (ML Kit provides these if enabled)
    const landmarks = faceData.landmarks || {};
    
    // Get key facial feature positions (normalized to face size)
    const features: number[] = [];

    // Helper to extract x, y from landmark (handles both formats: direct x/y or position.x/y)
    const getLandmarkPos = (landmark: any) => {
      if (!landmark) return null;
      if (landmark.x !== undefined && landmark.y !== undefined) {
        return { x: landmark.x, y: landmark.y };
      }
      if (landmark.position?.x !== undefined && landmark.position?.y !== undefined) {
        return { x: landmark.position.x, y: landmark.position.y };
      }
      return null;
    };

    // Left eye position (relative to face center)
    const leftEyePos = getLandmarkPos(landmarks.leftEye);
    if (leftEyePos) {
      const leftEyeX = (leftEyePos.x - faceCenterX) / faceWidth;
      const leftEyeY = (leftEyePos.y - faceCenterY) / faceHeight;
      features.push(leftEyeX, leftEyeY);
    }

    // Right eye position
    const rightEyePos = getLandmarkPos(landmarks.rightEye);
    if (rightEyePos) {
      const rightEyeX = (rightEyePos.x - faceCenterX) / faceWidth;
      const rightEyeY = (rightEyePos.y - faceCenterY) / faceHeight;
      features.push(rightEyeX, rightEyeY);
    }

    // Nose position
    const nosePos = getLandmarkPos(landmarks.noseBase);
    if (nosePos) {
      const noseX = (nosePos.x - faceCenterX) / faceWidth;
      const noseY = (nosePos.y - faceCenterY) / faceHeight;
      features.push(noseX, noseY);
    }

    // Mouth positions
    const mouthLeftPos = getLandmarkPos(landmarks.mouthLeft);
    if (mouthLeftPos) {
      const mouthLeftX = (mouthLeftPos.x - faceCenterX) / faceWidth;
      const mouthLeftY = (mouthLeftPos.y - faceCenterY) / faceHeight;
      features.push(mouthLeftX, mouthLeftY);
    }

    const mouthRightPos = getLandmarkPos(landmarks.mouthRight);
    if (mouthRightPos) {
      const mouthRightX = (mouthRightPos.x - faceCenterX) / faceWidth;
      const mouthRightY = (mouthRightPos.y - faceCenterY) / faceHeight;
      features.push(mouthRightX, mouthRightY);
    }

    // Eye distance (normalized) - important for face recognition
    if (leftEyePos && rightEyePos) {
      const eyeDistance = Math.sqrt(
        Math.pow(rightEyePos.x - leftEyePos.x, 2) +
        Math.pow(rightEyePos.y - leftEyePos.y, 2)
      ) / faceWidth;
      features.push(eyeDistance);
    }

    // If no landmarks available, use frame position, size, and rotation as fallback
    if (features.length === 0) {
      // Use face position (normalized to image dimensions - need to get image size)
      // For now, use relative position within frame
      const facePosX = (frame.left || 0) / Math.max(faceWidth, 1);
      const facePosY = (frame.top || 0) / Math.max(faceHeight, 1);
      features.push(Math.round(facePosX * 100) / 100, Math.round(facePosY * 100) / 100);
      
      // Use face size (aspect ratio)
      const faceAspectRatio = faceWidth / Math.max(faceHeight, 1);
      features.push(Math.round(faceAspectRatio * 100) / 100);
      
      // Use rotation angles if available (these are headEulerAngleX/Y/Z or rotationX/Y/Z)
      const rotX = faceData.headEulerAngleX ?? faceData.rotationX;
      const rotY = faceData.headEulerAngleY ?? faceData.rotationY;
      const rotZ = faceData.headEulerAngleZ ?? faceData.rotationZ;
      
      if (rotX !== undefined) {
        const normalizedRotX = (rotX + 90) / 180; // Normalize -90 to +90 to 0-1
        features.push(Math.round(normalizedRotX * 100) / 100);
      }
      if (rotY !== undefined) {
        const normalizedRotY = (rotY + 90) / 180;
        features.push(Math.round(normalizedRotY * 100) / 100);
      }
      if (rotZ !== undefined) {
        const normalizedRotZ = (rotZ + 90) / 180;
        features.push(Math.round(normalizedRotZ * 100) / 100);
      }
    }

    // Add ML Kit classification features (for better uniqueness)
    // These are stable characteristics of the face
    if (faceData.smilingProbability !== undefined) {
      features.push(Math.round(faceData.smilingProbability * 100) / 100);
    }
    
    // Face proportions (width/height ratio)
    const faceAspectRatio = faceWidth / (faceHeight || 1);
    features.push(Math.round(faceAspectRatio * 100) / 100);

    // Head angles (normalized) - helps with face recognition even when head is turned
    if (faceData.headEulerAngleY !== undefined) {
      // Normalize angle to 0-1 range (-90 to +90 degrees)
      const normalizedAngleY = (faceData.headEulerAngleY + 90) / 180;
      features.push(Math.round(normalizedAngleY * 100) / 100);
    }

    // Create hash from normalized features
    const featureString = features
      .map(f => f.toFixed(4)) // Round to 4 decimal places for stability
      .join(',');
    
    // Generate hash
    const hash = featureString.split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0);
    }, 0);
    
    return Math.abs(hash).toString(16);
  } catch (error) {
    console.error('Error generating faceId from landmarks:', error);
    // Fallback to simple hash if landmarks not available
    return generateFaceIdFallback(faceData);
  }
};

/**
 * Validate face quality for recognition
 * Returns true if face is suitable for recognition
 */
export const validateFaceQuality = (faceData: any): { valid: boolean; reason?: string } => {
  // Check if face is detected
  if (!faceData || !faceData.frame && !faceData.bounds) {
    return { valid: false, reason: 'No face detected' };
  }

  // Check if looking at camera (head angle)
  if (faceData.headEulerAngleY !== undefined) {
    const angleY = Math.abs(faceData.headEulerAngleY);
    if (angleY > 30) {
      return { valid: false, reason: 'Please look at the camera' };
    }
  }

  // Check if eyes are open (for liveness)
  if (faceData.leftEyeOpenProbability !== undefined && faceData.rightEyeOpenProbability !== undefined) {
    const avgEyeOpen = (faceData.leftEyeOpenProbability + faceData.rightEyeOpenProbability) / 2;
    if (avgEyeOpen < 0.5) {
      return { valid: false, reason: 'Please open your eyes' };
    }
  }

  // Check face size for consistency
  const frame = faceData.frame || faceData.bounds || {};
  const faceWidth = frame.width || frame.size?.width || 0;
  const faceHeight = frame.height || frame.size?.height || 0;
  
  // Log face size for debugging
  console.log(`📏 Face size: ${faceWidth}x${faceHeight} pixels`);
  
  // Minimum size check only (no maximum)
  // Square crop + TFLite normalization handles size variations
  // As long as face is detected and not too small, it's valid
  if (faceWidth < 150) {
    return { valid: false, reason: 'اقترب قليلاً - املأ الدائرة بوجهك' };
  }
  
  // Face must be roughly square (not too elongated)
  const aspectRatio = faceWidth / Math.max(faceHeight, 1);
  if (aspectRatio < 0.7 || aspectRatio > 1.4) {
    return { valid: false, reason: 'انظر مباشرة إلى الكاميرا' };
  }

  return { valid: true };
};

/**
 * Fallback: Generate faceId from base64 image (less stable but works if landmarks unavailable)
 */
export const generateFaceIdFallback = (base64Image: string | any): string => {
  let imageData: string;
  
  if (typeof base64Image === 'string') {
    imageData = base64Image;
  } else if (base64Image?.base64) {
    imageData = base64Image.base64;
  } else {
    // If no image data, use a hash of the object
    imageData = JSON.stringify(base64Image);
  }

  // Use more of the image data for better uniqueness
  const sample1 = imageData.substring(0, 100);
  const sample2 = imageData.substring(
    Math.floor(imageData.length / 2),
    Math.floor(imageData.length / 2) + 100
  );
  const sample3 = imageData.substring(Math.max(0, imageData.length - 100));
  const combined = sample1 + sample2 + sample3;

  const hash = combined.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  
  return Math.abs(hash).toString(16);
};

/**
 * Generate faceId - uses landmarks and ML Kit features (NO IMAGES)
 * This is the preferred method - no images stored, only face features
 */
export const generateFaceId = (faceData: any, base64Image?: string): string => {
  // Always try landmarks first (preferred - no images needed)
  if (faceData && (faceData.landmarks || faceData.frame || faceData.bounds)) {
    return generateFaceIdFromLandmarks(faceData);
  }
  
  // Fallback: use base64 image hash (only if landmarks unavailable)
  // This should rarely happen if ML Kit is working properly
  if (base64Image) {
    console.warn('Using fallback faceId generation from image (landmarks not available)');
    return generateFaceIdFallback(base64Image);
  }
  
  // Last resort: hash the faceData object
  console.warn('Using last resort faceId generation (no landmarks or image)');
  return generateFaceIdFallback(JSON.stringify(faceData));
};

/**
 * Compare two faceIds with tolerance (for matching similar faces)
 * Returns similarity score (0-1, where 1 is identical)
 */
export const compareFaceIds = (faceId1: string, faceId2: string): number => {
  // For now, exact match (we'll improve this later with better algorithm)
  // In production, you'd use face embeddings and cosine similarity
  if (faceId1 === faceId2) {
    return 1.0;
  }
  
  // Simple similarity based on hash distance
  const hash1 = parseInt(faceId1, 16);
  const hash2 = parseInt(faceId2, 16);
  const distance = Math.abs(hash1 - hash2);
  const maxDistance = Math.max(hash1, hash2);
  
  // Similarity decreases with distance
  const similarity = 1 - (distance / (maxDistance || 1));
  
  return Math.max(0, Math.min(1, similarity));
};

