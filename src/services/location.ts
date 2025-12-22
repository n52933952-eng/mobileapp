import Geolocation from 'react-native-geolocation-service';
import { Platform, PermissionsAndroid, Alert } from 'react-native';

export interface LocationData {
  latitude: number;
  longitude: number;
  address?: string;
  streetName?: string;
  fullAddress?: string;
}

export interface LocationError {
  code: number;
  message: string;
}

/**
 * Request location permissions
 */
export const requestLocationPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') {
    // iOS: react-native-geolocation-service requests permission automatically
    // We can check by trying to get location (it will prompt if needed)
    try {
      return new Promise((resolve) => {
        Geolocation.getCurrentPosition(
          () => {
            resolve(true);
          },
          (error) => {
            // Permission denied or location services disabled
            console.warn('iOS location permission error:', error);
            resolve(false);
          },
          {
            timeout: 5000,
            maximumAge: 0,
          }
        );
      });
    } catch (err) {
      console.warn('iOS location permission error:', err);
      return false;
    }
  }

  if (Platform.OS === 'android') {
    try {
      // Check if permission already granted
      const checkResult = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      
      if (checkResult) {
        return true;
      }

      // Request permission
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'صلاحية الموقع',
          message: 'يحتاج التطبيق إلى الوصول إلى موقعك للتحقق من الحضور',
          buttonNeutral: 'اسألني لاحقاً',
          buttonNegative: 'رفض',
          buttonPositive: 'موافق',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn('Android location permission error:', err);
      return false;
    }
  }

  return false;
};

/**
 * Get current location
 */
export const getCurrentLocation = (): Promise<LocationData> => {
  return new Promise(async (resolve, reject) => {
    // Request permission first
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      reject({
        code: 1,
        message: 'Location permission denied',
      } as LocationError);
      return;
    }

    // Check if location services are enabled
    Geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        console.error('Get location error:', error);
        reject({
          code: error.code,
          message: error.message || 'Failed to get location',
        } as LocationError);
      },
      {
        accuracy: {
          android: 'high',
          ios: 'best',
        },
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    );
  });
};

/**
 * Get address from coordinates (using reverse geocoding)
 * Uses OpenStreetMap Nominatim API (free, no API key required)
 */
export const getAddressFromCoordinates = async (
  latitude: number,
  longitude: number
): Promise<{ streetName: string; fullAddress: string } | null> => {
  try {
    // Using OpenStreetMap Nominatim API (free, no API key needed)
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'WorkSpotApp/1.0', // Required by Nominatim
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch address');
    }

    const data = await response.json();
    
    if (data && data.address) {
      const address = data.address;
      
      // Build street name
      const streetName = 
        address.road || 
        address.street || 
        address.pedestrian || 
        address.path || 
        'شارع غير معروف';
      
      // Build full address
      const addressParts = [];
      if (address.road || address.street) addressParts.push(address.road || address.street);
      if (address.house_number) addressParts.push(address.house_number);
      if (address.neighbourhood || address.suburb) addressParts.push(address.neighbourhood || address.suburb);
      if (address.city || address.town || address.village) addressParts.push(address.city || address.town || address.village);
      if (address.state) addressParts.push(address.state);
      if (address.country) addressParts.push(address.country);
      
      const fullAddress = addressParts.length > 0 
        ? addressParts.join(', ') 
        : data.display_name || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      
      return {
        streetName: streetName,
        fullAddress: fullAddress,
      };
    }
    
    // Fallback to coordinates
    return {
      streetName: 'موقع غير معروف',
      fullAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    };
  } catch (error) {
    console.error('Get address error:', error);
    // Fallback to coordinates
    return {
      streetName: 'موقع غير معروف',
      fullAddress: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    };
  }
};

/**
 * Watch location changes
 */
export const watchLocation = (
  onLocationUpdate: (location: LocationData) => void,
  onError?: (error: LocationError) => void
): number => {
  const watchId = Geolocation.watchPosition(
    (position) => {
      onLocationUpdate({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    },
    (error) => {
      if (onError) {
        onError({
          code: error.code,
          message: error.message || 'Location watch error',
        });
      }
    },
    {
      accuracy: {
        android: 'high',
        ios: 'best',
      },
      enableHighAccuracy: true,
      distanceFilter: 10, // Update every 10 meters
      interval: 5000,
      fastestInterval: 2000,
    }
  );

  return watchId;
};

/**
 * Stop watching location
 */
export const clearLocationWatch = (watchId: number): void => {
  Geolocation.clearWatch(watchId);
};
