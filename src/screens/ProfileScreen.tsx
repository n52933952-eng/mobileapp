import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, RefreshControl } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

const ProfileScreen: React.FC = () => {
  const { user, logout, enableBiometric, biometricAvailable, biometricType, checkAuth } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);

  const handleLogout = async () => {
    Alert.alert(
      t('profile.confirmLogout'),
      t('profile.confirmLogoutMessage'),
      [
        { text: t('leaves.cancel'), style: 'cancel' },
        {
          text: t('profile.logout'),
          style: 'destructive',
          onPress: async () => {
            try {
              await logout();
            } catch (error: any) {
              Alert.alert(t('leaves.error'), t('profile.logoutFailed'));
            }
          },
        },
      ]
    );
  };

  const handleEnableBiometric = async () => {
    try {
      await enableBiometric();
      Alert.alert(t('leaves.success'), t('profile.biometricEnabled'));
    } catch (error: any) {
      Alert.alert(t('leaves.error'), error.message || t('profile.enableBiometric'));
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      // Refresh user data from server
      if (checkAuth) {
        await checkAuth();
      }
    } catch (error) {
      console.error('Error refreshing profile:', error);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView 
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={['#4F46E5']}
          tintColor="#4F46E5"
        />
      }
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Icon name="account" size={60} color="#4F46E5" />
        </View>
        <Text style={styles.name}>{user?.fullName}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <Text style={styles.employeeNumber}>رقم الموظف: {user?.employeeNumber}</Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{t('profile.employeeInfo')}</Text>
          <View style={styles.refreshHint}>
            <Icon name="arrow-down" size={18} color="#4F46E5" />
            <Text style={styles.refreshHintText}>{t('profile.pullDown')}</Text>
          </View>
        </View>
        
        {/* Language Switcher - Integrated with Employee Info */}
        <View style={styles.languageSwitcherInline}>
          <Text style={styles.languageLabel}>{t('profile.language')}:</Text>
          <TouchableOpacity
            style={styles.langButtonInline}
            onPress={() => setLanguage(language === 'en' ? 'ar' : 'en')}
          >
            <Text style={styles.langButtonTextInline}>
              {language === 'en' ? 'EN' : 'AR'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('profile.department')}:</Text>
          <Text style={styles.infoValue}>{user?.department || t('profile.notSpecified')}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('profile.position')}:</Text>
          <Text style={styles.infoValue}>{user?.position || t('profile.notSpecified')}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('profile.role')}:</Text>
          <Text style={styles.infoValue}>
            {user?.role === 'employee' ? t('profile.employee') : user?.role === 'hr' ? t('profile.hr') : user?.role === 'admin' ? t('profile.admin') : t('profile.generalManager')}
          </Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>{t('profile.attendancePoints')}:</Text>
          <Text style={[
            styles.infoValue,
            (user?.attendancePoints || 0) < 0 && styles.negativePoints
          ]}>
            {user?.attendancePoints || 0}
          </Text>
        </View>
        {(user?.attendancePoints || 0) < 0 && (
          <Text style={styles.pointsExplanation}>
            {t('profile.negativePointsExplanation')}
          </Text>
        )}
      </View>

      {biometricAvailable && !user?.faceIdEnabled && (
        <TouchableOpacity style={styles.button} onPress={handleEnableBiometric}>
          <Icon name="fingerprint" size={24} color="#4F46E5" />
          <Text style={styles.buttonText}>{t('profile.enableBiometric')}</Text>
        </TouchableOpacity>
      )}

      {user?.faceIdEnabled && (
        <View style={styles.section}>
          <View style={styles.infoRow}>
            <Icon name="check-circle" size={24} color="#10B981" />
            <Text style={styles.enabledText}>{t('profile.biometricEnabled')}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity style={[styles.button, styles.logoutButton]} onPress={handleLogout}>
        <Icon name="logout" size={24} color="#EF4444" />
        <Text style={[styles.buttonText, styles.logoutText]}>{t('profile.logout')}</Text>
      </TouchableOpacity>
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
    padding: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 4,
  },
  employeeNumber: {
    fontSize: 14,
    color: '#6B7280',
  },
  section: {
    backgroundColor: '#FFF',
    marginTop: 16,
    padding: 20,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  refreshHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  refreshHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4F46E5',
  },
  languageSwitcherInline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  languageLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  langButtonInline: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#4F46E5',
    borderWidth: 1,
    borderColor: '#4F46E5',
    minWidth: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langButtonTextInline: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  infoLabel: {
    fontSize: 14,
    color: '#6B7280',
    flex: 1,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    flex: 1,
    textAlign: 'right',
  },
  negativePoints: {
    color: '#EF4444',
  },
  pointsExplanation: {
    fontSize: 12,
    color: '#6B7280',
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'right',
  },
  enabledText: {
    fontSize: 14,
    color: '#10B981',
    fontWeight: '600',
    marginLeft: 8,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    margin: 16,
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4F46E5',
    marginLeft: 8,
  },
  logoutButton: {
    borderColor: '#FEE2E2',
    backgroundColor: '#FEF2F2',
  },
  logoutText: {
    color: '#EF4444',
  },
  languageSwitcher: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    marginTop: 8,
  },
  langButton: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#4F46E5',
    borderWidth: 1,
    borderColor: '#4F46E5',
    minWidth: 50,
    alignItems: 'center',
  },
  langButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default ProfileScreen;












