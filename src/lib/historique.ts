import { db } from './db';
import { supabase } from './supabase';
import { queueSyncItem } from './sync';
import type { ActionType, HistoriqueAction, CurrentUser, Patron } from './types';

export interface LogActionParams {
  patron_id: string;
  user_id?: string;
  employe_id?: string | null;
  employe_nom?: string;
  action_type: ActionType;
  description: string;
  montant?: number;
}

/**
 * Enregistre une action importante dans l'historique complet (Dexie + Supabase)
 * Toujours horodaté en UTC, affichage converti en heure locale
 */
export async function logAction(params: LogActionParams): Promise<HistoriqueAction> {
  const nowIso = new Date().toISOString();
  const id = 'act-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

  const actionRecord: HistoriqueAction = {
    id,
    user_id: params.user_id || params.patron_id,
    patron_id: params.patron_id,
    employe_id: params.employe_id || null,
    employe_nom: params.employe_nom || undefined,
    action_type: params.action_type,
    description: params.description,
    montant: params.montant,
    created_at: nowIso,
  };

  try {
    // 1. Sauvegarde locale immédiate (fonctionne 100% hors-ligne)
    await db.historiqueActions.put(actionRecord);

    // 2. Queue de synchronisation locale -> Supabase
    await queueSyncItem('historique_actions', 'insert', id, {
      id,
      user_id: actionRecord.user_id,
      patron_id: actionRecord.patron_id,
      employe_id: actionRecord.employe_id,
      action_type: actionRecord.action_type,
      description: actionRecord.description,
      montant: actionRecord.montant,
      created_at: nowIso,
    });

    // 3. Essai d'envoi direct si connecté avec timeout strict 5s
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const { withTimeout } = await import('./supabaseHelper');
      withTimeout(
        supabase
          .from('historique_actions')
          .insert({
            id,
            user_id: actionRecord.user_id,
            patron_id: actionRecord.patron_id,
            employe_id: actionRecord.employe_id,
            action_type: actionRecord.action_type,
            description: actionRecord.description,
            montant: actionRecord.montant,
            created_at: nowIso,
          }),
        5000
      ).catch(() => {
        // En cas de timeout ou coupure réseau, la queue sync prendra le relais
      });
    }
  } catch (err) {
    console.error('[Historique] Erreur enregistrement action:', err);
  }

  return actionRecord;
}

/**
 * Récupère l'historique trié par date décroissante pour un patron
 */
export async function getHistoriqueActions(patronId: string): Promise<HistoriqueAction[]> {
  try {
    const list = await db.historiqueActions
      .where('patron_id')
      .equals(patronId)
      .reverse()
      .sortBy('created_at');
    return list;
  } catch (err) {
    console.error('[Historique] Erreur lecture historique:', err);
    return [];
  }
}

/**
 * Formate la date en chaîne synchronisée locale fr-TG (ou locale utilisateur)
 * Format attendu : 12/10/2026 14:32:15
 */
export function formatLocalDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString('fr-TG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

/**
 * Exporte une liste d'actions en fichier CSV avec encodage UTF-8 (BOM inclus pour Excel)
 */
export function exportHistoriqueCSV(actions: HistoriqueAction[], nomBoutique: string = 'Boutique') {
  const headers = ['Date', 'Action', 'Qui', 'Description', 'Montant (F CFA)'];

  const rows = actions.map((act) => {
    const dateStr = formatLocalDate(act.created_at);
    const actionLabel = act.action_type.replace(/_/g, ' ').toUpperCase();
    const qui = act.employe_nom ? `Vendeur/se ${act.employe_nom}` : 'Patron';
    const desc = `"${act.description.replace(/"/g, '""')}"`;
    const montant = act.montant !== undefined && act.montant !== null ? `${act.montant}` : '-';

    return [dateStr, actionLabel, qui, desc, montant].join(';');
  });

  const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  const dateFile = new Date().toISOString().slice(0, 10);
  link.setAttribute('download', `Historique_${nomBoutique}_${dateFile}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
