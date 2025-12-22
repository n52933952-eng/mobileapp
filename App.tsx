import { StyleSheet, View, ActivityIndicator } from 'react-native'
import React from 'react'
import { AuthProvider } from './src/context/AuthContext'
import { LanguageProvider } from './src/context/LanguageContext'
import AppNavigator from './src/navigation/AppNavigator'
import './src/i18n' // Initialize i18n

const App = () => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </LanguageProvider>
  )
}

export default App

const styles = StyleSheet.create({})
