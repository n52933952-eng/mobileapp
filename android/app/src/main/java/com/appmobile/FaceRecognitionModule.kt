package com.appmobile

import android.content.res.AssetFileDescriptor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.facebook.react.bridge.*
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

class FaceRecognitionModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private var interpreter: Interpreter? = null
    private val INPUT_SIZE = 112
    private val OUTPUT_SIZE = 192
    private val IMAGE_MEAN = 128.0f
    private val IMAGE_STD = 128.0f
    private val MODEL_FILE = "mobile_face_net.tflite"
    
    init {
        try {
            val modelBuffer = loadModelFile()
            interpreter = Interpreter(modelBuffer)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    override fun getName(): String {
        return "FaceRecognitionModule"
    }
    
    @ReactMethod
    fun generateEmbedding(imagePath: String, promise: Promise) {
        generateEmbeddingWithCrop(imagePath, null, promise)
    }
    
    @ReactMethod
    fun generateEmbeddingWithCrop(imagePath: String, cropRect: ReadableMap?, promise: Promise) {
        try {
            if (interpreter == null) {
                promise.reject("MODEL_NOT_LOADED", "TensorFlow Lite model not loaded")
                return
            }
            
            // Load bitmap from file path
            val bitmap = BitmapFactory.decodeFile(imagePath)
            if (bitmap == null) {
                promise.reject("INVALID_IMAGE", "Could not load image from path: $imagePath")
                return
            }
            
            var processedBitmap = bitmap
            
            // Crop face region if crop coordinates provided
            if (cropRect != null) {
                try {
                    val x = cropRect.getInt("x")
                    val y = cropRect.getInt("y")
                    val width = cropRect.getInt("width")
                    val height = cropRect.getInt("height")
                    
                    // Ensure crop coordinates are within bitmap bounds
                    val cropX = x.coerceIn(0, bitmap.width)
                    val cropY = y.coerceIn(0, bitmap.height)
                    val cropWidth = width.coerceIn(0, bitmap.width - cropX)
                    val cropHeight = height.coerceIn(0, bitmap.height - cropY)
                    
                    if (cropWidth > 0 && cropHeight > 0) {
                        processedBitmap = Bitmap.createBitmap(bitmap, cropX, cropY, cropWidth, cropHeight)
                    }
                } catch (e: Exception) {
                    // If cropping fails, use full image
                    println("Warning: Failed to crop image, using full image: ${e.message}")
                }
            }
            
            // Resize to 112x112 using NEAREST NEIGHBOR (no interpolation) for consistency
            // Using false = no filtering = nearest neighbor = deterministic
            val resizedBitmap = Bitmap.createScaledBitmap(processedBitmap, INPUT_SIZE, INPUT_SIZE, false)
            
            // Generate embedding
            val embedding = processImage(resizedBitmap)
            
            // Convert to WritableArray for React Native
            val result = Arguments.createArray()
            for (value in embedding) {
                result.pushDouble(value.toDouble())
            }
            
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("EMBEDDING_ERROR", "Error generating embedding: ${e.message}", e)
        }
    }
    
    private fun processImage(bitmap: Bitmap): FloatArray {
        // Create ByteBuffer for input
        val imgData = ByteBuffer.allocateDirect(1 * INPUT_SIZE * INPUT_SIZE * 3 * 4)
        imgData.order(ByteOrder.nativeOrder())
        
        val intValues = IntArray(INPUT_SIZE * INPUT_SIZE)
        bitmap.getPixels(intValues, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        
        imgData.rewind()
        
        // Normalize pixels: (pixel - IMAGE_MEAN) / IMAGE_STD
        for (i in 0 until INPUT_SIZE) {
            for (j in 0 until INPUT_SIZE) {
                val pixelValue = intValues[i * INPUT_SIZE + j]
                imgData.putFloat((((pixelValue shr 16) and 0xFF) - IMAGE_MEAN) / IMAGE_STD)
                imgData.putFloat((((pixelValue shr 8) and 0xFF) - IMAGE_MEAN) / IMAGE_STD)
                imgData.putFloat(((pixelValue and 0xFF) - IMAGE_MEAN) / IMAGE_STD)
            }
        }
        
        // Prepare output
        val embeddings = Array(1) { FloatArray(OUTPUT_SIZE) }
        val outputMap = HashMap<Int, Any>()
        outputMap[0] = embeddings
        
        // Run inference
        interpreter?.runForMultipleInputsOutputs(arrayOf(imgData), outputMap)
        
        return embeddings[0]
    }
    
    private fun loadModelFile(): MappedByteBuffer {
        val assetManager = reactApplicationContext.assets
        val fileDescriptor: AssetFileDescriptor = assetManager.openFd(MODEL_FILE)
        val inputStream = FileInputStream(fileDescriptor.fileDescriptor)
        val fileChannel = inputStream.channel
        val startOffset = fileDescriptor.startOffset
        val declaredLength = fileDescriptor.declaredLength
        return fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
    }
}

