import React from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { RealtimeProvider } from './src/context/RealtimeContext';
import { MessagesProvider } from './src/context/MessagesContext';
import { NetworkProvider } from './src/context/NetworkContext';
import { DeviceSimulatorFrame } from './src/components/common/DeviceSimulatorFrame';
import { RealtimeToastBanner } from './src/components/common/RealtimeToastBanner';
import { AuthScreen } from './src/screens/AuthScreen';
import { MapScreen } from './src/screens/MapScreen';

const MainNavigator = () => {
  const { isAuthenticated, logout } = useAuth();

  return (
    <View style={styles.appContainer}>
      <StatusBar style="dark" />
      <RealtimeToastBanner />
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
        <RealtimeProvider>
          <MessagesProvider>
            <NetworkProvider>
              <DeviceSimulatorFrame>
                <MainNavigator />
              </DeviceSimulatorFrame>
            </NetworkProvider>
          </MessagesProvider>
        </RealtimeProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#F4F3EE',
  },
});
