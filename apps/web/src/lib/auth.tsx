import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export const DEV_BYPASS = import.meta.env.DEV && import.meta.env.VITE_AUTH_DEV_BYPASS === 'true'

let auth: Auth | null = null
function firebaseAuth(): Auth {
  if (!auth) {
    auth = getAuth(
      initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      }),
    )
  }
  return auth
}

export async function getIdToken(): Promise<string | null> {
  if (DEV_BYPASS) return null
  return (await firebaseAuth().currentUser?.getIdToken()) ?? null
}

type AuthState = {
  user: { email: string } | null
  loading: boolean
  signInWithEmail: (email: string, password: string) => Promise<void>
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState['user']>(DEV_BYPASS ? { email: 'dev@localhost' } : null)
  const [loading, setLoading] = useState(!DEV_BYPASS)

  useEffect(() => {
    if (DEV_BYPASS) return
    return onAuthStateChanged(firebaseAuth(), (u: User | null) => {
      setUser(u?.email ? { email: u.email } : null)
      setLoading(false)
    })
  }, [])

  const value: AuthState = {
    user,
    loading,
    signInWithEmail: async (email, password) => {
      await signInWithEmailAndPassword(firebaseAuth(), email, password)
    },
    signInWithGoogle: async () => {
      await signInWithPopup(firebaseAuth(), new GoogleAuthProvider())
    },
    signOut: async () => {
      if (!DEV_BYPASS) await signOut(firebaseAuth())
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
