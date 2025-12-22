import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { RootStackParamList } from '../types';
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import BiometricSetupScreen from '../screens/BiometricSetupScreen';
import MainTabNavigator from './MainTabNavigator';
import CheckInScreen from '../screens/CheckInScreen';
import FaceCaptureScreen from '../screens/FaceCaptureScreen';
import FaceResultScreen from '../screens/FaceResultScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { isAuthenticated, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return null; // Or a loading screen
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen 
              name="BiometricSetup" 
              component={BiometricSetupScreen}
              options={({ route }) => ({ 
                headerShown: true,
                title: t('biometricSetup.biometricSetupRequired'),
                headerStyle: { 
                  backgroundColor: '#4F46E5',
                  height: 50,
                },
                headerTintColor: '#FFF',
                headerTitleStyle: { 
                  fontSize: 16,
                  fontWeight: '600',
                  textAlign: 'center',
                },
                headerTitleAlign: 'center',
                headerBackVisible: false, // Prevent going back during setup
                // Prevent navigation to this screen from Login - only allow from Register
                gestureEnabled: false,
              })}
            />
            <Stack.Screen 
              name="FaceCapture" 
              component={FaceCaptureScreen}
              options={{ 
                headerShown: false,
                gestureEnabled: false,
              }}
            />
            <Stack.Screen 
              name="FaceResultScreen" 
              component={FaceResultScreen}
              options={{ 
                headerShown: false,
                gestureEnabled: false,
              }}
            />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabNavigator} />
            <Stack.Screen 
              name="CheckIn" 
              component={CheckInScreen}
              options={({ route }) => ({ 
                headerShown: true,
                title: t('checkIn.verifyIdentity'),
                headerStyle: { backgroundColor: '#4F46E5' },
                headerTintColor: '#FFF',
              })}
            />
            <Stack.Screen 
              name="FaceCapture" 
              component={FaceCaptureScreen}
              options={{ 
                headerShown: false,
                gestureEnabled: false,
              }}
            />
            <Stack.Screen 
              name="FaceResultScreen" 
              component={FaceResultScreen}
              options={{ 
                headerShown: false,
                gestureEnabled: false,
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default AppNavigator;

