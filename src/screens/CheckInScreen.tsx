import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { attendanceAPI } from '../services/api';
import { getCurrentLocation, LocationData, LocationError } from '../services/location';
import { authenticateWithBiometrics } from '../services/biometrics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const CheckInScreen: React.FC<{ navigation: any; route?: any }> = ({ navigation, route }) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<LocationData | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [faceIdVerified, setFaceIdVerified] = useState(false);
  
  const isCheckOut = route?.params?.type === 'checkout';

  useEffect(() => {
    getCurrentLocationData();
  }, []);

  const getCurrentLocationData = async () => {
    setLocationLoading(true);
    try {
      const loc = await getCurrentLocation();
      setLocation(loc);
    } catch (error: any) {
      console.error('Location error:', error);
      Alert.alert(t('checkIn.error'), t('checkIn.locationFailed'));
    } finally {
      setLocationLoading(false);
    }
  };

  const handleBiometricAuth = async () => {
    try {
      const result = await authenticateWithBiometrics(
        isCheckOut ? t('checkIn.verifyIdentityCheckOut') : t('checkIn.verifyIdentityCheckIn'),
        t('checkIn.usePassword')
      );
      
      if (result.success) {
        setFaceIdVerified(true);
        return true;
      } else {
        Alert.alert(t('checkIn.verificationFailed'), result.message || t('checkIn.verificationFailed'));
        return false;
      }
    } catch (error: any) {
      Alert.alert(t('checkIn.error'), error.message || t('checkIn.verificationError'));
      return false;
    }
  };

  const handleCheckInOut = async () => {
    if (!location) {
      Alert.alert(t('checkIn.error'), t('checkIn.cannotGetLocation'));
      await getCurrentLocationData();
      return;
    }

    setLoading(true);
    try {
      // Authenticate with Face ID/Fingerprint
      const authenticated = await handleBiometricAuth();
      if (!authenticated) {
        setLoading(false);
        return;
      }

      // Proceed with check-in/check-out
      if (isCheckOut) {
        await attendanceAPI.checkOut({
          latitude: location.latitude,
          longitude: location.longitude,
          address: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
          faceIdVerified: true,
        });
        Alert.alert(t('checkIn.success'), t('checkIn.checkOutSuccess'), [
          { text: t('checkIn.ok'), onPress: () => navigation.goBack() }
        ]);
      } else {
        await attendanceAPI.checkIn({
          latitude: location.latitude,
          longitude: location.longitude,
          address: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
          faceIdVerified: true,
        });
        Alert.alert(t('checkIn.success'), t('checkIn.checkInSuccess'), [
          { text: t('checkIn.ok'), onPress: () => navigation.goBack() }
        ]);
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'حدث خطأ';
      Alert.alert('خطأ', errorMessage);
    } finally {
      setLoading(false);
      setFaceIdVerified(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Icon 
          name={isCheckOut ? "logout" : "fingerprint"} 
          size={80} 
          color={isCheckOut ? "#EF4444" : "#4F46E5"} 
        />
        <Text style={styles.title}>
          {isCheckOut ? 'تسجيل الانصراف' : 'تسجيل الحضور'}
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.infoSection}>
          <Icon name="map-marker" size={24} color="#4F46E5" />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>الموقع الجغرافي</Text>
            {locationLoading ? (
              <ActivityIndicator size="small" color="#4F46E5" />
            ) : location ? (
              <Text style={styles.infoValue}>
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </Text>
            ) : (
              <Text style={styles.errorText}>غير متوفر</Text>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={getCurrentLocationData}
          disabled={locationLoading}
        >
          <Icon name="refresh" size={20} color="#4F46E5" />
          <Text style={styles.refreshText}>تحديث الموقع</Text>
        </TouchableOpacity>

        <View style={styles.infoSection}>
          <Icon name="account" size={24} color="#4F46E5" />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>الموظف</Text>
            <Text style={styles.infoValue}>{user?.fullName}</Text>
          </View>
        </View>

        <View style={styles.infoSection}>
          <Icon name="clock" size={24} color="#4F46E5" />
          <View style={styles.infoContent}>
            <Text style={styles.infoLabel}>الوقت</Text>
            <Text style={styles.infoValue}>
              {new Date().toLocaleTimeString('ar-EG', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </Text>
          </View>
        </View>

        {faceIdVerified && (
          <View style={styles.verifiedBadge}>
            <Icon name="check-circle" size={24} color="#10B981" />
            <Text style={styles.verifiedText}>تم التحقق من الهوية</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.actionButton, isCheckOut && styles.checkoutButton, loading && styles.disabledButton]}
          onPress={handleCheckInOut}
          disabled={loading || locationLoading || !location}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Icon 
                name={isCheckOut ? "logout" : "fingerprint"} 
                size={24} 
                color="#FFF" 
              />
              <Text style={styles.actionButtonText}>
                {isCheckOut ? 'تسجيل الانصراف' : 'تسجيل الحضور'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.note}>
          * سيتم التحقق من الموقع والهوية قبل التسجيل
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    backgroundColor: '#FFF',
    alignItems: 'center',
    padding: 32,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginTop: 16,
  },
  card: {
    backgroundColor: '#FFF',
    margin: 16,
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  infoSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  infoContent: {
    flex: 1,
    marginLeft: 16,
  },
  infoLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  errorText: {
    fontSize: 14,
    color: '#EF4444',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  refreshText: {
    color: '#4F46E5',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
  },
  verifiedText: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  actionButton: {
    backgroundColor: '#4F46E5',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  checkoutButton: {
    backgroundColor: '#EF4444',
  },
  disabledButton: {
    opacity: 0.6,
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  note: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
});

export default CheckInScreen;












