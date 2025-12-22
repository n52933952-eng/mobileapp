import React, { useState } from "react";
import { View, Image, StyleSheet, Dimensions } from "react-native";
import { useRoute } from "@react-navigation/native";

interface RouteParams {
  imageUri: string;
  faceData?: any[];
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export default function FaceResultScreen() {
  const route = useRoute();
  const { imageUri, faceData = [] } = (route.params as RouteParams) || {};
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  const onImageLoad = (event: any) => {
    const { width, height } = event.nativeEvent.source;
    setImageSize({ width, height });
  };

  // Calculate face box positions
  const getFaceBoxes = () => {
    if (!imageSize.width || !imageSize.height || faceData.length === 0) {
      return [];
    }

    const imageAspectRatio = imageSize.width / imageSize.height;
    const screenAspectRatio = SCREEN_WIDTH / SCREEN_HEIGHT;

    let displayWidth = SCREEN_WIDTH;
    let displayHeight = SCREEN_HEIGHT;
    let offsetX = 0;
    let offsetY = 0;

    if (imageAspectRatio > screenAspectRatio) {
      // Image is wider - fit to width
      displayHeight = SCREEN_WIDTH / imageAspectRatio;
      offsetY = (SCREEN_HEIGHT - displayHeight) / 2;
    } else {
      // Image is taller - fit to height
      displayWidth = SCREEN_HEIGHT * imageAspectRatio;
      offsetX = (SCREEN_WIDTH - displayWidth) / 2;
    }

    return faceData.map((face: any) => {
      // ML Kit face detection returns: { bounds: { origin: { x, y }, size: { width, height } } }
      let left = 0, top = 0, width = 0, height = 0;
      
      if (face.bounds) {
        // ML Kit format
        if (face.bounds.origin) {
          left = face.bounds.origin.x || 0;
          top = face.bounds.origin.y || 0;
        }
        if (face.bounds.size) {
          width = face.bounds.size.width || 0;
          height = face.bounds.size.height || 0;
        }
      } else if (face.boundingBox) {
        // Alternative format
        left = face.boundingBox.x || face.boundingBox.left || 0;
        top = face.boundingBox.y || face.boundingBox.top || 0;
        width = face.boundingBox.width || (face.boundingBox.right - left) || 0;
        height = face.boundingBox.height || (face.boundingBox.bottom - top) || 0;
      } else {
        // Direct properties
        left = face.x || face.left || 0;
        top = face.y || face.top || 0;
        width = face.width || 0;
        height = face.height || 0;
      }

      console.log("Face bounds:", { left, top, width, height });
      console.log("Image size:", imageSize);
      console.log("Display size:", { displayWidth, displayHeight, offsetX, offsetY });

      // Scale coordinates to display size
      const scaleX = displayWidth / imageSize.width;
      const scaleY = displayHeight / imageSize.height;

      return {
        left: left * scaleX + offsetX,
        top: top * scaleY + offsetY,
        width: width * scaleX,
        height: height * scaleY,
      };
    });
  };

  const faceBoxes = getFaceBoxes();

  return (
    <View style={styles.container}>
      {imageUri ? (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="cover"
            onLoad={onImageLoad}
          />
          {faceBoxes.map((box, index) => (
            <View
              key={index}
              style={[
                styles.faceBox,
                {
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                },
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyContainer} />
      )}
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
  imageContainer: {
    width: "100%",
    height: "100%",
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  faceBox: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#00FF00",
    backgroundColor: "transparent",
  },
  emptyContainer: {
    flex: 1,
    width: "100%",
  },
});

