import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StatusBar,
  Platform,
  Image,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { attendanceAPI } from '../services/api';
import { Attendance, Holiday, Location } from '../types';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getCurrentLocation, watchLocation, clearLocationWatch, LocationData } from '../services/location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CheckInModal from './CheckInModal';
import FaceCheckInModal from './FaceCheckInModal';
import { initializeSocket, onEmployeeApproved, onEmployeeRejected, offEmployeeApproved, offEmployeeRejected } from '../services/socket';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { enUS } from 'date-fns/locale';

// Calculate distance between two coordinates using Haversine formula
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return distance;
};

const toRadians = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};

const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user, checkAuth, setUser } = useAuth();
  const { t } = useTranslation();
  const { language } = useLanguage();
  const dateLocale = language === 'ar' ? require('date-fns/locale/ar').ar : enUS;
  const [todayAttendance, setTodayAttendance] = useState<Attendance | null>(null);
  const [isHoliday, setIsHoliday] = useState(false);
  const [holiday, setHoliday] = useState<Holiday | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [workingHours, setWorkingHours] = useState('00:00:00');
  const [distanceFromOffice, setDistanceFromOffice] = useState<string>('--');
  const [distanceFromOfficeMeters, setDistanceFromOfficeMeters] = useState<number | null>(null);
  const [showCheckInModal, setShowCheckInModal] = useState(false);
  const [showFaceCheckInModal, setShowFaceCheckInModal] = useState(false);
  const [checkModalType, setCheckModalType] = useState<'checkin' | 'checkout'>('checkin');
  const [officeLocation, setOfficeLocation] = useState<Location | null>(null);

  // Load initial data once on mount (non-blocking - render immediately)
  useEffect(() => {
    // Load office location first (fast, no API call)
    loadOfficeLocation();
    // Check if we need to clear yesterday's data (24 hour reset)
    checkAndClearOldAttendance();
    // Load attendance in background (don't block UI)
    loadTodayAttendance();
    
    // Initialize socket and listen for approval notifications
    let cleanup: (() => void) | null = null;
    
    const setupSocket = async () => {
      try {
        const socketInstance = await initializeSocket();
        
        // Listen for approval notification - Handle array or object
        const handleApproved = (data: any) => {
          console.log('🔔🔔🔔 RECEIVED approval notification - RAW:', data);
          console.log('   Type:', typeof data, 'Is Array?', Array.isArray(data));
          
          // Handle if data is an array - could be from socket.onAny
          let notificationData = data;
          if (Array.isArray(data)) {
            notificationData = data[0]; // Get first element if array
            console.log('   Extracted from array:', notificationData);
          } else if (data && typeof data === 'object' && data.length !== undefined) {
            // Handle array-like object
            notificationData = data[0] || data;
          }
          
          console.log('   Final processed data:', notificationData);
          
          const notificationEmployeeId = notificationData?.employeeId?.toString();
          const currentUserId = user?._id?.toString();
          
          console.log('   Comparing:', { notificationEmployeeId, currentUserId });
          
          // Check if this notification is for the current user
          if (notificationEmployeeId && currentUserId && notificationEmployeeId === currentUserId) {
            console.log('✅✅✅ MATCH! Updating user immediately...');
            
            // Update user state IMMEDIATELY
            if (user && setUser) {
              const updatedUser = { ...user, approvalStatus: 'approved' as const };
              setUser(updatedUser);
              AsyncStorage.setItem('user', JSON.stringify(updatedUser));
              console.log('✅ State updated - UI should refresh NOW');
            }
            
            // Show alert
            Alert.alert(
              'تمت الموافقة',
              notificationData.message || 'تمت الموافقة على طلب التسجيل الخاص بك',
              [{ text: 'حسناً' }]
            );
            
            // Refresh from API in background
            checkAuth().catch(err => console.error('Background refresh failed:', err));
          } else {
            console.log('⏭️ Not for this user, ignoring');
          }
        };
        
        // Listen for rejection notification - Handle array format
        const handleRejected = (data: any) => {
          console.log('🔔🔔🔔 RECEIVED rejection notification - RAW:', data);
          
          // Handle if data is an array (from socket.onAny wrapper)
          const notificationData = Array.isArray(data) ? data[0] : data;
          console.log('   Processed data:', notificationData);
          
          const notificationEmployeeId = notificationData?.employeeId?.toString();
          const currentUserId = user?._id?.toString();
          
          console.log('   Comparing IDs:', { notificationEmployeeId, currentUserId });
          
          // Check if this notification is for the current user
          if (notificationEmployeeId && currentUserId && notificationEmployeeId === currentUserId) {
            console.log('✅✅✅ MATCH! Updating user immediately...');
            
            // Update user state IMMEDIATELY
            if (user && setUser) {
              const updatedUser = { 
                ...user, 
                approvalStatus: 'rejected' as const,
                rejectionReason: notificationData.reason || null
              };
              setUser(updatedUser);
              AsyncStorage.setItem('user', JSON.stringify(updatedUser));
              console.log('✅ State updated - UI should refresh NOW');
            }
            
            // Show alert
            const message = `${notificationData.message || 'تم رفض طلب التسجيل'}${notificationData.reason ? `\nالسبب: ${notificationData.reason}` : ''}`;
            Alert.alert('تم رفض الطلب', message, [{ text: 'حسناً' }]);
            
            // Refresh from API in background
            checkAuth().catch(err => console.error('Background refresh failed:', err));
          } else {
            console.log('⏭️ Not for this user, ignoring');
          }
        };
        
        // Register listeners immediately - DIRECT socket.on for reliability
        if (socketInstance) {
          socketInstance.on('employeeApproved', handleApproved);
          socketInstance.on('employeeRejected', handleRejected);
          console.log('✅ Direct socket listeners registered');
        }
        
        // Also register via helper functions
        onEmployeeApproved(handleApproved);
        onEmployeeRejected(handleRejected);
        
        console.log('✅ Socket listeners registered for employee approval notifications');
        console.log('   Listening for: employeeApproved, employeeRejected');
        
        // Also register on connect event to ensure listeners are set up
        socketInstance?.on('connect', () => {
          console.log('🔄 Socket connected, ensuring listeners are registered');
          socketInstance.on('employeeApproved', handleApproved);
          socketInstance.on('employeeRejected', handleRejected);
          onEmployeeApproved(handleApproved);
          onEmployeeRejected(handleRejected);
        });
        
        // Setup reconnection handler to re-register listeners
        socketInstance?.on('reconnect', () => {
          console.log('🔄 Socket reconnected, re-registering listeners');
          socketInstance.on('employeeApproved', handleApproved);
          socketInstance.on('employeeRejected', handleRejected);
          onEmployeeApproved(handleApproved);
          onEmployeeRejected(handleRejected);
        });
        
        // ALSO handle from socket.onAny as fallback - data comes as array
        socketInstance?.onAny((eventName, ...args) => {
          if (eventName === 'employeeApproved') {
            console.log('📨 Got employeeApproved from onAny, calling handleApproved...');
            const data = args[0]; // First argument is the data
            handleApproved(data);
          } else if (eventName === 'employeeRejected') {
            console.log('📨 Got employeeRejected from onAny, calling handleRejected...');
            const data = args[0]; // First argument is the data
            handleRejected(data);
          }
        });
        
        // Store cleanup function
        cleanup = () => {
          console.log('🧹 Cleaning up socket listeners');
          offEmployeeApproved(handleApproved);
          offEmployeeRejected(handleRejected);
        };
      } catch (error) {
        console.error('❌ Error setting up socket:', error);
      }
    };
    
    setupSocket();
    
    // Cleanup on unmount
    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, []);

  // Update time and working hours every second, based on current attendance state
  // Also check if day has changed (midnight passed) and clear attendance
  useEffect(() => {
    let lastCheckedDate = new Date().getDate();
    
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);
      calculateWorkingHours();
      
      // Check if day has changed (midnight passed)
      if (now.getDate() !== lastCheckedDate) {
        console.log('🌙 Midnight passed - clearing attendance data');
        lastCheckedDate = now.getDate();
        setTodayAttendance(null);
        AsyncStorage.removeItem('todayAttendance');
      }
    }, 1000);
    
    return () => clearInterval(timer);
  }, [todayAttendance]);

  useEffect(() => {
    // Start watching location continuously (updates every 5 seconds or when moving 10m)
    // This keeps GPS "warmed up" and location ready for check-in
    if (officeLocation) {
      const updateDistance = (userLocation: LocationData) => {
        const distance = calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          officeLocation.latitude,
          officeLocation.longitude
        );
        // Save raw distance in meters for business rules (e.g. 10km check)
        setDistanceFromOfficeMeters(distance);
        // Convert to km if > 1000m, otherwise show in meters
        if (distance >= 1000) {
          setDistanceFromOffice(`${(distance / 1000).toFixed(1)} Km`);
        } else {
          setDistanceFromOffice(`${Math.round(distance)} m`);
        }
      };

      // Start watching location (updates continuously as user moves)
      const watchId = watchLocation(
        (location) => {
          updateDistance(location);
          // Cache location for check-in (so it's ready instantly)
          AsyncStorage.setItem('lastKnownLocation', JSON.stringify({
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp: Date.now()
          }));
        },
        (error) => {
          console.error('Location watch error:', error);
        }
      );

      return () => {
        clearLocationWatch(watchId);
      };
    }
  }, [officeLocation]);

  // Check if cached attendance is from today, clear if it's old (24+ hours)
  const checkAndClearOldAttendance = async () => {
    try {
      const cachedData = await AsyncStorage.getItem('todayAttendance');
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        const cachedDate = parsed.date ? new Date(parsed.date) : null;
        const today = new Date();
        
        // Check if cached data is from a different day
        if (cachedDate && 
            (cachedDate.getDate() !== today.getDate() ||
             cachedDate.getMonth() !== today.getMonth() ||
             cachedDate.getFullYear() !== today.getFullYear())) {
          console.log('🗑️ Clearing old attendance data (from previous day)');
          await AsyncStorage.removeItem('todayAttendance');
          setTodayAttendance(null);
        } else if (parsed.attendance) {
          // Load cached data from today (survives logout)
          console.log('✅ Loaded cached attendance from today');
          setTodayAttendance(parsed.attendance);
        }
      }
    } catch (error) {
      console.error('Error checking old attendance:', error);
    }
  };

  const loadTodayAttendance = async () => {
    try {
      // Don't set loading=true - render UI immediately, update when data arrives
      const data = await attendanceAPI.getToday();
      setTodayAttendance(data.attendance);
      setIsHoliday(data.isHoliday);
      setHoliday(data.holiday);
      
      // Cache attendance data with today's date (persists through logout)
      if (data.attendance) {
        await AsyncStorage.setItem('todayAttendance', JSON.stringify({
          date: new Date().toISOString(),
          attendance: data.attendance
        }));
      }
    } catch (error: any) {
      // Silently fail - user can still use the app
      // Network errors are expected if backend is down - don't spam console
      if (error.message !== 'Network Error' && error.code !== 'ERR_NETWORK') {
        console.error('Failed to load attendance:', error);
      }
      // If network fails, try to load from cache
      try {
        const cachedData = await AsyncStorage.getItem('todayAttendance');
        if (cachedData) {
          const parsed = JSON.parse(cachedData);
          if (parsed.attendance) {
            console.log('✅ Using cached attendance (network failed)');
            setTodayAttendance(parsed.attendance);
          }
        }
      } catch (cacheError) {
        console.error('Cache read error:', cacheError);
      }
    }
  };

  const loadOfficeLocation = async () => {
    try {
      // Use fixed office coordinates (shared from Google Maps)
      // 32°00'51.1\"N 35°52'22.9\"E  =>  32.014206, 35.873015
      setOfficeLocation({
        latitude: 32.014206,
        longitude: 35.873015,
      } as any);
    } catch (error) {
      console.error('Error loading office location:', error);
    }
  };

  const calculateWorkingHours = () => {
    // Only calculate hours AFTER checkout (not during check-in)
    if (!todayAttendance?.checkInTime || !todayAttendance?.checkOutTime) {
      setWorkingHours('00:00:00');
      return;
    }

    const checkIn = new Date(todayAttendance.checkInTime);
    const checkOut = new Date(todayAttendance.checkOutTime);

    const diff = checkOut.getTime() - checkIn.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    setWorkingHours(
      `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    );
  };

  const formatTime = (date: Date) => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? t('dates.pm') : t('dates.am');
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  };

  const formatDate = (date: Date) => {
    const days = [
      t('dates.days.sunday'),
      t('dates.days.monday'),
      t('dates.days.tuesday'),
      t('dates.days.wednesday'),
      t('dates.days.thursday'),
      t('dates.days.friday'),
      t('dates.days.saturday'),
    ];
    const months = [
      t('dates.months.january'),
      t('dates.months.february'),
      t('dates.months.march'),
      t('dates.months.april'),
      t('dates.months.may'),
      t('dates.months.june'),
      t('dates.months.july'),
      t('dates.months.august'),
      t('dates.months.september'),
      t('dates.months.october'),
      t('dates.months.november'),
      t('dates.months.december'),
    ];
    return `${days[date.getDay()]}, ${date.getDate()} ${months[date.getMonth()]}`;
  };

  const formatCheckInTime = (dateString?: string) => {
    if (!dateString) return '------';
    const date = new Date(dateString);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? t('dates.pm') : t('dates.am');
    const displayHours = hours % 12 || 12;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHours}:${displayMinutes} ${ampm}`;
  };

  const handleCheckIn = async () => {
    // Check approval status
    if (user?.approvalStatus === 'pending') {
      Alert.alert('انتظار الموافقة', 'يرجى انتظار موافقة المدير على طلب التسجيل قبل تسجيل الحضور');
      return;
    }
    if (user?.approvalStatus === 'rejected') {
      Alert.alert('تم رفض الطلب', 'تم رفض طلب التسجيل. لا يمكنك تسجيل الحضور.');
      return;
    }

    try {
      let distanceMeters = distanceFromOfficeMeters;

      // If we don't have a cached distance yet, try to get it now (auto detect location)
      if (distanceMeters == null) {
        if (!officeLocation) {
          Alert.alert('خطأ', 'لم يتم تحميل موقع المكتب بعد. يرجى المحاولة بعد لحظات.');
          return;
        }

        try {
          const userLocation = await getCurrentLocation();
          distanceMeters = calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            officeLocation.latitude,
            officeLocation.longitude
          );
          setDistanceFromOfficeMeters(distanceMeters);

          // Update friendly text as well
          if (distanceMeters >= 1000) {
            setDistanceFromOffice(`${(distanceMeters / 1000).toFixed(1)} Km`);
          } else {
            setDistanceFromOffice(`${Math.round(distanceMeters)} m`);
          }
        } catch (error) {
          console.error('Error getting location for check-in:', error);
          Alert.alert('خطأ', 'لا يمكن تحديد موقعك الحالي. يرجى التأكد من تفعيل GPS ثم المحاولة مرة أخرى.');
          return;
        }
      }

      // Business rule: must be within 10km of office location (expanded for testing)
      if (distanceMeters! > 10000) {
        Alert.alert('بعيد عن موقع العمل', 'لا يمكن تسجيل الحضور إذا كنت أبعد من 10 كم عن موقع الشركة.');
        return;
      }

      // Open fingerprint check-in modal instead of navigating
      setCheckModalType('checkin');
      setShowCheckInModal(true);
    } catch (error) {
      console.error('handleCheckIn error:', error);
      Alert.alert('خطأ', 'حدث خطأ أثناء محاولة تسجيل الحضور.');
    }
  };

  const handleCheckOut = () => {
    // Check approval status
    if (user?.approvalStatus === 'pending') {
      Alert.alert('انتظار الموافقة', 'يرجى انتظار موافقة المدير على طلب التسجيل قبل تسجيل الانصراف');
      return;
    }
    if (user?.approvalStatus === 'rejected') {
      Alert.alert('تم رفض الطلب', 'تم رفض طلب التسجيل. لا يمكنك تسجيل الانصراف.');
      return;
    }

    // For now, we don't enforce distance on checkout, just confirm with fingerprint
    setCheckModalType('checkout');
    setShowCheckInModal(true);
  };

  const isCheckedIn = todayAttendance?.checkInTime && !todayAttendance?.checkOutTime;
  const hasCheckedOut = todayAttendance?.checkOutTime;

  return (
    <View style={styles.container}>
      {/* Removed blocking loading overlay - render immediately, data updates when ready */}
      <StatusBar barStyle="dark-content" backgroundColor="#F8F9FA" />
      
      {/* Gradient Background Effect */}
      <View style={styles.gradientBackground} />
      
      {/* Navigation Bar (empty for now) */}
      <View style={styles.navBar} />

      {/* Profile Section */}
      <View style={styles.profileSection}>
        <View style={styles.profileImageContainer}>
          {user?.profileImage ? (
            <Image source={{ uri: user.profileImage }} style={styles.profileImage} />
          ) : (
            <View style={styles.profileImagePlaceholder}>
              <Icon name="account" size={40} color="#6366F1" />
            </View>
          )}
        </View>
        {/* Username under the profile image (without extra 'Welcome' label) */}
        <Text style={styles.welcomeText}>{user?.fullName || 'User'}</Text>
      </View>

      {/* Time and Date Display */}
      <View style={styles.timeSection}>
        <Text style={styles.timeText}>{formatTime(currentTime)}</Text>
        <Text style={styles.dateText}>{formatDate(currentTime)}</Text>
      </View>

      {/* Check In Buttons */}
      <View style={styles.checkInButtonContainer}>
        <View style={styles.checkButtonsRow}>
          <TouchableOpacity 
            style={[styles.checkInCircleButton, styles.checkInFingerprintButton]}
            onPress={isCheckedIn ? handleCheckOut : handleCheckIn}
            disabled={!!hasCheckedOut}
          >
            <Icon 
              name={isCheckedIn ? "fingerprint-off" : "fingerprint"} 
              size={44} 
              color="#FFFFFF" 
            />
            <Text style={styles.checkInButtonText}>
              {isCheckedIn ? t('home.checkOut') : t('home.checkIn')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.checkInCircleButton, styles.checkInFaceButton]}
            onPress={() => {
              if (isCheckedIn) {
                setCheckModalType('checkout');
                setShowFaceCheckInModal(true);
              } else {
                setCheckModalType('checkin');
                setShowFaceCheckInModal(true);
              }
            }}
            disabled={!!hasCheckedOut}
          >
            <Icon 
              name="face-recognition" 
              size={40} 
              color="#FFFFFF" 
            />
            <Text style={styles.checkInButtonText}>
              {isCheckedIn ? t('home.checkOutFace') : t('home.checkInFace')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Check-in / Check-out Biometric Modal (Fingerprint) */}
      <Modal
        visible={showCheckInModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCheckInModal(false)}
      >
        <CheckInModal
          type={checkModalType}
          onSuccess={async (checkInTime?: string, checkOutTime?: string) => {
            // Update UI immediately (optimistic update) - no need to fetch from backend
            const now = new Date().toISOString();
            let updatedAttendance: Attendance;
            
            if (checkModalType === 'checkin') {
              updatedAttendance = {
                _id: todayAttendance?._id || '',
                user: todayAttendance?.user || user?._id || '',
                date: new Date().toISOString(),
                checkInTime: checkInTime || now,
                checkOutTime: undefined,
                status: 'present',
                ...todayAttendance
              } as Attendance;
            } else {
              updatedAttendance = {
                ...todayAttendance,
                checkOutTime: checkOutTime || now
              } as Attendance;
            }
            
            setTodayAttendance(updatedAttendance);
            
            // Cache updated attendance (persists through logout)
            await AsyncStorage.setItem('todayAttendance', JSON.stringify({
              date: new Date().toISOString(),
              attendance: updatedAttendance
            }));
          }}
          onClose={() => setShowCheckInModal(false)}
        />
      </Modal>

      {/* Check-in / Check-out Face Modal */}
      <Modal
        visible={showFaceCheckInModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFaceCheckInModal(false)}
      >
        <FaceCheckInModal
          type={checkModalType}
          onSuccess={async (checkInTime?: string, checkOutTime?: string) => {
            // Update UI immediately (optimistic update) - no need to fetch from backend
            const now = new Date().toISOString();
            let updatedAttendance: Attendance;
            
            if (checkModalType === 'checkin') {
              updatedAttendance = {
                _id: todayAttendance?._id || '',
                user: todayAttendance?.user || user?._id || '',
                date: new Date().toISOString(),
                checkInTime: checkInTime || now,
                checkOutTime: undefined,
                status: 'present',
                ...todayAttendance
              } as Attendance;
            } else {
              updatedAttendance = {
                ...todayAttendance,
                checkOutTime: checkOutTime || now
              } as Attendance;
            }
            
            setTodayAttendance(updatedAttendance);
            
            // Cache updated attendance (persists through logout)
            await AsyncStorage.setItem('todayAttendance', JSON.stringify({
              date: new Date().toISOString(),
              attendance: updatedAttendance
            }));
          }}
          onClose={() => setShowFaceCheckInModal(false)}
        />
      </Modal>

      {/* Approval Status Message */}
      {user?.approvalStatus === 'pending' && (
        <View style={[styles.locationSection, { backgroundColor: '#FEF3C7', borderColor: '#F59E0B', borderWidth: 1, borderRadius: 8, padding: 12, marginHorizontal: 20, marginTop: 10 }]}>
          <Icon name="clock-alert-outline" size={20} color="#F59E0B" />
          <Text style={[styles.locationText, { color: '#92400E', fontWeight: '600', marginLeft: 8 }]}>
            يرجى انتظار موافقة المدير على طلب التسجيل. لا يمكنك تسجيل الحضور أو الانصراف حتى تتم الموافقة.
          </Text>
        </View>
      )}

      {user?.approvalStatus === 'rejected' && (
        <View style={[styles.locationSection, { backgroundColor: '#FEE2E2', borderColor: '#EF4444', borderWidth: 1, borderRadius: 8, padding: 12, marginHorizontal: 20, marginTop: 10 }]}>
          <Icon name="close-circle-outline" size={20} color="#EF4444" />
          <Text style={[styles.locationText, { color: '#991B1B', fontWeight: '600', marginLeft: 8 }]}>
            تم رفض طلب التسجيل. {user.rejectionReason ? `السبب: ${user.rejectionReason}` : 'لا يمكنك استخدام النظام.'}
          </Text>
        </View>
      )}

      {/* Location Info */}
      <View style={styles.locationSection}>
        <Icon name="map-marker" size={16} color="#6B7280" />
        <Text style={styles.locationText}>
          {t('home.distanceFromOffice', { distance: distanceFromOffice })}
        </Text>
      </View>

      {/* Bottom Cards */}
      <View style={styles.cardsContainer}>
        {/* Check In Card */}
        <View style={styles.card}>
          <Icon name="arrow-right-bold-box" size={24} color="#6366F1" />
          <Text style={styles.cardTime}>
            {formatCheckInTime(todayAttendance?.checkInTime)}
          </Text>
          <Text style={styles.cardLabel}>{t('home.checkIn')}</Text>
        </View>

        {/* Check Out Card */}
        <View style={styles.card}>
          <Icon name="arrow-left-bold-box" size={24} color="#6366F1" />
          <Text style={styles.cardTime}>
            {formatCheckInTime(todayAttendance?.checkOutTime)}
          </Text>
          <Text style={styles.cardLabel}>{t('home.checkOut')}</Text>
        </View>

        {/* Hours Worked Card */}
        <View style={styles.card}>
          <Icon name="clock-outline" size={24} color="#6366F1" />
          <Text style={styles.cardTime}>
            {todayAttendance?.checkInTime && todayAttendance?.checkOutTime
              ? workingHours.split(':').slice(0, 2).join(':')
              : '------'}
          </Text>
          <Text style={styles.cardLabel}>{t('home.hoursWorked')}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(248, 249, 250, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  gradientBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#E0E7FF',
    opacity: 0.3,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    // Slightly reduce top padding so header and profile move up
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 34,
    // Reduce bottom padding so profile section moves further up
    paddingBottom: 8,
  },
  navTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  profileSection: {
    alignItems: 'center',
    // Move profile image + username/welcome a bit further up
    marginTop: -26,
    marginBottom: 16,
  },
  profileImageContainer: {
    marginBottom: 12,
  },
  profileImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: '#6366F1',
  },
  profileImagePlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#6366F1',
  },
  welcomeText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1F2937',
  },
  timeSection: {
    alignItems: 'center',
    // Move time section slightly up
    marginBottom: 16,
  },
  timeText: {
    // Make time text a bit smaller
    fontSize: 34,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 4,
  },
  dateText: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  checkInButtonContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  checkInCircleButton: {
    // Smaller circle size for check-in buttons
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#6366F1',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
    // Gradient effect simulation with border
    borderWidth: 4,
    borderColor: '#818CF8',
  },
  checkInButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  checkButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkInFingerprintButton: {
    marginRight: 16,
  },
  checkInFaceButton: {
    backgroundColor: '#10B981',
    borderColor: '#6EE7B7',
  },
  locationSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
    paddingHorizontal: 20,
  },
  locationText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 8,
  },
  cardsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    width: '30%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTime: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginTop: 8,
    marginBottom: 4,
  },
  cardLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
});

export default HomeScreen;
