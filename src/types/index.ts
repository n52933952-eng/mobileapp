export interface User {
  _id: string;
  employeeNumber: string;
  email: string;
  fullName: string;
  role: 'employee' | 'hr' | 'admin' | 'manager';
  department?: string;
  position?: string;
  profileImage?: string;
  expectedCheckInTime?: string;
  expectedCheckOutTime?: string;
  faceIdEnabled?: boolean;
  twoFactorEnabled?: boolean;
  attendancePoints?: number;
  isActive?: boolean;
  branch?: Location;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
}

export interface Location {
  _id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius: number;
  type: 'main' | 'branch' | 'temporary' | 'field';
  isActive?: boolean;
}

export interface Attendance {
  _id: string;
  user: string | User;
  date: string;
  checkInTime?: string;
  checkOutTime?: string;
  checkInLocation?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  checkOutLocation?: {
    latitude: number;
    longitude: number;
    address?: string;
  };
  status: 'present' | 'late' | 'absent' | 'holiday' | 'leave' | 'half-day';
  isHoliday?: boolean;
  holidayName?: string;
  isOnLeave?: boolean;
  leaveId?: string;
  workingHours?: number;
  overtime?: number;
  lateMinutes?: number;
  faceIdVerified?: boolean;
  qrCodeUsed?: boolean;
  notes?: string;
}

export interface Holiday {
  _id: string;
  name: string;
  nameAr?: string;
  startDate: string;
  endDate: string;
  type: 'national' | 'religious' | 'company' | 'custom';
  appliesToAll: boolean;
  branches?: Location[];
  isActive: boolean;
  description?: string;
}

export interface Leave {
  _id: string;
  user: string | User;
  type: 'annual' | 'sick' | 'emergency' | 'unpaid' | 'half-day';
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewedBy?: string | User;
  reviewedAt?: string;
  rejectionReason?: string;
  attachments?: Array<{
    url: string;
    filename: string;
  }>;
}

export interface Announcement {
  _id: string;
  title: string;
  content: string;
  type: 'general' | 'urgent' | 'policy' | 'event';
  targetAudience: 'all' | 'department' | 'role' | 'specific';
  departments?: string[];
  roles?: string[];
  specificUsers?: Array<string | User>;
  isActive: boolean;
  expiresAt?: string;
  attachments?: Array<{ url: string; filename: string }>;
  createdBy: string | User;
  readBy?: Array<{
    user: string | User;
    readAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface QRCode {
  code: string;
  type: 'checkin' | 'checkout';
  location: string | Location;
  latitude: number;
  longitude: number;
  expiresAt: string;
}

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  BiometricSetup: undefined;
  Main: undefined;
  Home: undefined;
  CheckIn: { type?: 'checkout' } | undefined;
  Attendance: undefined;
  Leaves: undefined;
  Announcements: undefined;
  Profile: undefined;
  Settings: undefined;
  FaceCapture: { emailOrEmployeeNumber?: string; onFaceCaptured?: (imageUri: string, faceData: any[]) => void } | undefined;
  FaceResultScreen: { imageUri: string; faceData?: any[] } | undefined;
};

