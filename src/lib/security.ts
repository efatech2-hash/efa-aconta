/**
 * EFA ACONTA - MODULE DE SÉCURITÉ FORTERESSE
 * Gestion du hachage de PIN (bcrypt), anti-brute force,
 * désinfection XSS, vérification stricte des magic bytes et masquage des secrets.
 */
import bcrypt from 'bcryptjs';

const FAILED_ATTEMPTS_KEY = 'efa_pin_failed_attempts';
const LOCK_UNTIL_KEY = 'efa_pin_lock_until';
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// 1. HACHAGE ET VÉRIFICATION DE CODE PIN (BCRYPT)
export async function hashPin(pin: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(pin, salt);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  // Si c'est encore un PIN en clair non migré (ex: 4 chiffres)
  if (hash.length === 4 && /^\d{4}$/.test(hash)) {
    return pin === hash;
  }
  return bcrypt.compare(pin, hash);
}

// 2. GESTION DU VERROUILLAGE ANTI-BRUTE FORCE LOCAL
export function checkBruteForceStatus(): {
  isLocked: boolean;
  remainingSeconds: number;
  attemptsLeft: number;
} {
  if (typeof window === 'undefined') {
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: MAX_ATTEMPTS };
  }

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
  if (typeof window === 'undefined') {
    return { isLocked: false, remainingSeconds: 0, attemptsLeft: MAX_ATTEMPTS };
  }

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
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - current),
  };
}

export function resetFailedAttempts(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(FAILED_ATTEMPTS_KEY);
    localStorage.removeItem(LOCK_UNTIL_KEY);
  }
}

// 3. DÉSINFECTION XSS ET ÉCHAPPEMENT HTML
export function escapeHtml(str: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

// 4. VÉRIFICATION STRICTE DES TYPES MIME ET MAGIC BYTES RÉELS
export interface FileValidationResult {
  valid: boolean;
  error?: string;
  detectedType?: string;
}

const FORBIDDEN_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.php', '.phtml', '.js', '.mjs',
  '.ts', '.jsx', '.tsx', '.py', '.rb', '.pl', '.vbs', '.scr',
  '.jar', '.msi', '.com', '.htm', '.html', '.svg', '.apk'
];

export async function validateImageFile(file: File): Promise<FileValidationResult> {
  if (!file) {
    return { valid: false, error: 'Fichier absent' };
  }

  const lowerName = file.name.toLowerCase();
  for (const ext of FORBIDDEN_EXTENSIONS) {
    if (lowerName.endsWith(ext)) {
      return { valid: false, error: `Type de fichier interdit : extension ${ext} non autorisée` };
    }
  }

  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'Fichier trop lourd (maximum 10 Mo)' };
  }

  try {
    const slice = file.slice(0, 16);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    const isPng =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4E &&
      bytes[3] === 0x47;
    const isWebp =
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50;
    const isGif =
      bytes[0] === 0x47 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x38;

    if (isWebp) return { valid: true, detectedType: 'image/webp' };
    if (isJpeg) return { valid: true, detectedType: 'image/jpeg' };
    if (isPng) return { valid: true, detectedType: 'image/png' };
    if (isGif) return { valid: true, detectedType: 'image/gif' };

    return {
      valid: false,
      error: 'Format binaire non reconnu. Seuls les formats WebP, JPEG et PNG sont acceptés.'
    };
  } catch (err: any) {
    return { valid: false, error: `Erreur lors de l'analyse du fichier: ${err.message}` };
  }
}

// 5. MASQUAGE DES DONNÉES SENSIBLES POUR LES LOGS
export function maskSensitiveData(data: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['pin', 'pin_code', 'code_pin', 'password', 'token', 'key', 'secret'];
  const sanitized = { ...data };

  for (const k of Object.keys(sanitized)) {
    const lower = k.toLowerCase();
    if (sensitiveKeys.some(sk => lower.includes(sk))) {
      sanitized[k] = '********';
    }
  }

  return sanitized;
}
