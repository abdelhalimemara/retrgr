import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { config } from './config.js'

export type AuthEnv = { Variables: { actor: string } }

function firebaseAuth() {
  // On Cloud Run, Application Default Credentials come from the service account.
  if (!getApps().length) initializeApp({ projectId: config.firebaseProjectId })
  return getAuth()
}

/** Verifies the Firebase / Identity Platform ID token sent by the dashboard. */
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (config.authDevBypass) {
    c.set('actor', 'dev@localhost')
    return next()
  }

  const token = c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!token) throw new HTTPException(401, { message: 'Missing token' })

  let email: string | undefined
  try {
    const decoded = await firebaseAuth().verifyIdToken(token, true)
    if (!decoded.email_verified) throw new Error('unverified')
    email = decoded.email?.toLowerCase()
  } catch {
    throw new HTTPException(401, { message: 'Invalid token' })
  }

  if (!email || (config.adminEmails.length && !config.adminEmails.includes(email))) {
    throw new HTTPException(403, { message: 'Not authorised' })
  }
  c.set('actor', email)
  await next()
})
