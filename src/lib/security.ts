import bcrypt from 'bcryptjs';

const FAILED_ATTEMPTS_KEY = 'efa_pin_failed_attempts';
const LOCK_UNTIL_KEY = 'efa_pin_lock_until';
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function hashPin(pin: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(pin, salt);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export function checkBruteForceStatus(): {
  isLocked: boolean;
  remainingSeconds: number;
  attemptsLeft: number;
} {
  const lockUntil = parseInt(localStorage.getItem(LOCK_UNTIL_KEY) || '0', 10);
  const now = Date.now();

  if (lockUntil > now) {
    const remainingSeconds = Math.ceil((lockUntil - now) / 1000);
    return {
      isLocked: true,
      remainingSeconds,
      attemptsLeft: 0,
    };
  }

  // If lock expired, reset
  if (lockUntil > 0 && lockUntil <= now) {
    resetFailedAttempts();
  }

  const failedAttempts = parseInt(localStorage.getItem(FAILED_ATTEMPTS_KEY) || '0', 10);
  return {
    isLocked: false,
    remainingSeconds: 0,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - failedAttempts),
  };
}

export function registerFailedAttempt(): {
  isLocked: boolean;
  remainingSeconds: number;
  attemptsLeft: number;
} {
  const current = parseInt(localStorage.getItem(FAILED_ATTEMPTS_KEY) || '0', 10) + 1;
  localStorage.setItem(FAILED_ATTEMPTS_KEY, current.toString());

  if (current >= MAX_ATTEMPTS) {
    const lockUntil = Date.now() + LOCK_DURATION_MS;
    localStorage.setItem(LOCK_UNTIL_KEY, lockUntil.toString());
    return {
      isLocked: true,
      remainingSeconds: Math.ceil(LOCK_DURATION_MS / 1000),
      attemptsLeft: 0,
    };
  }

  return {
    isLocked: false,
    remainingSeconds: 0,
    attemptsLeft: MAX_ATTEMPTS - current,
  };
}

export function resetFailedAttempts(): void {
  localStorage.removeItem(FAILED_ATTEMPTS_KEY);
  localStorage.removeItem(LOCK_UNTIL_KEY);
}
