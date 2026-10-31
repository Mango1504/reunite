export const MIN_PASSWORD_LENGTH = 8

export function validatePassword(password = '') {
  return password.length < MIN_PASSWORD_LENGTH
    ? `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`
    : ''
}
