import React, { createContext, useContext, useState, ReactNode } from 'react';
import { User } from '../types';
import { authService } from '../services/auth/authService';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  login: (usernameOrEmail: string, password?: string) => Promise<boolean>;
  register: (username: string, email: string, password?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const clearError = () => setAuthError(null);

  const login = async (usernameOrEmail: string, password?: string): Promise<boolean> => {
    setIsLoading(true);
    setAuthError(null);

    try {
      const result = await authService.login({
        usernameOrEmail: usernameOrEmail.trim(),
        password,
      });

      if (result.success && result.user) {
        setUser(result.user);
        return true;
      } else {
        setAuthError(result.error || 'Credenciales no válidas.');
        return false;
      }
    } catch (err: any) {
      setAuthError(err.message || 'Error inesperado al conectar con el API Gateway.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (
    username: string,
    email: string,
    password?: string
  ): Promise<boolean> => {
    setIsLoading(true);
    setAuthError(null);

    try {
      const result = await authService.register({
        username: username.trim(),
        email: email.trim(),
        password,
      });

      if (result.success && result.user) {
        setUser(result.user);
        return true;
      } else {
        setAuthError(result.error || 'No se pudo completar el registro.');
        return false;
      }
    } catch (err: any) {
      setAuthError(err.message || 'Error inesperado al registrar usuario en el API Gateway.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setAuthError(null);
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        authError,
        login,
        register,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider');
  }
  return context;
};
