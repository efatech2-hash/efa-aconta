export class TimeoutError extends Error {
  constructor(message = 'Pas de connexion (Délai 5s dépassé)') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Enveloppe n'importe quelle promesse Supabase avec un timeout strict (par défaut 5 secondes).
 * Essentiel pour les réseaux mobiles à faible débit (Togo / Togocel / Yas).
 */
export function withTimeout<T = any>(
  promise: PromiseLike<T> | Promise<T> | any,
  ms = 5000,
  errorMsg = 'Pas de connexion (Délai 5s dépassé)'
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(errorMsg));
    }, ms);
  });

  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Exécute une requête Supabase de manière sécurisée avec timeout de 5 secondes,
 * retournant un fallback immédiat en cas d'erreur ou d'expiration.
 */
export async function safeQuery<T = any>(
  queryPromise: any,
  ms = 5000,
  fallback: T | null = null
): Promise<{ data: T | null; error: any; timedOut?: boolean }> {
  try {
    const res = (await withTimeout(queryPromise, ms)) as { data: T | null; error: any };
    return res;
  } catch (err: any) {
    const isTimeout =
      err?.name === 'TimeoutError' ||
      String(err?.message || err).includes('5s') ||
      String(err?.message || err).includes('connexion');
    return { data: fallback, error: err, timedOut: isTimeout };
  }
}
