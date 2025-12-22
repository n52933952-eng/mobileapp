import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Modal, TextInput, Alert, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { holidayAPI, leaveAPI } from '../services/api';
import { Holiday, Leave } from '../types';
import { format, parseISO, isFuture, isPast, isToday, differenceInDays } from 'date-fns';
import { ar } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';
import { pick, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { 
  initializeSocket, 
  onHolidayCreated, 
  onHolidayUpdated, 
  onHolidayDeleted,
  offHolidayCreated,
  offHolidayUpdated,
  offHolidayDeleted,
  onLeaveApproved,
  onLeaveRejected,
  offLeaveApproved,
  offLeaveRejected,
  disconnectSocket
} from '../services/socket';

const LeavesScreen: React.FC = () => {
  const { user } = useAuth(); // Get current user for validation
  const { t } = useTranslation();
  const { language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [activeTab, setActiveTab] = useState<'holidays' | 'leaves'>('holidays');
  
  // Holidays state
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [upcomingHolidays, setUpcomingHolidays] = useState<Holiday[]>([]);
  
  // Leaves state
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [isRequestModalVisible, setIsRequestModalVisible] = useState(false);
  const [dismissedLeaveIds, setDismissedLeaveIds] = useState<Set<string>>(new Set());
  
  // Notification state
  const [notification, setNotification] = useState<{
    visible: boolean;
    type: 'approved' | 'rejected';
    title: string;
    message: string;
    leave?: Leave;
  } | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'upcoming' | 'past'>('upcoming');

  // Leave form state
  const [leaveForm, setLeaveForm] = useState({
    type: 'sick' as 'annual' | 'sick' | 'emergency' | 'unpaid' | 'half-day',
    startDate: '',
    endDate: '',
    reason: '',
    pdfFile: null as { uri: string; name: string; type: string; size: number } | null,
  });
  const [uploadingPDF, setUploadingPDF] = useState(false);

  // Date picker state
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [tempStartDate, setTempStartDate] = useState(new Date());
  const [tempEndDate, setTempEndDate] = useState(new Date());

  // Socket.io event handlers for holidays
  const handleHolidayCreated = useCallback((newHoliday: Holiday) => {
    console.log('🎉 Real-time: Holiday created', newHoliday);
    setHolidays(prev => [...prev, newHoliday]);
    
    if (isFuture(parseISO(newHoliday.startDate)) || isToday(parseISO(newHoliday.startDate))) {
      setUpcomingHolidays(prev => [...prev, newHoliday].slice(0, 3));
    }
  }, []);

  const handleHolidayUpdated = useCallback((updatedHoliday: Holiday) => {
    console.log('✏️ Real-time: Holiday updated', updatedHoliday);
    setHolidays(prev => 
      prev.map(h => h._id === updatedHoliday._id ? updatedHoliday : h)
    );
    setUpcomingHolidays(prev => 
      prev.map(h => h._id === updatedHoliday._id ? updatedHoliday : h)
    );
  }, []);

  const handleHolidayDeleted = useCallback((data: { id: string }) => {
    console.log('🗑️ Real-time: Holiday deleted', data.id);
    setHolidays(prev => prev.filter(h => h._id !== data.id));
    setUpcomingHolidays(prev => prev.filter(h => h._id !== data.id));
  }, []);

  // Socket.io event handlers for leaves
  const handleLeaveApproved = useCallback((approvedLeave: Leave) => {
    console.log('✅ Real-time: Leave approved', approvedLeave);
    
    // Validate: Only process if this leave belongs to the current user
    const leaveUserId = typeof approvedLeave.user === 'object' ? approvedLeave.user._id : approvedLeave.user;
    const currentUserId = user?._id;
    
    if (!currentUserId || leaveUserId?.toString() !== currentUserId.toString()) {
      console.log('⚠️ [Socket.io] Received leave approval for different user, ignoring...');
      return; // Ignore notifications for other users
    }
    
    setLeaves(prev => {
      // Don't add if dismissed
      if (dismissedLeaveIds.has(approvedLeave._id)) {
        return prev;
      }
      // Update or add the leave
      const existingIndex = prev.findIndex(l => l._id === approvedLeave._id);
      if (existingIndex >= 0) {
        return prev.map(l => l._id === approvedLeave._id ? approvedLeave : l);
      }
      return [...prev, approvedLeave];
    });
    setNotification({
      visible: true,
      type: 'approved',
      title: '🎉 تمت الموافقة!',
      message: `تمت الموافقة على طلب الإجازة الخاص بك.\nالنوع: ${getLeaveTypeLabel(approvedLeave.type).label}\nالمدة: ${approvedLeave.days} يوم`,
      leave: approvedLeave
    });
  }, [dismissedLeaveIds, user]);

  const handleLeaveRejected = useCallback((data: { leave: Leave; rejectionReason: string }) => {
    console.log('❌ Real-time: Leave rejected', data);
    
    // Validate: Only process if this leave belongs to the current user
    const leaveUserId = typeof data.leave.user === 'object' ? data.leave.user._id : data.leave.user;
    const currentUserId = user?._id;
    
    if (!currentUserId || leaveUserId?.toString() !== currentUserId.toString()) {
      console.log('⚠️ [Socket.io] Received leave rejection for different user, ignoring...');
      return; // Ignore notifications for other users
    }
    
    setLeaves(prev => {
      // Don't add if dismissed
      if (dismissedLeaveIds.has(data.leave._id)) {
        return prev;
      }
      // Update or add the leave
      const existingIndex = prev.findIndex(l => l._id === data.leave._id);
      if (existingIndex >= 0) {
        return prev.map(l => l._id === data.leave._id ? data.leave : l);
      }
      return [...prev, data.leave];
    });
    setNotification({
      visible: true,
      type: 'rejected',
      title: '❌ تم رفض الطلب',
      message: `تم رفض طلب الإجازة الخاص بك.\n\nالسبب: ${data.rejectionReason}`,
      leave: data.leave
    });
  }, [dismissedLeaveIds, user]);

  const handleDismissNotification = useCallback(() => {
    setNotification(null);
  }, []);

  // Load dismissed leave IDs from storage
  useEffect(() => {
    const loadDismissedLeaves = async () => {
      try {
        const dismissed = await AsyncStorage.getItem('dismissedLeaveIds');
        if (dismissed) {
          const ids = JSON.parse(dismissed);
          setDismissedLeaveIds(new Set(ids));
        }
      } catch (error) {
        console.error('Error loading dismissed leaves:', error);
      }
    };
    loadDismissedLeaves();
  }, []);

  // Reload leaves when dismissed IDs change (to filter them out)
  useEffect(() => {
    if (dismissedLeaveIds.size >= 0) { // Always reload to apply filter
      loadLeaves();
    }
  }, [dismissedLeaveIds.size, loadLeaves]);

  useEffect(() => {
    loadHolidays();
    loadLeaves();
    
    const setupSocket = async () => {
      try {
        await initializeSocket();
        
        // Register holiday listeners
        onHolidayCreated(handleHolidayCreated);
        onHolidayUpdated(handleHolidayUpdated);
        onHolidayDeleted(handleHolidayDeleted);
        console.log('✅ Socket.io listeners registered for holidays');
        
        // Register leave listeners
        onLeaveApproved(handleLeaveApproved);
        onLeaveRejected(handleLeaveRejected);
        console.log('✅ Socket.io listeners registered for leaves');
      } catch (error) {
        console.error('Error setting up socket:', error);
      }
    };

    setupSocket();

    return () => {
      // Cleanup holiday listeners
      offHolidayCreated(handleHolidayCreated);
      offHolidayUpdated(handleHolidayUpdated);
      offHolidayDeleted(handleHolidayDeleted);
      
      // Cleanup leave listeners
      offLeaveApproved(handleLeaveApproved);
      offLeaveRejected(handleLeaveRejected);
    };
  }, [handleHolidayCreated, handleHolidayUpdated, handleHolidayDeleted, handleLeaveApproved, handleLeaveRejected]);

  const loadHolidays = async () => {
    try {
      setLoading(true);
      const currentYear = new Date().getFullYear();
      const [holidaysData, upcomingData] = await Promise.all([
        holidayAPI.getHolidays(currentYear),
        holidayAPI.getUpcoming(),
      ]);
      
      setHolidays(holidaysData.holidays || []);
      setUpcomingHolidays(upcomingData.holidays || []);
    } catch (error) {
      console.error('Error loading holidays:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLeaves = useCallback(async () => {
    try {
      const data = await leaveAPI.getMyLeaves();
      // Filter out dismissed leaves
      const filteredLeaves = (data.leaves || []).filter(
        leave => !dismissedLeaveIds.has(leave._id)
      );
      setLeaves(filteredLeaves);
    } catch (error) {
      console.error('Error loading leaves:', error);
    }
  }, [dismissedLeaveIds]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadHolidays(), loadLeaves()]);
    setRefreshing(false);
  };

  const handleStartDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowStartDatePicker(false);
    }
    
    if (selectedDate) {
      setTempStartDate(selectedDate);
      const formattedDate = format(selectedDate, 'yyyy-MM-dd');
      setLeaveForm({ ...leaveForm, startDate: formattedDate });
      
      if (Platform.OS === 'ios') {
        // For iOS, close picker after selection
        setShowStartDatePicker(false);
      }
    }
  };

  const handleEndDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowEndDatePicker(false);
    }
    
    if (selectedDate) {
      setTempEndDate(selectedDate);
      const formattedDate = format(selectedDate, 'yyyy-MM-dd');
      setLeaveForm({ ...leaveForm, endDate: formattedDate });
      
      if (Platform.OS === 'ios') {
        setShowEndDatePicker(false);
      }
    }
  };

  const handleSelectPDF = async () => {
    try {
      const result = await pick({
        type: ['application/pdf'],
        copyTo: 'cachesDirectory',
      });

      if (isErrorWithCode(result)) {
        if (result.code !== errorCodes.canceled) {
          Alert.alert(t('leaves.error'), result.message || 'Failed to select PDF');
        }
        return;
      }

      if (result && result.length > 0) {
        const file = result[0];
        let fileUri = file.uri;

        // Handle content:// URIs on Android
        if (fileUri.startsWith('content://')) {
          try {
            // Copy to a temporary file:// URI
            const tempPath = `${RNFS.CachesDirectoryPath}/${Date.now()}_${file.name || 'document.pdf'}`;
            await RNFS.copyFile(fileUri, tempPath);
            fileUri = `file://${tempPath}`;
          } catch (copyError) {
            console.error('Error copying file:', copyError);
            Alert.alert(t('leaves.error'), 'Failed to process PDF file');
            return;
          }
        }

        setLeaveForm({
          ...leaveForm,
          pdfFile: {
            uri: fileUri,
            name: file.name || 'document.pdf',
            type: file.type || 'application/pdf',
            size: file.size || 0,
          },
        });
      }
    } catch (error: any) {
      console.error('Error selecting PDF:', error);
      Alert.alert(t('leaves.error'), error.message || 'Failed to select PDF');
    }
  };

  const handleRemovePDF = () => {
    setLeaveForm({ ...leaveForm, pdfFile: null });
  };

  const handleSubmitLeave = async () => {
    if (!leaveForm.startDate || !leaveForm.endDate || !leaveForm.reason.trim()) {
      Alert.alert(t('leaves.error'), t('leaves.fillAllFields'));
      return;
    }

    try {
      setUploadingPDF(!!leaveForm.pdfFile);
      await leaveAPI.createLeave({
        type: leaveForm.type,
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        reason: leaveForm.reason.trim(),
        pdfFile: leaveForm.pdfFile,
      });

      Alert.alert(t('leaves.success'), t('leaves.leaveRequestSent'));
      setIsRequestModalVisible(false);
      setLeaveForm({
        type: 'sick',
        startDate: '',
        endDate: '',
        reason: '',
        pdfFile: null,
      });
      setTempStartDate(new Date());
      setTempEndDate(new Date());
      setUploadingPDF(false);
      loadLeaves();
    } catch (error: any) {
      setUploadingPDF(false);
      Alert.alert(t('leaves.error'), error.message || t('leaves.requestFailed'));
    }
  };

  const handleCancelLeave = async (leaveId: string) => {
    Alert.alert(
      t('leaves.confirmCancel'),
      t('leaves.confirmCancelMessage'),
      [
        { text: t('leaves.no'), style: 'cancel' },
        {
          text: t('leaves.yes'),
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveAPI.cancelLeave(leaveId);
              Alert.alert(t('leaves.success'), t('leaves.requestCancelled'));
              loadLeaves();
            } catch (error: any) {
              Alert.alert(t('leaves.error'), error.message || t('leaves.cancelFailed'));
            }
          },
        },
      ]
    );
  };

  const handleDismissLeave = async (leaveId: string) => {
    // Add to dismissed set
    const newDismissed = new Set(dismissedLeaveIds);
    newDismissed.add(leaveId);
    setDismissedLeaveIds(newDismissed);
    
    // Save to AsyncStorage
    try {
      await AsyncStorage.setItem('dismissedLeaveIds', JSON.stringify(Array.from(newDismissed)));
    } catch (error) {
      console.error('Error saving dismissed leaves:', error);
    }
    
    // Remove from local state to clear it from view
    setLeaves(prev => prev.filter(l => l._id !== leaveId));
  };

  const getLeaveTypeLabel = (type: string) => {
    const types: any = {
      annual: { label: t('leaves.leaveTypes.annual'), color: '#3B82F6', icon: 'calendar-month' },
      sick: { label: t('leaves.leaveTypes.sick'), color: '#EF4444', icon: 'medical-bag' },
      emergency: { label: t('leaves.leaveTypes.emergency'), color: '#F59E0B', icon: 'alert-circle' },
      unpaid: { label: t('leaves.leaveTypes.unpaid'), color: '#6B7280', icon: 'cash-remove' },
      'half-day': { label: t('leaves.leaveTypes.halfDay'), color: '#8B5CF6', icon: 'clock-outline' },
    };
    return types[type] || types.annual;
  };

  const getLeaveStatusColor = (status: string) => {
    const colors: any = {
      pending: '#F59E0B',
      approved: '#10B981',
      rejected: '#EF4444',
      cancelled: '#6B7280',
    };
    return colors[status] || '#6B7280';
  };

  const getLeaveStatusLabel = (status: string) => {
    const labels: any = {
      pending: t('leaves.status.pending'),
      approved: t('leaves.status.approved'),
      rejected: t('leaves.status.rejected'),
      cancelled: t('leaves.status.cancelled'),
    };
    return labels[status] || status;
  };

  // Holiday rendering functions (same as before)
  const getHolidayTypeColor = (type: string) => {
    switch (type) {
      case 'national': return '#EF4444';
      case 'religious': return '#10B981';
      case 'company': return '#3B82F6';
      case 'custom': return '#8B5CF6';
      default: return '#6B7280';
    }
  };

  const getHolidayTypeIcon = (type: string) => {
    switch (type) {
      case 'national': return 'flag';
      case 'religious': return 'mosque';
      case 'company': return 'office-building';
      case 'custom': return 'calendar-star';
      default: return 'calendar';
    }
  };

  const getHolidayTypeName = (type: string) => {
    switch (type) {
      case 'national': return t('attendance.holidayTypes.national');
      case 'religious': return t('attendance.holidayTypes.religious');
      case 'company': return t('attendance.holidayTypes.company');
      case 'custom': return t('attendance.holidayTypes.custom');
      default: return type;
    }
  };

  const getFilteredHolidays = () => {
    const now = new Date();
    if (selectedFilter === 'upcoming') {
      return holidays.filter(h => isFuture(parseISO(h.startDate)) || isToday(parseISO(h.startDate)));
    } else if (selectedFilter === 'past') {
      return holidays.filter(h => isPast(parseISO(h.endDate)) && !isToday(parseISO(h.endDate)));
    }
    return holidays;
  };

  const getDaysUntil = (date: string) => {
    const days = differenceInDays(parseISO(date), new Date());
    if (days === 0) return t('attendance.today');
    if (days === 1) return language === 'ar' ? 'غداً' : 'Tomorrow';
    if (days < 0) return language === 'ar' ? 'منتهي' : 'Expired';
    return language === 'ar' ? `بعد ${days} أيام` : `In ${days} days`;
  };

  const renderHolidayCard = (holiday: Holiday, isUpcoming: boolean = false) => {
    const startDate = parseISO(holiday.startDate);
    const endDate = parseISO(holiday.endDate);
    const isMultiDay = format(startDate, 'yyyy-MM-dd') !== format(endDate, 'yyyy-MM-dd');
    const color = getHolidayTypeColor(holiday.type);

    return (
      <View key={holiday._id} style={[styles.holidayCard, isUpcoming && styles.upcomingCard]}>
        <View style={[styles.holidayColorBar, { backgroundColor: color }]} />
        <View style={styles.holidayContent}>
          <View style={styles.holidayHeader}>
            <View style={styles.holidayTitleRow}>
              <Icon name={getHolidayTypeIcon(holiday.type)} size={24} color={color} />
              <Text style={styles.holidayName}>{holiday.nameAr || holiday.name}</Text>
            </View>
            <View style={[styles.holidayTypeBadge, { backgroundColor: color + '20' }]}>
              <Text style={[styles.holidayTypeText, { color }]}>
                {getHolidayTypeName(holiday.type)}
              </Text>
            </View>
          </View>

          <View style={styles.holidayDetails}>
            <View style={styles.holidayDetailRow}>
              <Icon name="calendar" size={18} color="#6B7280" />
              <Text style={styles.holidayDetailText}>
                {format(startDate, 'dd MMMM yyyy', { locale: dateLocale })}
                {isMultiDay && ` - ${format(endDate, 'dd MMMM yyyy', { locale: dateLocale })}`}
              </Text>
            </View>

            {isUpcoming && (
              <View style={styles.holidayDetailRow}>
                <Icon name="clock-outline" size={18} color="#10B981" />
                <Text style={[styles.holidayDetailText, { color: '#10B981', fontWeight: '600' }]}>
                  {getDaysUntil(holiday.startDate)}
                </Text>
              </View>
            )}

            {holiday.description && (
              <View style={styles.holidayDetailRow}>
                <Icon name="information-outline" size={18} color="#6B7280" />
                <Text style={styles.holidayDetailText}>{holiday.description}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderLeaveCard = (leave: Leave) => {
    const typeInfo = getLeaveTypeLabel(leave.type);
    const statusColor = getLeaveStatusColor(leave.status);
    const startDate = parseISO(leave.startDate);
    const endDate = parseISO(leave.endDate);
    const isMultiDay = format(startDate, 'yyyy-MM-dd') !== format(endDate, 'yyyy-MM-dd');

    return (
      <View key={leave._id} style={styles.leaveCard}>
        <View style={[styles.holidayColorBar, { backgroundColor: typeInfo.color }]} />
        <View style={styles.leaveContent}>
          <View style={styles.leaveHeader}>
            <View style={styles.leaveTitleRow}>
              <Icon name={typeInfo.icon} size={24} color={typeInfo.color} />
              <View style={styles.leaveTitleTextContainer}>
                <Text style={styles.leaveTitle}>{typeInfo.label} {t('leaves.leaveType')}</Text>
                <Text style={styles.leaveReason}>{leave.reason}</Text>
              </View>
            </View>
            <View style={styles.leaveStatusContainer}>
              <View style={[styles.leaveStatusBadge, { backgroundColor: statusColor }]}>
                <Text style={styles.leaveStatusText}>{getLeaveStatusLabel(leave.status)}</Text>
              </View>
              {leave.status === 'pending' && (
                <TouchableOpacity
                  style={styles.cancelIconButton}
                  onPress={() => handleCancelLeave(leave._id)}
                >
                  <Icon name="close-circle" size={24} color="#EF4444" />
                </TouchableOpacity>
              )}
              {(leave.status === 'approved' || leave.status === 'rejected') && (
                <TouchableOpacity
                  style={styles.dismissIconButton}
                  onPress={() => handleDismissLeave(leave._id)}
                >
                  <Icon name="close" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.leaveDetails}>
            <View style={styles.leaveDetailRow}>
              <Icon name="calendar-range" size={18} color="#6B7280" />
              <Text style={styles.leaveDetailText}>
                {format(startDate, 'dd MMM yyyy', { locale: dateLocale })}
                {isMultiDay && ` - ${format(endDate, 'dd MMM yyyy', { locale: dateLocale })}`}
              </Text>
            </View>

            <View style={styles.leaveDetailRow}>
              <Icon name="calendar-clock" size={18} color="#6B7280" />
              <Text style={styles.leaveDetailText}>{leave.days} {t('leaves.days')}</Text>
            </View>

            {leave.status === 'rejected' && leave.rejectionReason && (
              <View style={styles.rejectionReasonBox}>
                <Icon name="alert-circle" size={18} color="#EF4444" />
                <Text style={styles.rejectionReasonText}>{leave.rejectionReason}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>{t('leaves.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header with Tabs */}
      <View style={styles.header}>
        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'holidays' && styles.activeTab]}
            onPress={() => setActiveTab('holidays')}
          >
            <Icon name="calendar-star" size={20} color={activeTab === 'holidays' ? '#FFFFFF' : '#6B7280'} />
            <Text style={[styles.tabText, activeTab === 'holidays' && styles.activeTabText]}>
              {t('leaves.officialHolidays')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'leaves' && styles.activeTab]}
            onPress={() => setActiveTab('leaves')}
          >
            <Icon name="briefcase-clock" size={20} color={activeTab === 'leaves' ? '#FFFFFF' : '#6B7280'} />
            <Text style={[styles.tabText, activeTab === 'leaves' && styles.activeTabText]}>
              {t('leaves.myLeaves')}
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'leaves' && (
          <TouchableOpacity
            style={styles.requestButton}
            onPress={() => setIsRequestModalVisible(true)}
          >
            <Icon name="plus-circle" size={20} color="#FFFFFF" />
            <Text style={styles.requestButtonText}>{t('leaves.requestLeave')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#3B82F6']} />
        }
      >
        {activeTab === 'holidays' ? (
          <>
            {/* Upcoming Holidays Section */}
            {upcomingHolidays.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Icon name="calendar-star" size={24} color="#EF4444" />
                  <Text style={styles.sectionTitle}>العطل القادمة</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{upcomingHolidays.length}</Text>
                  </View>
                </View>
                {upcomingHolidays.map((holiday) => renderHolidayCard(holiday, true))}
              </View>
            )}

            {/* Filter Buttons */}
            <View style={styles.filterContainer}>
              <TouchableOpacity
                style={[styles.filterButton, selectedFilter === 'upcoming' && styles.filterButtonActive]}
                onPress={() => setSelectedFilter('upcoming')}
              >
                <Text style={[styles.filterButtonText, selectedFilter === 'upcoming' && styles.filterButtonTextActive]}>
                  {t('leaves.filter.upcoming')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterButton, selectedFilter === 'all' && styles.filterButtonActive]}
                onPress={() => setSelectedFilter('all')}
              >
                <Text style={[styles.filterButtonText, selectedFilter === 'all' && styles.filterButtonTextActive]}>
                  {t('leaves.filter.all')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.filterButton, selectedFilter === 'past' && styles.filterButtonActive]}
                onPress={() => setSelectedFilter('past')}
              >
                <Text style={[styles.filterButtonText, selectedFilter === 'past' && styles.filterButtonTextActive]}>
                  {t('leaves.filter.past')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* All Holidays Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name="calendar-multiple" size={24} color="#3B82F6" />
                <Text style={styles.sectionTitle}>
                  {selectedFilter === 'upcoming' ? t('leaves.upcomingHolidays') : selectedFilter === 'past' ? t('leaves.pastHolidays') : t('leaves.allHolidays')}
                </Text>
              </View>
              {getFilteredHolidays().length > 0 ? (
                getFilteredHolidays().map((holiday) => renderHolidayCard(holiday, false))
              ) : (
                <View style={styles.emptyState}>
                  <Icon name="calendar-blank" size={64} color="#D1D5DB" />
                  <Text style={styles.emptyStateText}>{t('leaves.noHolidays')}</Text>
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            {/* My Leaves Section */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Icon name="briefcase-clock" size={24} color="#3B82F6" />
                <Text style={styles.sectionTitle}>{t('leaves.leaveRequests')}</Text>
              </View>
              {leaves.length > 0 ? (
                leaves.map((leave) => renderLeaveCard(leave))
              ) : (
                <View style={styles.emptyState}>
                  <Icon name="briefcase-off" size={64} color="#D1D5DB" />
                  <Text style={styles.emptyStateText}>{t('leaves.noLeaves')}</Text>
                  <TouchableOpacity
                    style={styles.emptyStateButton}
                    onPress={() => setIsRequestModalVisible(true)}
                  >
                    <Text style={styles.emptyStateButtonText}>{t('leaves.requestNewLeave')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {/* Request Leave Modal */}
      <Modal
        visible={isRequestModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsRequestModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('leaves.newLeaveRequest')}</Text>
              <TouchableOpacity onPress={() => setIsRequestModalVisible(false)}>
                <Icon name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <ScrollView 
              style={styles.modalBody}
              contentContainerStyle={styles.modalBodyContent}
              showsVerticalScrollIndicator={true}
            >
              <Text style={styles.inputLabel}>{t('leaves.leaveType')}</Text>
              <View style={styles.typeSelector}>
                {(['sick', 'annual', 'emergency', 'unpaid', 'half-day'] as const).map((type) => {
                  const typeInfo = getLeaveTypeLabel(type);
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[
                        styles.typeOption,
                        leaveForm.type === type && { backgroundColor: typeInfo.color, borderColor: typeInfo.color }
                      ]}
                      onPress={() => setLeaveForm({ ...leaveForm, type })}
                    >
                      <Icon
                        name={typeInfo.icon}
                        size={20}
                        color={leaveForm.type === type ? '#FFFFFF' : '#6B7280'}
                      />
                      <Text style={[
                        styles.typeOptionText,
                        leaveForm.type === type && { color: '#FFFFFF' }
                      ]}>
                        {typeInfo.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.inputLabel}>{t('leaves.startDate')}</Text>
              <TouchableOpacity
                style={styles.datePickerButton}
                onPress={() => setShowStartDatePicker(true)}
              >
                <Icon name="calendar" size={20} color="#6B7280" />
                <Text style={styles.datePickerText}>
                  {leaveForm.startDate || t('leaves.selectStartDate')}
                </Text>
              </TouchableOpacity>

              {showStartDatePicker && (
                <DateTimePicker
                  value={tempStartDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleStartDateChange}
                  minimumDate={new Date()}
                />
              )}

              <Text style={styles.inputLabel}>{t('leaves.endDate')}</Text>
              <TouchableOpacity
                style={styles.datePickerButton}
                onPress={() => setShowEndDatePicker(true)}
              >
                <Icon name="calendar" size={20} color="#6B7280" />
                <Text style={styles.datePickerText}>
                  {leaveForm.endDate || t('leaves.selectEndDate')}
                </Text>
              </TouchableOpacity>

              {showEndDatePicker && (
                <DateTimePicker
                  value={tempEndDate}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleEndDateChange}
                  minimumDate={tempStartDate}
                />
              )}

              <Text style={styles.inputLabel}>{t('leaves.reason')}</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={t('leaves.enterReasonPlaceholder')}
                value={leaveForm.reason}
                onChangeText={(text) => setLeaveForm({ ...leaveForm, reason: text })}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              {/* PDF Attachment Section */}
              <Text style={styles.inputLabel}>{t('leaves.attachPDF')}</Text>
              {leaveForm.pdfFile ? (
                <View style={styles.pdfFileContainer}>
                  <Icon name="file-pdf-box" size={24} color="#EF4444" />
                  <View style={styles.pdfFileInfo}>
                    <Text style={styles.pdfFileName} numberOfLines={1}>
                      {leaveForm.pdfFile.name}
                    </Text>
                    <Text style={styles.pdfFileSize}>
                      {(leaveForm.pdfFile.size / 1024).toFixed(2)} KB
                    </Text>
                  </View>
                  <TouchableOpacity onPress={handleRemovePDF} style={styles.removeFileButton}>
                    <Icon name="close-circle" size={24} color="#EF4444" />
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.pdfPickerButton}
                  onPress={handleSelectPDF}
                  disabled={uploadingPDF}
                >
                  <Icon name="file-plus" size={20} color="#3B82F6" />
                  <Text style={styles.pdfPickerText}>
                    {uploadingPDF ? t('leaves.uploadingFile') : t('leaves.selectPDF')}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity 
                style={[styles.submitButton, uploadingPDF && styles.submitButtonDisabled]} 
                onPress={handleSubmitLeave}
                disabled={uploadingPDF}
              >
                {uploadingPDF ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Icon name="send" size={20} color="#FFFFFF" />
                )}
                <Text style={styles.submitButtonText}>{t('leaves.submit')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Notification Modal for Approval/Rejection */}
      {notification && notification.visible && (
        <Modal
          visible={true}
          transparent={true}
          animationType="fade"
          onRequestClose={handleDismissNotification}
        >
          <View style={styles.notificationOverlay}>
            <View style={[
              styles.notificationCard,
              notification.type === 'approved' ? styles.notificationCardSuccess : styles.notificationCardError
            ]}>
              <View style={styles.notificationHeader}>
                <Text style={styles.notificationTitle}>{notification.title}</Text>
                <TouchableOpacity
                  style={styles.notificationCloseButton}
                  onPress={handleDismissNotification}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close-circle" size={28} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
              <Text style={styles.notificationMessage}>{notification.message}</Text>
              <TouchableOpacity
                style={[
                  styles.notificationButton,
                  notification.type === 'approved' ? styles.notificationButtonSuccess : styles.notificationButtonError
                ]}
                onPress={handleDismissNotification}
              >
                <Text style={styles.notificationButtonText}>حسناً</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#6B7280',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingHorizontal: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    gap: 8,
  },
  activeTab: {
    backgroundColor: '#3B82F6',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#FFFFFF',
  },
  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#10B981',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  requestButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
    marginLeft: 8,
    flex: 1,
  },
  badge: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 28,
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  holidayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  upcomingCard: {
    borderWidth: 2,
    borderColor: '#10B98120',
  },
  holidayColorBar: {
    width: 6,
  },
  holidayContent: {
    flex: 1,
    padding: 16,
  },
  holidayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  holidayTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  holidayName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginLeft: 8,
    flex: 1,
  },
  holidayTypeBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 8,
  },
  holidayTypeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  holidayDetails: {
    gap: 8,
  },
  holidayDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  holidayDetailText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 8,
    flex: 1,
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  filterButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  filterButtonActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  filterButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  emptyStateText: {
    marginTop: 12,
    fontSize: 16,
    color: '#9CA3AF',
  },
  emptyStateButton: {
    marginTop: 16,
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  emptyStateButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  leaveCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  leaveContent: {
    flex: 1,
    padding: 16,
  },
  leaveHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  leaveTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 8,
  },
  leaveTitleTextContainer: {
    flex: 1,
  },
  leaveTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
  },
  leaveReason: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  leaveStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  leaveStatusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  leaveStatusText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  cancelIconButton: {
    padding: 4,
  },
  dismissIconButton: {
    padding: 4,
  },
  leaveDetails: {
    gap: 8,
  },
  leaveDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  leaveDetailText: {
    fontSize: 14,
    color: '#6B7280',
    marginLeft: 8,
  },
  rejectionReasonBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FEE2E2',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
    gap: 8,
  },
  rejectionReasonText: {
    fontSize: 13,
    color: '#DC2626',
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  modalBody: {
    padding: 20,
  },
  modalBodyContent: {
    paddingBottom: 40,
  },
  pdfPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  pdfPickerText: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '600',
  },
  pdfFileContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  pdfFileInfo: {
    flex: 1,
  },
  pdfFileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
  },
  pdfFileSize: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  removeFileButton: {
    padding: 4,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: '#1F2937',
  },
  datePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  datePickerText: {
    fontSize: 16,
    color: '#1F2937',
    flex: 1,
  },
  textArea: {
    height: 100,
  },
  typeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    gap: 6,
  },
  typeOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
    gap: 8,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  notificationOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  notificationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  notificationCardSuccess: {
    borderLeftWidth: 5,
    borderLeftColor: '#10B981',
  },
  notificationCardError: {
    borderLeftWidth: 5,
    borderLeftColor: '#EF4444',
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  notificationTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    flex: 1,
    marginRight: 12,
  },
  notificationCloseButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationMessage: {
    fontSize: 16,
    color: '#4B5563',
    lineHeight: 24,
    marginBottom: 20,
  },
  notificationButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
  },
  notificationButtonSuccess: {
    backgroundColor: '#10B981',
  },
  notificationButtonError: {
    backgroundColor: '#EF4444',
  },
  notificationButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default LeavesScreen;
