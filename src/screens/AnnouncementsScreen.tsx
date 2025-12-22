import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { ar } from 'date-fns/locale';
import { enUS } from 'date-fns/locale';
import { announcementAPI } from '../services/api';
import { Announcement } from '../types';
import { initializeSocket, onAnnouncementCreated, offAnnouncementCreated } from '../services/socket';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../context/LanguageContext';

type FilterType = 'all' | Announcement['type'];

// Note: typeFilters will be translated in JSX using t()

// Note: typeConfig labels will be translated in JSX using t()

const AnnouncementsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const dateLocale = language === 'ar' ? ar : enUS;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [error, setError] = useState<string | null>(null);

  const loadAnnouncements = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      const data = await announcementAPI.getMy();
      setAnnouncements(data.announcements || []);
    } catch (err: any) {
      console.error('Error loading announcements:', err);
      setError(err.message || 'فشل تحميل الإعلانات');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAnnouncements();
    }, [loadAnnouncements])
  );

  const handleAnnouncementCreated = useCallback((announcement: Announcement) => {
    setAnnouncements(prev => {
      const exists = prev.some(a => a._id === announcement._id);
      if (exists) return prev;
      return [announcement, ...prev];
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    const setupSocket = async () => {
      try {
        await initializeSocket();
        if (!mounted) return;
        onAnnouncementCreated(handleAnnouncementCreated);
      } catch (socketError) {
        console.error('Socket error (announcements):', socketError);
      }
    };

    setupSocket();

    return () => {
      mounted = false;
      offAnnouncementCreated(handleAnnouncementCreated);
    };
  }, [handleAnnouncementCreated]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadAnnouncements();
  }, [loadAnnouncements]);

  const filteredAnnouncements = useMemo(() => {
    if (filterType === 'all') return announcements;
    return announcements.filter(a => a.type === filterType);
  }, [announcements, filterType]);

  const renderTargetAudience = (announcement: Announcement) => {
    if (announcement.targetAudience === 'all') {
      return 'مرسل إلى جميع الموظفين';
    }

    if (announcement.targetAudience === 'specific' && announcement.specificUsers?.length) {
      const names = announcement.specificUsers
        .map(user => (typeof user === 'string' ? user : user.fullName))
        .filter(Boolean)
        .join('، ');
      return `مرسل إلى: ${names}`;
    }

    if (announcement.targetAudience === 'department') {
      return 'مرسل إلى قسم محدد';
    }

    if (announcement.targetAudience === 'role') {
      return 'مرسل إلى دور وظيفي معين';
    }

    return 'إعلان مخصص';
  };

  const renderAnnouncement = ({ item }: { item: Announcement }) => {
    const createdAt = parseISO(item.createdAt);
    const config = typeConfig[item.type] || typeConfig.general;
    const attachments = item.attachments || [];

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.typeBadge, { backgroundColor: config.background }]}>
            <Icon name={config.icon} size={16} color={config.color} />
            <Text style={[styles.typeBadgeText, { color: config.color }]}>{typeLabels[item.type] || config.label}</Text>
          </View>
          <Text style={styles.dateText}>
            {format(createdAt, 'EEEE، d MMMM', { locale: dateLocale })}
          </Text>
        </View>

        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardContent}>{item.content}</Text>

        <View style={styles.metaRow}>
          <Icon name="account" size={16} color="#6B7280" />
          <Text style={styles.metaText}>
            {typeof item.createdBy === 'string' ? item.createdBy : item.createdBy?.fullName || t('announcements.admin')}
          </Text>
        </View>

        <View style={styles.metaRow}>
          <Icon name="account-multiple" size={16} color="#6B7280" />
          <Text style={styles.metaText}>{renderTargetAudience(item)}</Text>
        </View>

        <View style={styles.footerRow}>
          <View style={styles.relativeTime}>
            <Icon name="clock-outline" size={16} color="#9CA3AF" />
            <Text style={styles.relativeTimeText}>
              {formatDistanceToNow(createdAt, { addSuffix: true, locale: dateLocale })}
            </Text>
          </View>

          {attachments.length > 0 && (
            <TouchableOpacity
              style={styles.attachmentButton}
              onPress={() => {
                const fileUrl = attachments[0].url;
                if (fileUrl) {
                  Linking.openURL(fileUrl).catch(err =>
                    console.error('Failed to open attachment', err)
                  );
                }
              }}
            >
              <Icon name="paperclip" size={16} color="#2563EB" />
              <Text style={styles.attachmentText}>{t('announcements.attachment')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>{t('announcements.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.screenTitle}>{t('announcements.title')}</Text>
        <View style={styles.filterRow}>
          {(['all', 'urgent', 'event', 'general'] as FilterType[]).map(filterKey => (
            <TouchableOpacity
              key={filterKey}
              style={[
                styles.filterChip,
                filterType === filterKey && styles.activeFilterChip,
              ]}
              onPress={() => setFilterType(filterKey)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filterType === filterKey && styles.activeFilterChipText,
                ]}
              >
                {t(`announcements.filters.${filterKey}`)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <FlatList
        data={filteredAnnouncements}
        keyExtractor={(item) => item._id}
        renderItem={renderAnnouncement}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="bullhorn-variant-outline" size={48} color="#9CA3AF" />
            <Text style={styles.emptyTitle}>{t('announcements.noAnnouncements')}</Text>
            <Text style={styles.emptySubtitle}>{t('announcements.newAnnouncementsWillAppear')}</Text>
          </View>
        }
        contentContainerStyle={
          filteredAnnouncements.length === 0 ? styles.emptyContent : styles.listContent
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  header: {
    marginBottom: 12,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  loadingText: {
    marginTop: 12,
    color: '#6B7280',
    fontSize: 16,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
  },
  activeFilterChip: {
    backgroundColor: '#4F46E5',
  },
  filterChipText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  activeFilterChipText: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  typeBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateText: {
    fontSize: 12,
    color: '#6B7280',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginTop: 12,
    marginBottom: 6,
  },
  cardContent: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    color: '#6B7280',
    flex: 1,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  relativeTime: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  relativeTimeText: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  attachmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#EFF6FF',
  },
  attachmentText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1F2937',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  errorText: {
    color: '#DC2626',
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 24,
  },
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
});

export default AnnouncementsScreen;

