/**
 * RAPPEL QUOTIDIEN EFA ACONTA
 * - Heure Lomé (Africa/Lome UTC+0)
 * - Notification Android via Service Worker (même app fermée si Web Push / SW actif)
 * - Fallback Toast in-app
 * - Rattrapage au mount si >9h et non envoyé aujourd'hui
 */
import { useEffect, useCallback, useRef } from 'react';

export const DAILY_NOTIF_MESSAGES = [
  "Bonjour Patron! ☀️ Bien débuté ta journée? Ouvre EFA Aconta et fais le point de ta caisse ce matin!",
  "Salut Boss! 👋 Ton commerce t'attend. Lance EFA Aconta et démarre bien ta journée!",
  "Bonjour Patronne! 🌅 As-tu ouvert ta caisse? EFA Aconta est prêt. Belle vente!",
  "Coucou Boss! 💰 9h déjà! Check ton stock et ta caisse sur EFA Aconta!"
];

export const NOTIF_ENABLED_KEY = 'efa_notif_enabled';
export const NOTIF_HOUR_KEY = 'efa_notif_hour';
export const LAST_NOTIF_KEY = 'efa_aconta_last_notif';
export const NOTIF_SETTINGS_EVENT = 'efa_notif_settings_changed';

/**
 * Retourne la date au format YYYY-MM-DD à Lomé (UTC+0)
 */
export function getLomeDateString(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Retourne l'heure courante (0-23) à Lomé (UTC+0)
 */
export function getLomeCurrentHour(date: Date = new Date()): number {
  return date.getUTCHours();
}

/**
 * Calcule le nombre de millisecondes jusqu'à la prochaine occurrence de targetHour (UTC+0)
 */
export function getMsUntilNextLomeHour(targetHour: number = 9): number {
  const now = new Date();
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    targetHour,
    0,
    0,
    0
  ));

  // Si l'heure cible est déjà passée aujourd'hui à Lomé, on vise demain
  if (now.getTime() >= target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }

  return Math.max(1000, target.getTime() - now.getTime());
}

/**
 * Affiche la notification quotidienne :
 * - Si permission accordée -> via Service Worker showNotification
 * - Sinon -> déclenche le toast in-app bottom
 */
export async function showNotif(
  customMsg?: string,
  onToastFallback?: (msg: string) => void
): Promise<string> {
  const msg = customMsg || DAILY_NOTIF_MESSAGES[Math.floor(Math.random() * DAILY_NOTIF_MESSAGES.length)];

  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("EFA Aconta 👑", {
          body: msg,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: 'efa-daily-reminder',
          renotify: true,
          requireInteraction: false,
        } as any);
        return msg;
      } catch (err) {
        console.warn('[DailyNotif] SW showNotification a échoué, essai Notification():', err);
        try {
          new Notification("EFA Aconta 👑", {
            body: msg,
            icon: "/icon-192.png",
            badge: "/icon-192.png",
          });
          return msg;
        } catch {}
      }
    }
  }

  // Fallback : toast in-app
  if (onToastFallback) {
    onToastFallback(msg);
  } else if (typeof window !== 'undefined') {
    // Déclenche un événement global écouté par l'App
    window.dispatchEvent(new CustomEvent('efa_toast_notif', { detail: { message: msg } }));
  }

  return msg;
}

/**
 * Hook personnalisé useDailyNotif
 * - Demande permission & enregistre SW au mount
 * - Rattrapage immédiat si >9h et non envoyé aujourd'hui
 * - Programmation à la prochaine heure cible (Lomé UTC+0) puis récurrence 24h
 */
export function useDailyNotif(onToastBottom?: (msg: string) => void) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const triggerDailyNotification = useCallback(async (isCatchUp: boolean = false) => {
    if (typeof window === 'undefined') return;

    // Vérifier si les notifications sont activées (défaut : ON)
    const enabled = localStorage.getItem(NOTIF_ENABLED_KEY) !== 'false';
    if (!enabled) return;

    const todayStr = getLomeDateString(new Date());
    const lastNotif = localStorage.getItem(LAST_NOTIF_KEY);

    if (lastNotif === todayStr) {
      // Déjà envoyé aujourd'hui
      return;
    }

    // Envoi de la notification
    await showNotif(undefined, onToastBottom);
    localStorage.setItem(LAST_NOTIF_KEY, todayStr);
    console.log(`[DailyNotif] Notification ${isCatchUp ? 'de rattrapage' : 'programmée'} envoyée pour le ${todayStr}`);
  }, [onToastBottom]);

  const scheduleDailyTimer = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Nettoyer les timers précédents
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);

    const enabled = localStorage.getItem(NOTIF_ENABLED_KEY) !== 'false';
    if (!enabled) return;

    const targetHour = parseInt(localStorage.getItem(NOTIF_HOUR_KEY) || '9', 10);
    const msUntilNext = getMsUntilNextLomeHour(targetHour);
    console.log(`[DailyNotif] Prochain rappel programmé dans ${(msUntilNext / (1000 * 60)).toFixed(1)} minutes (${targetHour}h Lomé)`);

    timeoutRef.current = setTimeout(() => {
      triggerDailyNotification(false);
      // Récurrence 24 heures
      intervalRef.current = setInterval(() => {
        triggerDailyNotification(false);
      }, 24 * 60 * 60 * 1000);
    }, msUntilNext);
  }, [triggerDailyNotification]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Enregistrement SW et demande de permission
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('[DailyNotif] Enregistrement SW ignoré:', err);
      });
    }

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    // 2. Vérification rattrapage au mount
    const enabled = localStorage.getItem(NOTIF_ENABLED_KEY) !== 'false';
    const targetHour = parseInt(localStorage.getItem(NOTIF_HOUR_KEY) || '9', 10);
    const nowLomeHour = getLomeCurrentHour(new Date());
    const todayStr = getLomeDateString(new Date());
    const lastNotif = localStorage.getItem(LAST_NOTIF_KEY);

    if (enabled && nowLomeHour >= targetHour && lastNotif !== todayStr) {
      // Rattrapage direct
      triggerDailyNotification(true);
    }

    // 3. Programmer le timer quotidien
    scheduleDailyTimer();

    // 4. Écouter les changements dans les paramètres
    const handleSettingsChange = () => {
      scheduleDailyTimer();
    };
    window.addEventListener(NOTIF_SETTINGS_EVENT, handleSettingsChange);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener(NOTIF_SETTINGS_EVENT, handleSettingsChange);
    };
  }, [scheduleDailyTimer, triggerDailyNotification]);

  return {
    showNotif: (customMsg?: string) => showNotif(customMsg, onToastBottom),
  };
}
