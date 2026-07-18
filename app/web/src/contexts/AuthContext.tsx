import { createContext, useContext, useState, type ReactNode } from 'react'
import { setToken, clearToken, isAuthenticated } from '../lib/auth'

interface AuthContextValue {
  isLoggedIn: boolean
  login: (token: string) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(isAuthenticated)

  function login(token: string) {
    setToken(token)
    setIsLoggedIn(true)
  }

  function logout() {
    clearToken()
    setIsLoggedIn(false)
  }

  return (
    <AuthContext.Provider value={{ isLoggedIn, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
