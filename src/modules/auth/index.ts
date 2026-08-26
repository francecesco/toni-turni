export type { Role, RegistrationDecision } from './policy'
export { decideRegistration, isValidEmail, normalizeEmail, roleForNewUser } from './policy'
export {
  DEFAULT_TTL_SECONDS,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  signSession,
  verifySession,
} from './token'
export { closeSessionCookie, openSessionCookie, readSessionCookie } from './session'
export { EmailNotVerifiedError, GOOGLE_SCOPES, buildGoogleAuthUrl, exchangeGoogleCode } from './google'
export type { CurrentUser } from './guards'
export { getCurrentUser, requireReferente, requireUser } from './guards'
