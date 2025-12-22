import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { authenticateWithBiometrics } from '../services/biometrics';
import { getCurrentLocation } from '../services/location';
import { attendanceAPI } from '../services/api';

interface CheckInModalProps {
  type: 'checkin' | 'checkout';
  onSuccess: (checkInTime?: string, checkOutTime?: string) => Promise<void> | void;
  onClose: () => void;
}

const CheckInModal: React.FC<CheckInModalProps> = ({ type, onSuccess, onClose }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    handleCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCheck = async () => {
    try {
      setLoading(true);

      // 1) Get current location
      const location = await getCurrentLocation();

      // 2) Biometric auth (fingerprint / face ID)
      const result = await authenticateWithBiometrics(
        type === 'checkout'
          ? t('checkIn.verifyIdentityCheckOut')
          : t('checkIn.verifyIdentityCheckIn'),
        t('checkIn.usePassword')
      );

      if (!result.success) {
        Alert.alert(t('checkIn.verificationFailed'), result.message || t('checkIn.verificationFailed'));
        onClose();
        return;
      }

      // 3) Call attendance API (still saves to backend for admin)
      // IMPORTANT: Don't send faceIdVerified for fingerprint-only check-in
      // That flag triggers face verification, which we don't want here
      const checkTime = new Date().toISOString();
      let response;
      
      if (type === 'checkout') {
        response = await attendanceAPI.checkOut({
          latitude: location.latitude,
          longitude: location.longitude,
          address: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
          // NO face data - fingerprint-only authentication
        });
        // Update UI immediately (optimistic update)
        await Promise.resolve(onSuccess(undefined, checkTime));
        Alert.alert(t('checkIn.success'), t('checkIn.checkOutSuccess'));
      } else {
        response = await attendanceAPI.checkIn({
          latitude: location.latitude,
          longitude: location.longitude,
          address: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
          // NO face data - fingerprint-only authentication
        });
        // Update UI immediately (optimistic update)
        await Promise.resolve(onSuccess(checkTime, undefined));
        Alert.alert(t('checkIn.success'), t('checkIn.checkInSuccess'));
      }
      
      onClose();
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || t('checkIn.error');
      Alert.alert(t('checkIn.error'), errorMessage, [
        {
          text: t('checkIn.ok'),
          onPress: () => {
            onClose();
          },
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Icon
            name={type === 'checkout' ? 'fingerprint-off' : 'fingerprint'}
            size={40}
            color="#4F46E5"
          />
        </View>
        <Text style={styles.title}>
          {type === 'checkout' ? 'تأكيد الانصراف بالبصمة' : 'تأكيد الحضور بالبصمة'}
        </Text>
        <Text style={styles.subtitle}>
          يرجى لمس مستشعر البصمة لإكمال {type === 'checkout' ? 'تسجيل الانصراف' : 'تسجيل الحضور'}.
        </Text>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#4F46E5" />
            <Text style={styles.loadingText}>جارٍ التحقق من الهوية والموقع...</Text>
          </View>
        ) : (
          <TouchableOpacity style={styles.retryButton} onPress={handleCheck}>
            <Icon name="refresh" size={20} color="#4F46E5" />
            <Text style={styles.retryText}>المحاولة مرة أخرى</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>إلغاء</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '80%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  loadingContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4F46E5',
    marginTop: 8,
  },
  retryText: {
    marginLeft: 8,
    fontSize: 14,
    color: '#4F46E5',
    fontWeight: '600',
  },
  cancelButton: {
    marginTop: 12,
  },
  cancelText: {
    fontSize: 14,
    color: '#6B7280',
  },
});

export default CheckInModal;
















