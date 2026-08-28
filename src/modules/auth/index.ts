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
export {
  DEV_LOGIN_ENV,
  devLoginAllows,
  devLoginEmails,
  devLoginStartupWarning,
  isDevLoginEnabled,
} from './devLogin'
export { EmailNotVerifiedError, GOOGLE_SCOPES, buildGoogleAuthUrl, exchangeGoogleCode } from './google'
export type { ApiAuth, CurrentUser } from './guards'
export { authorizeApi, getCurrentUser, requireReferente, requireUser } from './guards'
export type { GoogleAccountState } from './googleAccount'
export {
  GoogleAccountMissingError,
  GoogleReauthRequiredError,
  googleClientForUser,
  markNeedsReauth,
  markReauthResolved,
  readGoogleAccountState,
  refreshTokenContext,
  setCalendarId,
} from './googleAccount'
