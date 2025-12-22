import React, { useState, useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import { launchCamera, ImagePickerResponse, MediaType } from "react-native-image-picker";
import FaceDetector from "@react-native-ml-kit/face-detection";

interface AutoFaceCaptureProps {
  onFaceRegistered?: (imageUri: string, faceData: any) => void;
  onClose?: () => void;
}

export default function AutoFaceCapture({ onFaceRegistered, onClose }: AutoFaceCaptureProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const processFaceCapture = async (imageUri: string) => {
    try {
      setIsProcessing(true);
      console.log("Detecting face in image:", imageUri);
      
      // Detect face once
      const faces = await FaceDetector.detect(imageUri);
      
      if (faces.length > 0) {
        console.log("Face detected! Count:", faces.length);
        console.log("Face data:", faces);
        
        // TODO: Save face data to your backend/database
        // You can save the imageUri and faces data here
        
        // Call the callback if provided
        if (onFaceRegistered) {
          onFaceRegistered(imageUri, faces);
        }
        
        setIsProcessing(false);
        
        // Show success and close
        Alert.alert("Success", "Face detected and registered!", [
          {
            text: "OK",
            onPress: () => {
              if (onClose) {
                onClose();
              }
            },
          },
        ]);
      } else {
        setIsProcessing(false);
        Alert.alert("No Face Detected", "Please try again and make sure your face is clearly visible.", [
          {
            text: "Retry",
            onPress: takePicture,
          },
          {
            text: "Cancel",
            onPress: () => {
              if (onClose) {
                onClose();
              }
            },
          },
        ]);
      }
    } catch (error) {
      console.error("Face detection error:", error);
      setIsProcessing(false);
      Alert.alert("Error", "Failed to detect face. Please try again.", [
        {
          text: "Retry",
          onPress: takePicture,
        },
        {
          text: "Cancel",
          onPress: () => {
            if (onClose) {
              onClose();
            }
          },
        },
      ]);
    }
  };

  const takePicture = () => {
    setIsProcessing(true);
    launchCamera(
      {
        mediaType: "photo" as MediaType,
        quality: 0.9,
        cameraType: "front",
        saveToPhotos: false,
      },
      async (response: ImagePickerResponse) => {
        if (response.didCancel) {
          console.log("User cancelled image picker");
          setIsProcessing(false);
          if (onClose) {
            onClose();
          }
        } else if (response.errorMessage) {
          setIsProcessing(false);
          Alert.alert("Error", response.errorMessage);
        } else if (response.assets && response.assets[0]) {
          const uri = response.assets[0].uri;
          if (uri) {
            // Process face detection and registration
            await processFaceCapture(uri);
          } else {
            setIsProcessing(false);
            Alert.alert("Error", "Failed to get image URI");
          }
        } else {
          setIsProcessing(false);
        }
      }
    );
  };

  useEffect(() => {
    // Auto-capture when component mounts
    takePicture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>
          {isProcessing ? "Processing..." : "Preparing camera..."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  loadingContainer: {
    alignItems: "center",
    gap: 20,
  },
  loadingText: {
    color: "#fff",
    fontSize: 16,
    marginTop: 10,
  },
});

