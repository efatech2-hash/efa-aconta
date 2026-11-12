import { db } from './db';
import { supabase } from './supabase';
import { queueSyncItem } from './sync';
import type { ActionType, HistoriqueAction, CurrentUser, Patron } from './types';
import { getActiveBoutiqueId } from './deviceAuth';

import { generatePrefixedId } from './uuid';

export interface LogActionParams {
  patron_id: string;
  boutique_id?: string;
  user_id?: string;
  employe_id?: string | null;
  employe_nom?: string;
  qui?: string;
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
  // RÈGLE : ID unique neuf avec crypto.randomUUID()
  const id = generatePrefixedId('act');
  const qui = params.qui || (params.employe_nom ? `Vendeur/se ${params.employe_nom}` : 'Patron');
  const activeBoutiqueId = params.boutique_id || getActiveBoutiqueId({ id: params.patron_id }) || params.patron_id;

  const actionRecord: HistoriqueAction = {
    id,
    user_id: params.user_id || params.patron_id,
    patron_id: params.patron_id,
    boutique_id: activeBoutiqueId,
    employe_id: params.employe_id || null,
    employe_nom: params.employe_nom || undefined,
    qui,
    action: params.action_type,
    action_type: params.action_type,
    description: params.description,
    montant: params.montant,
    date_heure: nowIso,
    created_at: nowIso,
  };

  const syncPayload = {
    id,
    user_id: actionRecord.user_id,
    patron_id: actionRecord.patron_id,
    boutique_id: actionRecord.boutique_id,
    employe_id: actionRecord.employe_id,
    employe_nom: actionRecord.employe_nom,
    action_type: actionRecord.action_type,
    description: actionRecord.description,
    montant: actionRecord.montant,
    created_at: nowIso,
  };

  try {
    // 1. Sauvegarde locale immédiate
    await db.historiqueActions.put(actionRecord);

    let onlineSaved = false;

    // 2. Envoi direct Supabase table historique_actions (upsert anti-conflit)
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const res = await supabase
          .from('historique_actions')
          .upsert([syncPayload], { onConflict: 'id' });

        const isSuccessOrConflict = !res?.error || res?.status === 409 || res?.error?.code === '23505';
        if (isSuccessOrConflict) {
          onlineSaved = true;
          if (res?.status === 409 || res?.error?.code === '23505') {
            console.log('[Sync 409 Déjà présent]', 'historique_actions', id);
          }
        }
      } catch (hErr) {
        console.warn('[Historique] Note upsert historique_actions:', hErr);
      }

      // Auto-suppression après 24h : DELETE WHERE created_at < now() - interval '24 hours'
      purgeOldHistoriqueActions().catch(() => {});
    }

    // 3. Queue de synchronisation uniquement si hors-ligne ou échec
    if (!onlineSaved) {
      await queueSyncItem('historique_actions', 'insert', id, syncPayload);
    }
  } catch (err) {
    console.error('[Historique] Erreur enregistrement action:', err);
  }

  return actionRecord;
}

/**
 * Auto-suppression après 24h dans Supabase table historique_actions et local :
 * DELETE WHERE created_at < now() - interval '24 hours'
 */
export async function purgeOldHistoriqueActions(): Promise<void> {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await supabase.from('historique_actions').delete().lt('created_at', cutoff24h);
    }
  } catch (err) {
    console.warn('[Historique] Erreur purge 24h historique_actions:', err);
  }

  try {
    await db.historiqueActions.where('created_at').below(cutoff24h).delete();
  } catch {}
}

/**
 * Récupère l'historique trié par date décroissante pour un patron (100% Supabase table historique_actions + cache Dexie)
 */
export async function getHistoriqueActions(patronId: string, boutiqueId?: string): Promise<HistoriqueAction[]> {
  // Purge préventive des actions de plus de 24h
  purgeOldHistoriqueActions().catch(() => {});
  const activeBoutiqueId = boutiqueId || getActiveBoutiqueId({ id: patronId }) || patronId;
  const isSub = Boolean(activeBoutiqueId && activeBoutiqueId !== patronId);
  const filterClause = isSub
    ? `boutique_id.eq.${activeBoutiqueId}`
    : `boutique_id.eq.${patronId},patron_id.eq.${patronId}`;

  try {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const { data: histLogs, error: histErr } = await supabase
        .from('historique_actions')
        .select('*')
        .or(filterClause)
        .order('created_at', { ascending: false });

      if (!histErr && histLogs && histLogs.length > 0) {
        return histLogs.map((h) => ({
          id: h.id,
          patron_id: h.patron_id || patronId,
          boutique_id: h.boutique_id || activeBoutiqueId,
          user_id: h.user_id,
          employe_id: h.employe_id,
          employe_nom: h.employe_nom,
          action_type: (h.action_type || 'vente') as ActionType,
          description: h.description,
          montant: h.montant,
          created_at: h.created_at || new Date().toISOString(),
        }));
      }
    }
  } catch (err) {
    console.warn('[Historique] Erreur fetch historique_actions, fallback Dexie:', err);
  }

  try {
    const list = await db.historiqueActions
      .filter((a) => isSub ? a.boutique_id === activeBoutiqueId : (a.boutique_id === patronId || a.patron_id === patronId))
      .reverse()
      .sortBy('created_at');
    return list;
  } catch (err) {
    console.error('[Historique] Erreur lecture historique locale:', err);
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
