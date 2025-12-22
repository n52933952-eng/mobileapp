import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Dimensions, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useFocusEffect } from '@react-navigation/native';
import { attendanceAPI } from '../services/api';
import { Attendance, Holiday } from '../types';
import { format, parseISO, startOfWeek, endOfWeek, addWeeks, subWeeks, addDays, isToday, isSameDay, isWithinInterval } from 'date-fns';
import { ar } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';

const AttendanceScreen: React.FC = () => {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [statistics, setStatistics] = useState({
    totalPresent: 0,
    totalLate: 0,
    totalAbsent: 0,
    totalHolidays: 0,
    totalWorkingHours: 0,
    totalOvertime: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedWeekStart, setSelectedWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );
  const [showWeekPicker, setShowWeekPicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(new Date());

  // Calculate dynamic margin based on screen height
  const dynamicMarginBottom = useMemo(() => {
    const { height } = Dimensions.get('window');
    // Calculate as percentage of screen height (approximately 40% works for -350 on most screens)
    return -(height * 0.4);
  }, []);

  const weekRange = useMemo(() => {
    const start = startOfWeek(selectedWeekStart, { weekStartsOn: 0 });
    const end = endOfWeek(selectedWeekStart, { weekStartsOn: 0 });
    return { start, end };
  }, [selectedWeekStart]);

  const weekDays = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      days.push(addDays(weekRange.start, i));
    }
    return days;
  }, [weekRange.start]);

  const isCurrentWeek = useMemo(() => {
    return isWithinInterval(new Date(), {
      start: weekRange.start,
      end: weekRange.end,
    });
  }, [weekRange.start, weekRange.end]);

  const weekRangeLabel = useMemo(() => {
    const startLabel = format(weekRange.start, 'd MMMM', { locale: dateLocale });
    const endLabel = format(weekRange.end, 'd MMMM', { locale: dateLocale });
    return `${startLabel} - ${endLabel}`;
  }, [weekRange.start, weekRange.end]);

  const weekLabelTitle = useMemo(() => {
    return isCurrentWeek ? t('attendance.thisWeek') : format(weekRange.start, 'MMMM yyyy', { locale: dateLocale });
  }, [isCurrentWeek, weekRange.start]);

  const loadWeeklyAttendance = useCallback(async (start: Date, end: Date) => {
    try {
      setLoading(true);
      const data = await attendanceAPI.getWeekly(start.toISOString(), end.toISOString());
      console.log('📊 Attendance data from API:', data);
      setAttendances(data.attendances || []);
      setHolidays(data.holidays || []);
      
      // Set statistics from database
      if (data.statistics) {
        console.log('✅ Statistics from database:', data.statistics);
        setStatistics({
          totalPresent: data.statistics.totalPresent || 0,
          totalLate: data.statistics.totalLate || 0,
          totalAbsent: data.statistics.totalAbsent || 0,
          totalHolidays: data.statistics.totalHolidays || 0,
          totalWorkingHours: data.statistics.totalWorkingHours || 0,
          totalOvertime: data.statistics.totalOvertime || 0,
        });
      } else {
        console.warn('⚠️ No statistics in API response, using defaults');
        setStatistics({
          totalPresent: 0,
          totalLate: 0,
          totalAbsent: 0,
          totalHolidays: 0,
          totalWorkingHours: 0,
          totalOvertime: 0,
        });
      }
    } catch (error: any) {
      console.error('❌ Error loading attendance:', error);
      // Keep existing statistics on error, don't reset to zeros
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadWeeklyAttendance(weekRange.start, weekRange.end);
    }, [loadWeeklyAttendance, weekRange.start, weekRange.end])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadWeeklyAttendance(weekRange.start, weekRange.end);
  }, [loadWeeklyAttendance, weekRange.start, weekRange.end]);

  const handlePrevWeek = useCallback(() => {
    setSelectedWeekStart(prev => subWeeks(prev, 1));
  }, []);

  const handleNextWeek = useCallback(() => {
    setSelectedWeekStart(prev => addWeeks(prev, 1));
  }, []);

  const handleOpenWeekPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: selectedWeekStart,
        mode: 'date',
        display: 'default',
        onChange: (event, date) => handleWeekPickerChange(event, date),
      });
      return;
    }

    setPickerDate(selectedWeekStart);
    setShowWeekPicker(true);
  };

  const handleWeekPickerChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        return;
      }
    }

    if (!date) {
      if (Platform.OS === 'ios') {
        setShowWeekPicker(false);
      }
      return;
    }

    const normalized = startOfWeek(date, { weekStartsOn: 0 });
    setPickerDate(normalized);
    setSelectedWeekStart(normalized);

    if (Platform.OS === 'ios') {
      setShowWeekPicker(false);
    }
  };

  const getHolidayTypeLabel = (type?: Holiday['type']) => {
    switch (type) {
      case 'national':
        return t('attendance.holidayTypes.national');
      case 'religious':
        return t('attendance.holidayTypes.religious');
      case 'company':
        return t('attendance.holidayTypes.company');
      case 'custom':
        return t('attendance.holidayTypes.custom');
      default:
        return t('attendance.holidayTypes.national');
    }
  };

  const getStatusBadge = (attendance: Attendance) => {
    if (attendance.status === 'holiday' || attendance.isHoliday) {
      return { text: t('attendance.status.holiday'), color: '#F59E0B', icon: 'calendar-star' };
    }
    if (attendance.status === 'leave' || attendance.isOnLeave) {
      return { text: t('attendance.status.leave'), color: '#8B5CF6', icon: 'calendar-clock' };
    }
    if (attendance.status === 'present') {
      return { text: t('attendance.status.present'), color: '#10B981', icon: 'check-circle' };
    }
    if (attendance.status === 'late') {
      return { text: t('attendance.status.late'), color: '#F97316', icon: 'clock-alert' };
    }
    if (attendance.status === 'absent') {
      return { text: t('attendance.status.absent'), color: '#EF4444', icon: 'close-circle' };
    }
    if (attendance.status === 'half-day') {
      return { text: t('attendance.status.halfDay'), color: '#6366F1', icon: 'clock-outline' };
    }
    return { text: t('attendance.status.present'), color: '#6B7280', icon: 'help-circle' };
  };

  const formatTime = (timeString?: string) => {
    if (!timeString) return '-';
    try {
      const date = parseISO(timeString);
      return format(date, 'HH:mm', { locale: dateLocale });
    } catch {
      return timeString;
    }
  };

  const formatWorkingHours = (minutes?: number) => {
    if (!minutes) return '0:00';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
  };

  const weeklyDisplayItems = useMemo(() => {
    return weekDays.map((day) => {
      const attendanceForDay = attendances.find(att => {
        try {
          const attDate = parseISO(att.date);
          return isSameDay(attDate, day);
        } catch {
          return false;
        }
      });

      const holidayForDay = holidays.find(holiday => {
        try {
          const start = parseISO(holiday.startDate);
          const end = parseISO(holiday.endDate);
          start.setHours(0, 0, 0, 0);
          end.setHours(23, 59, 59, 999);
          return day >= start && day <= end;
        } catch {
          return false;
        }
      });

      return {
        date: day,
        attendance: attendanceForDay,
        holiday: holidayForDay,
      };
    });
  }, [attendances, holidays, weekDays]);

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>{t('attendance.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('attendance.title')}</Text>
        <View style={styles.weekSelector}>
          <TouchableOpacity style={styles.weekNavButton} onPress={handlePrevWeek}>
            <Icon name="chevron-right" size={22} color="#1F2937" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.weekLabelButton} onPress={handleOpenWeekPicker}>
            <Icon name="calendar-week" size={24} color="#2563EB" style={styles.weekLabelIcon} />
            <View style={styles.weekLabelTextContainer}>
              <Text style={styles.weekLabelTitle}>{weekLabelTitle}</Text>
              <Text style={styles.weekLabelRange}>{weekRangeLabel}</Text>
            </View>
            <Icon name="chevron-down" size={22} color="#6B7280" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.weekNavButton} onPress={handleNextWeek}>
            <Icon name="chevron-left" size={22} color="#1F2937" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Statistics Cards */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.statsContainer, { marginBottom: dynamicMarginBottom }]}>
        <View style={styles.statCard}>
          <Icon name="check-circle" size={24} color="#10B981" style={styles.statIcon} />
          <Text style={styles.statValue}>{statistics.totalPresent}</Text>
          <Text style={styles.statLabel}>{t('attendance.present')}</Text>
        </View>
        <View style={styles.statCard}>
          <Icon name="clock-alert" size={24} color="#F97316" style={styles.statIcon} />
          <Text style={styles.statValue}>{statistics.totalLate}</Text>
          <Text style={styles.statLabel}>{t('attendance.late')}</Text>
        </View>
        <View style={styles.statCard}>
          <Icon name="close-circle" size={24} color="#EF4444" style={styles.statIcon} />
          <Text style={styles.statValue}>{statistics.totalAbsent}</Text>
          <Text style={styles.statLabel}>{t('attendance.absent')}</Text>
        </View>
        <View style={styles.statCard}>
          <Icon name="calendar-star" size={24} color="#F59E0B" style={styles.statIcon} />
          <Text style={styles.statValue}>{statistics.totalHolidays}</Text>
          <Text style={styles.statLabel}>{t('attendance.holidays')}</Text>
        </View>
        <View style={styles.statCard}>
          <Icon name="clock-outline" size={24} color="#6366F1" style={styles.statIcon} />
          <Text style={styles.statValue}>{statistics.totalWorkingHours}</Text>
          <Text style={styles.statLabel}>ساعات عمل</Text>
        </View>
        <View style={styles.statCard}>
          <Icon name="timer-sand" size={24} color="#6366F1" style={styles.statIcon} />
          <Text style={styles.statValue}>{statistics.totalOvertime}</Text>
          <Text style={styles.statLabel}>ساعات إضافية</Text>
        </View>
      </ScrollView>

      {/* Attendance List */}
      <ScrollView
        style={styles.listContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {weeklyDisplayItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon name="calendar-blank" size={64} color="#9CA3AF" />
            <Text style={styles.emptyText}>{t('attendance.noRecords')}</Text>
          </View>
        ) : (
          weeklyDisplayItems.map(({ date, attendance, holiday }) => {
            const isTodayCard = isToday(date);
            const dayLabel = format(date, 'EEEE', { locale: dateLocale });
            const dateLabel = format(date, 'd MMMM', { locale: dateLocale });

            if (holiday && !attendance) {
              return (
                <View key={`${date.toISOString()}-holiday`} style={[styles.attendanceCard, isTodayCard && styles.todayCard]}>
                  <View style={styles.attendanceHeader}>
                    <View style={styles.attendanceDateContainer}>
                      <Icon name="calendar-star" size={18} color="#F59E0B" />
                      <View>
                        <Text style={styles.attendanceDay}>{dayLabel}</Text>
                        <Text style={styles.attendanceDate}>{dateLabel}</Text>
                      </View>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: '#FEF3C7' }]}>
                      <Icon name="calendar-star" size={14} color="#F59E0B" />
                      <Text style={[styles.statusText, { color: '#F59E0B' }]}>{t('attendance.status.holiday')}</Text>
                    </View>
                  </View>
                  <Text style={styles.holidayName}>{holiday.nameAr || holiday.name}</Text>
                  <Text style={styles.holidayType}>{getHolidayTypeLabel(holiday.type)}</Text>
                </View>
              );
            }

            const statusBadge = attendance ? getStatusBadge(attendance) : null;

            return (
              <View key={`${date.toISOString()}-${attendance?._id || 'empty'}`} style={[styles.attendanceCard, isTodayCard && styles.todayCard]}>
                <View style={styles.attendanceHeader}>
                  <View style={styles.attendanceDateContainer}>
                    <Icon name="calendar" size={18} color="#3B82F6" />
                    <View>
                      <Text style={styles.attendanceDay}>
                        {dayLabel}
                        {isTodayCard ? ` (${t('attendance.today')})` : ''}
                      </Text>
                      <Text style={styles.attendanceDate}>{dateLabel}</Text>
                    </View>
                  </View>
                  {holiday && (
                    <View style={[styles.statusBadge, { backgroundColor: '#FEF3C7' }]}>
                      <Icon name="calendar-star" size={14} color="#F59E0B" />
                      <Text style={[styles.statusText, { color: '#F59E0B' }]}>{t('attendance.status.holiday')}</Text>
                    </View>
                  )}
                  {!holiday && statusBadge && (
                    <View style={[styles.statusBadge, { backgroundColor: `${statusBadge.color}20` }]}>
                      <Icon name={statusBadge.icon} size={14} color={statusBadge.color} />
                      <Text style={[styles.statusText, { color: statusBadge.color }]}>{statusBadge.text}</Text>
                    </View>
                  )}
                </View>

                {holiday && <Text style={styles.holidayName}>{holiday.nameAr || holiday.name}</Text>}
                {holiday && <Text style={styles.holidayType}>{getHolidayTypeLabel(holiday.type)}</Text>}

                {attendance ? (
                  <>
                    {attendance.checkInTime && (
                      <View style={styles.timeRow}>
                        <View style={styles.timeItem}>
                          <Icon name="login" size={16} color="#10B981" />
                          <Text style={styles.timeLabel}>دخول:</Text>
                          <Text style={styles.timeValue}>{formatTime(attendance.checkInTime)}</Text>
                        </View>
                        {attendance.lateMinutes && attendance.lateMinutes > 0 && (
                          <View style={styles.lateBadge}>
                            <Icon name="clock-alert" size={12} color="#F97316" />
                            <Text style={styles.lateText}>{attendance.lateMinutes} دقيقة</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {attendance.checkOutTime && (
                      <View style={styles.timeRow}>
                        <View style={styles.timeItem}>
                          <Icon name="logout" size={16} color="#EF4444" />
                          <Text style={styles.timeLabel}>خروج:</Text>
                          <Text style={styles.timeValue}>{formatTime(attendance.checkOutTime)}</Text>
                        </View>
                      </View>
                    )}

                    {(attendance.workingHours || attendance.overtime) && (
                      <View style={styles.hoursRow}>
                        {attendance.workingHours && (
                          <View style={styles.hoursItem}>
                            <Icon name="clock-outline" size={14} color="#3B82F6" />
                            <Text style={styles.hoursLabel}>ساعات العمل:</Text>
                            <Text style={styles.hoursValue}>{formatWorkingHours(attendance.workingHours)}</Text>
                          </View>
                        )}
                        {attendance.overtime && attendance.overtime > 0 && (
                          <View style={styles.hoursItem}>
                            <Icon name="timer-sand" size={14} color="#8B5CF6" />
                            <Text style={styles.hoursLabel}>إضافي:</Text>
                            <Text style={styles.hoursValue}>{formatWorkingHours(attendance.overtime)}</Text>
                          </View>
                        )}
                      </View>
                    )}

                    {attendance.checkInLocation?.address && (
                      <View style={styles.locationRow}>
                        <Icon name="map-marker" size={14} color="#6B7280" />
                        <Text style={styles.locationText} numberOfLines={2}>
                          {attendance.checkInLocation.address}
                        </Text>
                      </View>
                    )}
                  </>
                ) : !holiday ? (
                  <Text style={styles.noRecordText}>{t('attendance.noRecord')}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </ScrollView>

      {Platform.OS === 'ios' && showWeekPicker && (
        <DateTimePicker
          value={pickerDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleWeekPickerChange}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  centerContainer: {
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
    backgroundColor: 'transparent',
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  weekSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weekNavButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekLabelButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  weekLabelIcon: {
    marginRight: 4,
  },
  weekLabelTextContainer: {
    flex: 1,
  },
  weekLabelTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  weekLabelRange: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
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
  statsContainer: {
    backgroundColor: '#F9FAFB',
    paddingTop: 2,
    paddingBottom: 0,
    paddingHorizontal: 12,
    borderBottomWidth: 0,
    borderBottomColor: '#E5E7EB',
  },
  statCard: {
    width: 85,
    height: 110,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  statIcon: {
    marginBottom: 0,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginTop: 0,
    marginBottom: 0,
  },
  statLabel: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 0,
    textAlign: 'center',
  },
  listContainer: {
    flex: 1,
    paddingTop: 0,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    color: '#9CA3AF',
    marginTop: 16,
  },
  attendanceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  attendanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  attendanceDateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attendanceDate: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginLeft: 6,
  },
  attendanceDay: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  timeItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginLeft: 6,
    marginRight: 6,
  },
  timeValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
  },
  lateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
  },
  lateText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F97316',
    marginLeft: 4,
  },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  hoursItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  hoursLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 6,
    marginRight: 4,
  },
  hoursValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  locationText: {
    fontSize: 12,
    color: '#6B7280',
    marginLeft: 6,
    flex: 1,
  },
  holidayName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F59E0B',
    marginTop: 4,
  },
  holidayType: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  todayCard: {
    borderWidth: 1,
    borderColor: '#2563EB',
  },
  noRecordText: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 6,
  },
});

export default AttendanceScreen;
