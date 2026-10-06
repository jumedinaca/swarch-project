import React from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { MessagesProvider } from './src/context/MessagesContext';
import { DeviceSimulatorFrame } from './src/components/common/DeviceSimulatorFrame';
import { AuthScreen } from './src/screens/AuthScreen';
import { MapScreen } from './src/screens/MapScreen';

import { nintendoTheme } from './src/theme/nintendoTheme';

const MainNavigator = () => {
  const { isAuthenticated, logout } = useAuth();

  return (
    <View style={styles.appContainer}>
      <StatusBar style="dark" />
      {isAuthenticated ? (
        <MapScreen onLogout={logout} />
      ) : (
        <AuthScreen onSuccess={() => {}} />
      )}
    </View>
  );
};

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <MessagesProvider>
          <DeviceSimulatorFrame>
            <MainNavigator />
          </DeviceSimulatorFrame>
        </MessagesProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: nintendoTheme.colors.background,
  },
});
