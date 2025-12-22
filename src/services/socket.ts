import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Socket.io URL - Set SOCKET_URL in .env file or use default server URL
// For production: Use your server URL
// For local development: Use 'http://10.0.2.2:5000' (Android Emulator) or 'http://localhost:5000' (iOS Simulator)
const SOCKET_URL = process.env.SOCKET_URL || 'https://work-spot-6.onrender.com';

let socket: Socket | null = null;

export const initializeSocket = async (): Promise<Socket> => {
  // If socket exists and is connected, return it
  if (socket?.connected) {
    console.log('✅ Socket already connected, reusing existing connection');
    return socket;
  }

  // If socket exists but not connected, disconnect and recreate
  if (socket && !socket.connected) {
    console.log('🔄 Socket exists but not connected, disconnecting and recreating...');
    socket.disconnect();
    socket = null;
  }

  try {
    // Get user ID from storage
    const userStr = await AsyncStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : null;
    const userId = user?._id;

    if (!userId) {
      console.warn('⚠️ No user ID found, socket may not work correctly');
    }

    console.log('🔌 Initializing Socket.io connection to:', SOCKET_URL);
    console.log('👤 User ID:', userId);

    socket = io(SOCKET_URL, {
      query: {
        userId: userId || 'undefined',
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity, // Keep trying to reconnect
      timeout: 20000,
      forceNew: false, // Reuse existing connection if possible
    });

    socket.on('connect', () => {
      console.log('✅ Socket connected:', socket?.id);
      // Note: handshake.query is not available on client-side, use io.opts.query instead
      const queryParams = (socket as any).io?.opts?.query || { userId: userId || 'undefined' };
      console.log('📋 Socket query params:', queryParams);
    });

    socket.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
      if (reason === 'io server disconnect') {
        // Server disconnected the socket, need to manually reconnect
        console.log('🔄 Server disconnected, will attempt to reconnect...');
      }
    });

    socket.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error.message);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('🔄 Socket reconnected after', attemptNumber, 'attempts');
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log('🔄 Reconnection attempt', attemptNumber);
    });

    socket.on('reconnect_error', (error) => {
      console.error('🔴 Reconnection error:', error.message);
    });

    socket.on('reconnect_failed', () => {
      console.error('❌ Reconnection failed after all attempts');
    });

    // Listen for all events for debugging
    socket.onAny((eventName, ...args) => {
      console.log(`📨 Socket event received: ${eventName}`, args);
      // Specifically log approval events
      if (eventName === 'employeeApproved' || eventName === 'employeeRejected') {
        console.log(`🎯 Approval event received: ${eventName}`, JSON.stringify(args, null, 2));
      }
    });

    return socket;
  } catch (error) {
    console.error('❌ Error initializing socket:', error);
    throw error;
  }
};

export const getSocket = (): Socket | null => {
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    console.log('🔌 Disconnecting socket...');
    socket.disconnect();
    socket = null;
  }
};

// Holiday events
export const onHolidayCreated = (callback: (holiday: any) => void) => {
  socket?.on('holidayCreated', callback);
};

export const onHolidayUpdated = (callback: (holiday: any) => void) => {
  socket?.on('holidayUpdated', callback);
};

export const onHolidayDeleted = (callback: (data: { id: string }) => void) => {
  socket?.on('holidayDeleted', callback);
};

export const offHolidayCreated = (callback: (holiday: any) => void) => {
  socket?.off('holidayCreated', callback);
};

export const offHolidayUpdated = (callback: (holiday: any) => void) => {
  socket?.off('holidayUpdated', callback);
};

export const offHolidayDeleted = (callback: (data: { id: string }) => void) => {
  socket?.off('holidayDeleted', callback);
};

// Leave events
export const onLeaveApproved = (callback: (leave: any) => void) => {
  socket?.on('leaveApproved', callback);
};

export const onLeaveRejected = (callback: (data: { leave: any; rejectionReason: string }) => void) => {
  socket?.on('leaveRejected', callback);
};

export const onLeaveCreated = (callback: (leave: any) => void) => {
  socket?.on('leaveCreated', callback);
};

export const offLeaveApproved = (callback: (leave: any) => void) => {
  socket?.off('leaveApproved', callback);
};

export const offLeaveRejected = (callback: (data: { leave: any; rejectionReason: string }) => void) => {
  socket?.off('leaveRejected', callback);
};

export const offLeaveCreated = (callback: (leave: any) => void) => {
  socket?.off('leaveCreated', callback);
};

// Announcement events
export const onAnnouncementCreated = (callback: (announcement: any) => void) => {
  socket?.on('announcementCreated', callback);
};

export const offAnnouncementCreated = (callback: (announcement: any) => void) => {
  socket?.off('announcementCreated', callback);
};

// Employee approval events
export const onEmployeeApproved = (callback: (data: { message: string; employeeId: string; timestamp: string }) => void) => {
  if (!socket) {
    console.warn('⚠️ Socket not initialized, cannot register employeeApproved listener');
    return;
  }
  console.log('📡 Registering employeeApproved listener');
  socket.on('employeeApproved', callback);
};

export const onEmployeeRejected = (callback: (data: { message: string; reason: string | null; employeeId: string; timestamp: string }) => void) => {
  if (!socket) {
    console.warn('⚠️ Socket not initialized, cannot register employeeRejected listener');
    return;
  }
  console.log('📡 Registering employeeRejected listener');
  socket.on('employeeRejected', callback);
};

export const offEmployeeApproved = (callback: (data: { message: string; employeeId: string; timestamp: string }) => void) => {
  socket?.off('employeeApproved', callback);
};

export const offEmployeeRejected = (callback: (data: { message: string; reason: string | null; employeeId: string; timestamp: string }) => void) => {
  socket?.off('employeeRejected', callback);
};

export default {
  initializeSocket,
  getSocket,
  disconnectSocket,
  onHolidayCreated,
  onHolidayUpdated,
  onHolidayDeleted,
  offHolidayCreated,
  offHolidayUpdated,
  offHolidayDeleted,
  onLeaveApproved,
  onLeaveRejected,
  onLeaveCreated,
  offLeaveApproved,
  offLeaveRejected,
  offLeaveCreated,
  onAnnouncementCreated,
  offAnnouncementCreated,
  onEmployeeApproved,
  onEmployeeRejected,
  offEmployeeApproved,
  offEmployeeRejected,
};

