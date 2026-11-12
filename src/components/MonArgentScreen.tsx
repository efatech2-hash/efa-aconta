import React, { useState, useEffect } from 'react';
import {
  Wallet,
  Volume2,
  TrendingUp,
  Receipt,
  Users,
  AlertCircle,
  Plus,
  ArrowLeft,
  CheckCircle2,
  Calendar,
  Trash2,
  RotateCcw,
  History,
  AlertTriangle,
} from 'lucide-react';
import type { Patron, Vente, Depense, Credit, Produit, CurrentUser, LogSuppression } from '../lib/types';
import { db } from '../lib/db';
import { queueSyncItem } from '../lib/sync';
import { speakFrench } from '../lib/speech';
import { getAccord } from '../lib/accord';
import { logAction } from '../lib/historique';
import { BoutonRetour } from './BoutonRetour';
import { supabase } from '../lib/supabase';
import { getActiveBoutiqueId } from '../lib/deviceAuth';
import { generatePrefixedId } from '../lib/uuid';

interface MonArgentScreenProps {
  patron: Patron;
  currentUser: CurrentUser;
  ventes: Vente[];
  depenses: Depense[];
  credits: Credit[];
  products: Produit[];
  onBack: () => void;
  onDataRefresh: () => void;
}

export const MonArgentScreen: React.FC<MonArgentScreenProps> = ({
  patron,
  currentUser,
  ventes,
  depenses,
  credits,
  products,
  onBack,
  onDataRefresh,
}) => {
  // Saisie manuelle de dépenses (COLONNE OUVERTE LIBRE)
  const [typeDepense, setTypeDepense] = useState('');
  const [montantDepense, setMontantDepense] = useState('');
  const [descriptionDepense, setDescriptionDepense] = useState('');
  const [isAddingDepense, setIsAddingDepense] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Modal règlement d'un crédit client
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [remboursementMontant, setRemboursementMontant] = useState('');

  // CORRECTION 11 : SUPPRESSION DE VENTE & LOGS
  const [selectedVenteToDelete, setSelectedVenteToDelete] = useState<Vente | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [activeTransactionsTab, setActiveTransactionsTab] = useState<'actives' | 'supprimees'>('actives');
  const [logsList, setLogsList] = useState<LogSuppression[]>([]);

  const accord = getAccord(currentUser.genre);

  // Solde persistant en Supabase (boutiques.solde & patrons.solde)
  const [remoteSolde, setRemoteSolde] = useState<number | null>(
    typeof patron.solde === 'number' ? patron.solde : null
  );

  const fetchRemoteSolde = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data: btq } = await supabase
          .from('boutiques')
          .select('solde')
          .eq('id', patron.id)
          .maybeSingle();
        if (btq && typeof btq.solde === 'number') {
          setRemoteSolde(btq.solde);
          patron.solde = btq.solde;
          await db.patrons.update(patron.id, { solde: btq.solde });
          return;
        }
        const { data: p } = await supabase
          .from('patrons')
          .select('solde')
          .eq('id', patron.id)
          .maybeSingle();
        if (p && typeof p.solde === 'number') {
          setRemoteSolde(p.solde);
          patron.solde = p.solde;
          await db.patrons.update(patron.id, { solde: p.solde });
          return;
        }
      } catch (err) {
        console.warn('Erreur chargement solde Supabase:', err);
      }
    }
  };

  // Charger les logs de suppression
  const loadLogs = async () => {
    try {
      const logs = await db.logsSuppression.where('patron_id').equals(patron.id).reverse().sortBy('date');
      setLogsList(logs);
    } catch (err) {
      console.warn('Erreur chargement logs suppressions:', err);
    }
  };

  const [remoteVentes, setRemoteVentes] = useState<Vente[] | null>(null);
  const [remoteCredits, setRemoteCredits] = useState<Credit[] | null>(null);
  const [remoteDepenses, setRemoteDepenses] = useState<Depense[] | null>(null);

  // Filtre date du jour selon le fuseau horaire officiel de Lomé (UTC+0)
  function isDateToday(dateStr?: string): boolean {
    if (!dateStr) return false;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;
      const options: Intl.DateTimeFormatOptions = {
        timeZone: 'Africa/Lome',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      };
      const dateFormatted = new Intl.DateTimeFormat('fr-CA', options).format(d);
      const todayFormatted = new Intl.DateTimeFormat('fr-CA', options).format(new Date());
      return dateFormatted === todayFormatted;
    } catch {
      const d = new Date(dateStr);
      const now = new Date();
      return (
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    }
  }

  // Lecture directe depuis Supabase (table 'ventes' ET 'transactions')
  const fetchRemoteData = async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine) return;
    try {
      const activeBoutiqueId = getActiveBoutiqueId(patron);
      const orClause = activeBoutiqueId && activeBoutiqueId !== patron.id
        ? `boutique_id.eq.${activeBoutiqueId}`
        : `boutique_id.eq.${patron.id},patron_id.eq.${patron.id}`;

      // 1. Lire les ventes depuis Supabase (table 'ventes' ET 'transactions')
      const fetchedVentesMap = new Map<string, Vente>();

      try {
        const { data: vData } = await supabase
          .from('ventes')
          .select('*')
          .or(orClause)
          .order('date', { ascending: false });

        if (vData && vData.length > 0) {
          for (const v of vData) {
            fetchedVentesMap.set(v.id, {
              id: v.id,
              ticket_id: v.ticket_id || v.id,
              patron_id: v.patron_id || patron.id,
              boutique_id: v.boutique_id || activeBoutiqueId,
              produit_id: v.produit_id || '',
              produit_nom: v.produit_nom || '',
              qte: Number(v.qte) || 1,
              montant_total: Number(v.montant_total) || 0,
              client_nom: v.client_nom || '',
              est_credit: Boolean(v.est_credit),
              reste_a_payer: Number(v.reste_a_payer) || 0,
              status: v.status || 'active',
              is_deleted: Boolean(v.is_deleted),
              vendu_par_id: v.vendu_par_id || patron.id,
              vendu_par_nom: v.vendu_par_nom || patron.nom,
              vendu_par_genre: v.vendu_par_genre || 'femme',
              date: v.date || v.created_at || new Date().toISOString(),
              synced: true,
            });
          }
        }
      } catch (err) {
        console.warn('[MonArgent] Erreur fetch table ventes:', err);
      }

      // Compléter avec la table 'transactions'
      try {
        const { data: tData } = await supabase
          .from('transactions')
          .select('*')
          .or(orClause)
          .order('date', { ascending: false });

        if (tData && tData.length > 0) {
          for (const t of tData) {
            if (!fetchedVentesMap.has(t.id)) {
              fetchedVentesMap.set(t.id, {
                id: t.id,
                ticket_id: t.ticket_id || t.id,
                patron_id: t.patron_id || patron.id,
                boutique_id: t.boutique_id || activeBoutiqueId,
                produit_id: t.produit_id || '',
                produit_nom: t.produit_nom || '',
                qte: Number(t.qte || t.quantite) || 1,
                montant_total: Number(t.montant_total || t.montant) || 0,
                client_nom: t.client_nom || '',
                est_credit: Boolean(t.est_credit),
                reste_a_payer: Number(t.reste_a_payer) || 0,
                status: t.status || 'active',
                is_deleted: Boolean(t.is_deleted),
                vendu_par_id: t.vendu_par_id || patron.id,
                vendu_par_nom: t.vendu_par_nom || patron.nom,
                vendu_par_genre: t.vendu_par_genre || 'femme',
                date: t.date || t.created_at || new Date().toISOString(),
                synced: true,
              });
            }
          }
        }
      } catch (err) {
        console.warn('[MonArgent] Erreur fetch table transactions:', err);
      }

      // RÈGLE CRUCIALE 2 : "Ne jamais écraser cache local par Supabase vide. Afficher cache d'abord, puis remplacer seulement si Supabase renvoie données."
      if (fetchedVentesMap.size > 0) {
        setRemoteVentes(Array.from(fetchedVentesMap.values()));
      }

      // 2. Lire les crédits depuis Supabase
      try {
        const { data: cData } = await supabase
          .from('credits')
          .select('*')
          .or(orClause)
          .order('dernier_paiement', { ascending: false });

        if (cData && cData.length > 0) {
          setRemoteCredits(
            cData.map((c) => ({
              id: c.id,
              sale_id: c.sale_id || '',
              patron_id: c.patron_id || patron.id,
              boutique_id: c.boutique_id || activeBoutiqueId,
              client_nom: c.client_nom || '',
              montant_initial: Number(c.montant_initial) || 0,
              reste_a_payer: Number(c.reste_a_payer) || 0,
              telephone: c.telephone || '',
              dernier_paiement: c.dernier_paiement || new Date().toISOString(),
              synced: true,
            }))
          );
        }
      } catch (cErr) {
        console.warn('[MonArgent] Erreur fetch credits:', cErr);
      }

      // 3. Lire les dépenses depuis Supabase
      try {
        const { data: dData } = await supabase
          .from('depenses')
          .select('*')
          .or(orClause)
          .order('date', { ascending: false });

        if (dData && dData.length > 0) {
          setRemoteDepenses(
            dData.map((d) => ({
              id: d.id,
              patron_id: d.patron_id || patron.id,
              boutique_id: d.boutique_id || activeBoutiqueId,
              type: d.type || 'autre',
              montant: Number(d.montant) || 0,
              description: d.description || '',
              cree_par: d.cree_par || patron.nom,
              date: d.date || new Date().toISOString(),
              synced: true,
            }))
          );
        }
      } catch (dErr) {
        console.warn('[MonArgent] Erreur fetch depenses:', dErr);
      }
    } catch (err) {
      console.warn('[MonArgent] Erreur générale fetch remote:', err);
    }
  };

  useEffect(() => {
    loadLogs();
    fetchRemoteSolde();
    fetchRemoteData();
    onDataRefresh();

    // Abonnement Supabase Realtime pour synchronisation multi-appareils
    const channel = supabase
      .channel(`mon_argent_realtime_${patron.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ventes' }, () => {
        fetchRemoteSolde();
        fetchRemoteData();
        onDataRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        fetchRemoteSolde();
        fetchRemoteData();
        onDataRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'depenses' }, () => {
        fetchRemoteSolde();
        fetchRemoteData();
        onDataRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'credits' }, () => {
        fetchRemoteSolde();
        fetchRemoteData();
        onDataRefresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boutiques' }, () => {
        fetchRemoteSolde();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [patron.id]);

  useEffect(() => {
    if (typeof patron.solde === 'number') {
      setRemoteSolde(patron.solde);
    }
  }, [patron.solde]);

  // RÈGLE #2 : Source de vérité = Supabase si données reçues, sinon cache local de l'application
  const effectiveVentes = (remoteVentes && remoteVentes.length > 0) ? remoteVentes : ventes;
  const effectiveCredits = (remoteCredits && remoteCredits.length > 0) ? remoteCredits : credits;
  const effectiveDepenses = (remoteDepenses && remoteDepenses.length > 0) ? remoteDepenses : depenses;

  // Ventes actives (non supprimées)
  const activeVentes = effectiveVentes.filter(
    (v) => (v.status !== 'supprimée' && !(v as any).is_deleted)
  );

  // Ventes actives du jour selon le fuseau horaire de Lomé
  const activeVentesToday = activeVentes.filter((v) => isDateToday(v.date));

  // Ventes supprimées
  const deletedVentes = effectiveVentes.filter(
    (v) => (v.status === 'supprimée' || (v as any).is_deleted)
  );

  // 1. Calculs financiers
  // TOTAL VENTES = somme ventes actives du jour (24h Lomé)
  const totalVentes = activeVentesToday.reduce((sum, v) => sum + v.montant_total, 0);
  const totalDepenses = effectiveDepenses.reduce((sum, d) => sum + d.montant, 0);

  // Somme payée des ventes actives
  const totalVentesPayees = activeVentes.reduce((sum, v) => {
    const reste = v.est_credit ? (v.reste_a_payer || 0) : 0;
    const paye = Math.max(0, v.montant_total - reste);
    return sum + paye;
  }, 0);

  // Solde Net Disponible (depuis Supabase boutiques.solde / patrons.solde, sinon ventes payées - dépenses)
  const soldeCaisse = remoteSolde !== null ? remoteSolde : Math.max(0, totalVentesPayees - totalDepenses);

  // BÉNÉFICE ESTIMÉ = somme (marge produit x qty) pour ventes actives du jour
  const totalBenefice = activeVentesToday.reduce((sum, v) => {
    const prod = products.find((p) => p.id === v.produit_id);
    const prixAchat = prod ? (Number(prod.prix_achat) || 0) : 0;
    const prixVente = prod ? (Number(prod.prix_vente) || 0) : (v.montant_total / (v.qte || 1));
    const marge = Math.max(0, prixVente - prixAchat);
    return sum + (marge * (v.qte || 1));
  }, 0);

  // CE QU'ON TE DOIT = total des crédits avec reste_a_payer > 0 et statut non payé
  const totalCreditsDus = effectiveCredits.reduce((sum, c) => {
    if (c.status === 'payé' || (c as any).statut === 'payé') return sum;
    return sum + (Number(c.reste_a_payer) || 0);
  }, 0);
  const creditsParClient = effectiveCredits.filter(
    (c) => c.status !== 'payé' && (c as any).statut !== 'payé' && (Number(c.reste_a_payer) || 0) > 0
  );

  // Synthèse vocale par EFA
  const handleListenReport = () => {
    const text = `Aujourd'hui, ${totalVentes.toLocaleString('fr-FR')} francs vendus, ${Math.max(
      0,
      totalBenefice
    ).toLocaleString('fr-FR')} francs de bénéfice. On te doit ${totalCreditsDus.toLocaleString(
      'fr-FR'
    )} francs. Tu as dépensé ${totalDepenses.toLocaleString('fr-FR')} francs. Il te reste ${soldeCaisse.toLocaleString(
      'fr-FR'
    )} francs en caisse.`;

    speakFrench(text);
  };

  // Ajout manuel d'une dépense libre
  const handleAddDepense = async (e: React.FormEvent) => {
    e.preventDefault();
    const montant = parseInt(montantDepense, 10);
    if (!typeDepense.trim() || isNaN(montant) || montant <= 0) {
      setFeedback('Indique le type et un montant valide.');
      return;
    }

    setIsAddingDepense(true);
    setFeedback(null);

    // RÈGLE : ID unique neuf avec crypto.randomUUID()
    const depenseId = generatePrefixedId('dep');
    const activeBoutiqueId = getActiveBoutiqueId(patron);
    const newDepense: Depense = {
      id: depenseId,
      patron_id: patron.id,
      boutique_id: activeBoutiqueId,
      type: typeDepense.trim(),
      montant,
      description: descriptionDepense.trim() || undefined,
      cree_par: currentUser.nom,
      date: new Date().toISOString(),
      synced: true,
    };

    try {
      // Enregistrement DIRECT dans Supabase (table depenses, expenses et transactions)
      const depRecord = {
        id: depenseId,
        patron_id: patron.id,
        boutique_id: activeBoutiqueId,
        type: newDepense.type,
        montant: newDepense.montant,
        description: newDepense.description || '',
        cree_par: newDepense.cree_par,
        date: newDepense.date,
        synced: true,
      };

      const txDepense = {
        id: generatePrefixedId('tx'),
        ticket_id: depenseId,
        patron_id: patron.id,
        boutique_id: activeBoutiqueId,
        produit_id: 'depense',
        produit_nom: `Dépense: ${newDepense.type}`,
        qte: 1,
        quantite: 1,
        montant: newDepense.montant,
        montant_total: newDepense.montant,
        type: 'depense',
        status: 'active',
        is_deleted: false,
        vendu_par_nom: currentUser.nom,
        date: newDepense.date,
      };

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          // UPSERT table transactions (onConflict: 'id')
          const resTx: any = await supabase.from('transactions').upsert(txDepense, { onConflict: 'id' });
          if (resTx?.status === 409 || resTx?.error?.code === '23505') {
            console.log('[Sync 409 Déjà présent]', 'transactions', txDepense.id);
          }

          // Synchronisation miroir depenses
          try {
            const resDep: any = await supabase.from('depenses').upsert(depRecord, { onConflict: 'id' });
            if (resDep?.status === 409 || resDep?.error?.code === '23505') {
              console.log('[Sync 409 Déjà présent]', 'depenses', depenseId);
            }
          } catch {}

          // Déduire automatiquement le montant de la dépense du Solde en Supabase
          const { data: btqData } = await supabase
            .from('boutiques')
            .select('solde')
            .eq('id', activeBoutiqueId)
            .maybeSingle();
          let currentSolde = Number(btqData?.solde);
          if (isNaN(currentSolde)) {
            const { data: pData } = await supabase
              .from('patrons')
              .select('solde')
              .eq('id', activeBoutiqueId)
              .maybeSingle();
            currentSolde = Number(pData?.solde) || 0;
          }
          const updatedSolde = Math.max(0, currentSolde - montant);
          await supabase.from('boutiques').update({ solde: updatedSolde }).eq('id', activeBoutiqueId);
          await supabase.from('patrons').update({ solde: updatedSolde }).eq('id', activeBoutiqueId);
          if (patron.id && patron.id !== activeBoutiqueId) {
            try {
              const { data: mainBtq } = await supabase.from('boutiques').select('solde').eq('id', patron.id).maybeSingle();
              const mainSolde = Math.max(0, (Number(mainBtq?.solde) || 0) - montant);
              await supabase.from('boutiques').update({ solde: mainSolde }).eq('id', patron.id);
            } catch {}
          }
          setRemoteSolde(updatedSolde);
          patron.solde = updatedSolde;
          try {
            await db.patrons.update(patron.id, { solde: updatedSolde });
          } catch {}
        } catch (e) {
          console.error('[MonArgent] Erreur Supabase depenses:', e);
        }
      } else {
        newDepense.synced = false;
        await queueSyncItem('depenses', 'insert', depenseId, depRecord);
        await queueSyncItem('transactions', 'insert', txDepense.id, txDepense);
      }

      await db.depenses.put(newDepense);

      // Log historique action dépense
      await logAction({
        patron_id: patron.id,
        user_id: currentUser.id,
        boutique_id: activeBoutiqueId,
        qui: currentUser.nom,
        employe_id: currentUser.role !== 'patron' ? currentUser.id : null,
        employe_nom: currentUser.nom,
        action_type: 'depense',
        description: `Dépense ${newDepense.type}: ${montant.toLocaleString('fr-FR')}F (${newDepense.description || 'Sans détail'}) par ${currentUser.nom}`,
        montant,
      });

      speakFrench(`Dépense de ${montant.toLocaleString('fr-FR')} francs enregistrée pour ${typeDepense}.`);
      setFeedback('Dépense enregistrée !');

      setTypeDepense('');
      setMontantDepense('');
      setDescriptionDepense('');
      onDataRefresh();
    } catch (err) {
      console.error('Erreur dépense:', err);
      setFeedback("Erreur lors de l'enregistrement.");
    } finally {
      setIsAddingDepense(false);
    }
  };

  // Enregistrer le remboursement d'un crédit client
  const handleRembourserCredit = async () => {
    if (!selectedCredit) return;
    const montantPaye = parseInt(remboursementMontant, 10);
    if (isNaN(montantPaye) || montantPaye <= 0) return;

    const nouveauReste = Math.max(0, selectedCredit.reste_a_payer - montantPaye);
    const isPaid = nouveauReste === 0;
    const nowIso = new Date().toISOString();
    const updatedCredit: Credit = {
      ...selectedCredit,
      reste_a_payer: nouveauReste,
      status: isPaid ? 'payé' : 'en_cours',
      statut: isPaid ? 'payé' : 'en_cours',
      dernier_paiement: nowIso,
      synced: typeof navigator !== 'undefined' && navigator.onLine,
    };

    const activeBoutiqueId = getActiveBoutiqueId(patron);
    // RÈGLE : ID unique neuf avec crypto.randomUUID()
    const txRembId = generatePrefixedId('remb');
    const rowTxRemb = {
      id: txRembId,
      ticket_id: selectedCredit.sale_id || ('credit-' + selectedCredit.id),
      patron_id: patron.id,
      boutique_id: activeBoutiqueId,
      produit_id: 'remboursement_credit',
      produit_nom: `Remboursement crédit (${selectedCredit.client_nom})`,
      qte: 1,
      quantite: 1,
      montant: montantPaye,
      montant_total: montantPaye,
      client_nom: selectedCredit.client_nom,
      est_credit: false,
      type: 'remboursement_credit',
      status: 'active',
      is_deleted: false,
      vendu_par_nom: currentUser.nom,
      date: nowIso,
    };

    try {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          // UPDATE permanent dans Supabase (ne jamais supprimer, marquer 'payé' si reste 0)
          await supabase.from('credits').update({
            reste_a_payer: nouveauReste,
            status: isPaid ? 'payé' : 'en_cours',
            statut: isPaid ? 'payé' : 'en_cours',
            dernier_paiement: nowIso,
          }).eq('id', selectedCredit.id);

          // UPSERT direct dans table transactions (onConflict: 'id')
          try {
            const resTx: any = await supabase.from('transactions').upsert(rowTxRemb, { onConflict: 'id' });
            if (resTx?.status === 409 || resTx?.error?.code === '23505') {
              console.log('[Sync 409 Déjà présent]', 'transactions', txRembId);
            }
          } catch {}

          // Remboursement crédit = argent qui entre en caisse -> Solde +
          const { data: btqData } = await supabase
            .from('boutiques')
            .select('solde')
            .eq('id', activeBoutiqueId)
            .maybeSingle();
          let currentSolde = Number(btqData?.solde);
          if (isNaN(currentSolde)) {
            const { data: pData } = await supabase
              .from('patrons')
              .select('solde')
              .eq('id', activeBoutiqueId)
              .maybeSingle();
            currentSolde = Number(pData?.solde) || 0;
          }
          const updatedSolde = currentSolde + montantPaye;
          await supabase.from('boutiques').update({ solde: updatedSolde }).eq('id', activeBoutiqueId);
          await supabase.from('patrons').update({ solde: updatedSolde }).eq('id', activeBoutiqueId);
          if (patron.id && patron.id !== activeBoutiqueId) {
            try {
              const { data: mainBtq } = await supabase.from('boutiques').select('solde').eq('id', patron.id).maybeSingle();
              const mainSolde = (Number(mainBtq?.solde) || 0) + montantPaye;
              await supabase.from('boutiques').update({ solde: mainSolde }).eq('id', patron.id);
            } catch {}
          }
          setRemoteSolde(updatedSolde);
          patron.solde = updatedSolde;
          try {
            await db.patrons.update(patron.id, { solde: updatedSolde });
          } catch {}
        } catch (cErr) {
          console.error('[MonArgent] Erreur remboursement credit Supabase:', cErr);
        }
      } else {
        await queueSyncItem('credits', 'update', selectedCredit.id, {
          reste_a_payer: nouveauReste,
          status: isPaid ? 'payé' : 'en_cours',
          statut: isPaid ? 'payé' : 'en_cours',
          dernier_paiement: nowIso,
        });
        await queueSyncItem('transactions', 'insert', txRembId, rowTxRemb);
      }

      await db.credits.put(updatedCredit);

      // Log historique action remboursement dette
      await logAction({
        patron_id: patron.id,
        user_id: currentUser.id,
        boutique_id: activeBoutiqueId,
        qui: currentUser.nom,
        employe_id: currentUser.role !== 'patron' ? currentUser.id : null,
        employe_nom: currentUser.nom,
        action_type: 'credit',
        description: `Remboursement crédit: ${selectedCredit.client_nom} a versé ${montantPaye.toLocaleString('fr-FR')}F (Reste: ${nouveauReste.toLocaleString('fr-FR')}F)`,
        montant: montantPaye,
      });

      speakFrench(
        `Remboursement de ${montantPaye.toLocaleString('fr-FR')} francs de ${selectedCredit.client_nom} enregistré.`
      );
      setSelectedCredit(null);
      setRemboursementMontant('');
      onDataRefresh();
    } catch (err) {
      console.error('Erreur remboursement:', err);
    }
  };

  // CORRECTION 11 : SUPPRESSION D'UNE VENTE AVEC REMISE EN STOCK (100% SUPABASE)
  const handleConfirmDeleteVente = async () => {
    if (!selectedVenteToDelete || currentUser.role !== 'patron') return;
    setIsDeleting(true);

    const vente = selectedVenteToDelete;
    const nowIso = new Date().toISOString();

    try {
      // 1. UPDATE de la vente et suppression dans la table transactions
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          await supabase
            .from('transactions')
            .delete()
            .eq('id', vente.id);

          try {
            await supabase
              .from('ventes')
              .update({ status: 'supprimée', is_deleted: true })
              .eq('id', vente.id);
          } catch {}
        } catch (delErr) {
          console.error('[MonArgent] Erreur Supabase suppression transaction vente:', delErr);
        }
      }

      // 2. RESTOCKER automatiquement le produit dans Supabase (table produits) : stock = stock_actuel + qte_supprimee
      let currentStock = 0;
      const localProd = products.find((p) => p.id === vente.produit_id);
      if (localProd) currentStock = localProd.stock_qte;

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const { data: remoteProd } = await supabase
            .from('produits')
            .select('stock_qte')
            .eq('id', vente.produit_id)
            .maybeSingle();

          if (remoteProd && typeof remoteProd.stock_qte === 'number') {
            currentStock = remoteProd.stock_qte;
          }
          const restoredStock = currentStock + (vente.qte || 1);
          await supabase
            .from('produits')
            .update({ stock_qte: restoredStock })
            .eq('id', vente.produit_id);

          await db.produits.update(vente.produit_id, { stock_qte: restoredStock });
        } catch (stkErr) {
          console.error('[MonArgent] Erreur remise en stock Supabase:', stkErr);
        }
      } else if (localProd) {
        const restoredStock = currentStock + (vente.qte || 1);
        await db.produits.update(localProd.id, { stock_qte: restoredStock });
      }

      // 3. Mettre à jour dans la table locale Dexie
      try {
        await db.ventes.update(vente.id, { status: 'supprimée', is_deleted: true });
      } catch {
        await db.ventes.delete(vente.id);
      }

      // 4. Si crédit associé, le supprimer ou déduire dans Supabase & local
      if (vente.est_credit && (vente.ticket_id || vente.id || vente.client_nom)) {
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            await supabase
              .from('credits')
              .delete()
              .or(`sale_id.eq.${vente.ticket_id || vente.id},and(client_nom.eq.${vente.client_nom},patron_id.eq.${patron.id})`);
          } catch {}
        }
        const clientCredits = credits.filter(
          (c) => (c.sale_id && (c.sale_id === vente.ticket_id || c.sale_id === vente.id)) || c.client_nom === vente.client_nom
        );
        for (const c of clientCredits) {
          await db.credits.delete(c.id);
        }
      }

      // 5. Décrémentation DIRECTE du solde caisse dans Supabase (somme payée de la vente annulée)
      const montantRembourse = vente.est_credit
        ? Math.max(0, (vente.montant_total || 0) - (vente.reste_a_payer || 0))
        : (vente.montant_total || 0);

      if (montantRembourse > 0) {
        let newCalculatedSolde = Math.max(0, (soldeCaisse || 0) - montantRembourse);
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          try {
            const { data: btqData } = await supabase
              .from('boutiques')
              .select('solde')
              .eq('id', patron.id)
              .maybeSingle();
            let currentRemoteSolde = Number(btqData?.solde);
            if (isNaN(currentRemoteSolde)) {
              const { data: pData } = await supabase
                .from('patrons')
                .select('solde')
                .eq('id', patron.id)
                .maybeSingle();
              currentRemoteSolde = Number(pData?.solde) || 0;
            }
            newCalculatedSolde = Math.max(0, currentRemoteSolde - montantRembourse);
            await supabase.from('boutiques').update({ solde: newCalculatedSolde }).eq('id', patron.id);
            await supabase.from('patrons').update({ solde: newCalculatedSolde }).eq('id', patron.id);
          } catch (sErr) {
            console.warn('[MonArgent] Note mise à jour solde caisse Supabase:', sErr);
          }
        }
        setRemoteSolde(newCalculatedSolde);
        patron.solde = newCalculatedSolde;
        try {
          await db.patrons.update(patron.id, { solde: newCalculatedSolde });
        } catch {}
      }

      // 6. Logger dans logsSuppression et activity_logs / historique_actions
      const logEntry: LogSuppression = {
        id: generatePrefixedId('log'),
        patron_id: patron.id,
        vente_id: vente.id,
        ticket_id: vente.ticket_id,
        produit_nom: vente.produit_nom,
        qte: vente.qte,
        montant: vente.montant_total,
        client_nom: vente.client_nom || 'Client comptant',
        raison: 'Annulation erreur de saisie',
        supprime_par: currentUser.nom,
        date: nowIso,
      };

      await db.logsSuppression.put(logEntry);
      await queueSyncItem('logs_suppression', 'insert', logEntry.id, logEntry);

      const activeBoutiqueId = getActiveBoutiqueId(patron);
      await logAction({
        patron_id: patron.id,
        user_id: currentUser.id,
        boutique_id: activeBoutiqueId,
        qui: currentUser.nom,
        action_type: 'suppression',
        description: `Annulation vente ${vente.qte}x ${vente.produit_nom} (${vente.montant_total}F). Motif: Annulation erreur de saisie`,
        montant: vente.montant_total,
      });

      speakFrench(
        `Vente de ${vente.montant_total.toLocaleString('fr-FR')} francs supprimée. Les ${vente.qte} articles ont été remis en stock.`
      );
      setFeedback('Vente annulée avec succès et stock réintégré !');

      setSelectedVenteToDelete(null);
      await loadLogs();
      onDataRefresh();
    } catch (err) {
      console.error('Erreur suppression vente:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 pb-28 select-none relative pt-2">
      {/* CORRECTION 3: Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onBack} />

      {/* Header avec retour */}
      <div className="flex items-center justify-between pl-14 sm:pl-0">
        <button
          type="button"
          onClick={onBack}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Retour</span>
        </button>

        <h2 className="text-2xl font-black text-gray-900">
          MON ARGENT & CAISSE
        </h2>
      </div>

      {feedback && (
        <div className="p-4 rounded-2xl bg-emerald-100 border-2 border-emerald-400 text-emerald-800 font-black text-center text-lg flex items-center justify-center gap-2">
          <CheckCircle2 className="w-6 h-6 stroke-[3]" />
          <span>{feedback}</span>
        </div>
      )}

      {/* RÈGLE #6 : 4 CARTES GÉANTES */}

      {/* CARTE A : SOLDE VERT */}
      <div className="bg-[#00B894] rounded-3xl p-6 text-white shadow-xl border-2 border-emerald-400">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
              <Wallet className="w-7 h-7" />
            </div>
            <div>
              <span className="text-xs uppercase font-extrabold tracking-wider text-emerald-100">
                Solde Net Disponible
              </span>
              <h3 className="text-3xl sm:text-4xl font-black">
                {soldeCaisse.toLocaleString('fr-FR')} F CFA
              </h3>
            </div>
          </div>

          {/* Bouton pour qu'EFA lise le rapport à voix haute */}
          <button
            type="button"
            onClick={handleListenReport}
            className="p-3.5 rounded-2xl bg-white text-emerald-800 font-black flex items-center gap-2 shadow-lg hover:bg-emerald-50 active:scale-95 transition"
            title="Écouter le bilan vocal par EFA"
          >
            <Volume2 className="w-6 h-6 text-[#00B894]" />
            <span className="text-sm font-extrabold hidden sm:inline">Écouter EFA</span>
          </button>
        </div>

        <div className="mt-4 pt-4 border-t border-emerald-400/50 flex flex-wrap gap-4 text-sm font-bold text-emerald-100">
          <div>
            Total Ventes :{' '}
            <span className="text-white font-black">
              {totalVentes.toLocaleString('fr-FR')} F
            </span>
          </div>
          <div>•</div>
          <div>
            Bénéfice estimé :{' '}
            <span className="text-yellow-200 font-black">
              +{totalBenefice.toLocaleString('fr-FR')} F
            </span>
          </div>
        </div>
      </div>

      {/* CARTE B : TRANSACTIONS BLEU (AVEC FILTRE ET BOUTON SUPPRIMER CORRECTION 11) */}
      <div className="bg-white rounded-3xl p-6 border-2 border-[#0984E3] shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-100 text-[#0984E3] flex items-center justify-center">
              <Receipt className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-900">
                TRANSACTIONS
              </h3>
              <p className="text-xs font-bold text-gray-500">
                {activeVentesToday.length} vente(s) active(s) aujourd'hui
              </p>
            </div>
          </div>

          {/* Filtre onglets Ventes du jour / Ventes supprimées */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-2xl border border-gray-200">
            <button
              type="button"
              onClick={() => setActiveTransactionsTab('actives')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                activeTransactionsTab === 'actives'
                  ? 'bg-white text-blue-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Ventes actives ({activeVentesToday.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTransactionsTab('supprimees')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                activeTransactionsTab === 'supprimees'
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Ventes supprimées ({deletedVentes.length > 0 ? deletedVentes.length : logsList.length})
            </button>
          </div>
        </div>

        {/* CONTENU ONGLETS TRANSACTIONS */}
        {activeTransactionsTab === 'actives' ? (
          activeVentesToday.length === 0 ? (
            <p className="text-center py-6 font-bold text-gray-400 italic">
              Aucune vente active aujourd'hui.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {activeVentesToday.map((v) => (
                <div
                  key={v.id}
                  className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-between gap-2"
                >
                  <div className="flex-1">
                    <h5 className="font-black text-base text-gray-900">
                      {v.qte}x {v.produit_nom}
                    </h5>
                    <p className="text-xs font-bold text-gray-500">
                      Vendu par : <span className="text-[#6C5CE7]">{v.vendu_par_nom}</span>{' '}
                      {v.client_nom && `• Client : ${v.client_nom}`} •{' '}
                      {new Date(v.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="block font-black text-lg text-gray-900">
                        {v.montant_total.toLocaleString('fr-FR')} F
                      </span>
                      <span
                        className={`inline-block text-[11px] font-black px-2 py-0.5 rounded-full ${
                          v.est_credit ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                        }`}
                      >
                        {v.est_credit ? 'CRÉDIT' : 'COMPTANT'}
                      </span>
                    </div>

                    {/* CORRECTION 11 : BOUTON SUPPRIMER (RÉSERVÉ AU PATRON) */}
                    {currentUser.role === 'patron' && (
                      <button
                        type="button"
                        onClick={() => setSelectedVenteToDelete(v)}
                        className="p-2.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 active:scale-95 transition"
                        title="Annuler/Supprimer cette vente et remettre le stock"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* Liste des ventes supprimées (LOGS + VENTES STATUT SUPPRIMÉE) */
          (deletedVentes.length === 0 && logsList.length === 0) ? (
            <p className="text-center py-6 font-bold text-gray-400 italic">
              Aucune vente supprimée dans les journaux.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {deletedVentes.length > 0 ? (
                deletedVentes.map((dv) => (
                  <div
                    key={dv.id}
                    className="p-3.5 rounded-2xl bg-red-50/60 border border-red-200 flex items-center justify-between"
                  >
                    <div>
                      <h5 className="font-black text-sm text-red-950">
                        Annulé : {dv.qte}x {dv.produit_nom} ({dv.montant_total.toLocaleString('fr-FR')} F)
                      </h5>
                      <p className="text-xs font-bold text-red-700 mt-0.5">
                        Client : {dv.client_nom || 'Comptant'} • Par : {dv.vendu_par_nom || 'Patron'} •{' '}
                        {new Date(dv.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="text-xs font-black px-2 py-1 bg-red-200 text-red-800 rounded-lg">
                      Stock remis
                    </span>
                  </div>
                ))
              ) : (
                logsList.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-2xl bg-red-50/60 border border-red-200 flex items-center justify-between"
                  >
                    <div>
                      <h5 className="font-black text-sm text-red-950">
                        Annulé : {log.qte}x {log.produit_nom} ({log.montant.toLocaleString('fr-FR')} F)
                      </h5>
                      <p className="text-xs font-bold text-red-700 mt-0.5">
                        Client : {log.client_nom} • Par : {log.supprime_par} •{' '}
                        {new Date(log.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className="text-xs font-black px-2 py-1 bg-red-200 text-red-800 rounded-lg">
                      Stock remis
                    </span>
                  </div>
                ))
              )}
            </div>
          )
        )}
      </div>

      {/* CARTE C : CE QU'ON TE DOIT ORANGE (Crédits clients) */}
      <div className="bg-white rounded-3xl p-6 border-2 border-[#E17055] shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-orange-100 text-[#E17055] flex items-center justify-center">
              <Users className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-900">
                CE QU'ON TE DOIT (CRÉDITS)
              </h3>
              <p className="text-xs font-bold text-gray-500">
                Clients avec reste à payer
              </p>
            </div>
          </div>
          <span className="text-xl font-black text-[#E17055]">
            {totalCreditsDus.toLocaleString('fr-FR')} F
          </span>
        </div>

        {creditsParClient.length === 0 ? (
          <p className="text-center py-6 font-bold text-gray-400 italic">
            Tous les clients sont à jour ! Aucun crédit en cours.
          </p>
        ) : (
          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {creditsParClient.map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-2xl bg-orange-50/60 border border-orange-200 flex items-center justify-between gap-3"
              >
                <div>
                  <h5 className="font-black text-lg text-gray-900">{c.client_nom}</h5>
                  <p className="text-xs font-bold text-gray-500">
                    Initial : {c.montant_initial.toLocaleString('fr-FR')} F
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xl font-black text-[#E17055]">
                    {c.reste_a_payer.toLocaleString('fr-FR')} F
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCredit(c);
                      setRemboursementMontant(c.reste_a_payer.toString());
                    }}
                    className="px-3 py-2 rounded-xl bg-[#E17055] text-white text-xs font-black shadow hover:bg-orange-600 active:scale-95"
                  >
                    Régler
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CARTE D : DÉPENSES ROUGE (COLONNE OUVERTE & FLEXIBLE) */}
      <div className="bg-white rounded-3xl p-6 border-2 border-[#D63031] shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-100 text-[#D63031] flex items-center justify-center">
              <TrendingUp className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-black text-gray-900">
                DÉPENSES (COLONNE OUVERTE)
              </h3>
              <p className="text-xs font-bold text-gray-500">
                Tape librement : loyer, salaire, charbon, transport...
              </p>
            </div>
          </div>
          <span className="text-xl font-black text-[#D63031]">
            Total : {totalDepenses.toLocaleString('fr-FR')} F
          </span>
        </div>

        {/* Formulaire ajout dépense */}
        <form onSubmit={handleAddDepense} className="space-y-3 mb-6 bg-red-50/40 p-4 rounded-2xl border border-red-200">
          <div>
            <label className="block text-xs font-black uppercase text-gray-600 mb-1">
              Type de dépense (texte libre)
            </label>
            <input
              type="text"
              required
              placeholder="Ex : Loyer, Salaire, Charbon, Taxi, Eau, Emballage..."
              value={typeDepense}
              onChange={(e) => setTypeDepense(e.target.value)}
              className="w-full text-base font-bold p-3 rounded-xl border border-gray-300 focus:border-[#D63031] focus:outline-none bg-white text-gray-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-black uppercase text-gray-600 mb-1">
                Montant (F CFA)
              </label>
              <input
                type="number"
                required
                min={1}
                placeholder="Ex : 50000"
                value={montantDepense}
                onChange={(e) => setMontantDepense(e.target.value)}
                className="w-full text-lg font-black p-3 rounded-xl border border-gray-300 focus:border-[#D63031] focus:outline-none bg-white text-gray-900"
              />
            </div>
            <div>
              <label className="block text-xs font-black uppercase text-gray-600 mb-1">
                Détail / Description (optionnel)
              </label>
              <input
                type="text"
                placeholder="Ex : Reçu boutique N°42"
                value={descriptionDepense}
                onChange={(e) => setDescriptionDepense(e.target.value)}
                className="w-full text-base font-bold p-3 rounded-xl border border-gray-300 focus:border-[#D63031] focus:outline-none bg-white text-gray-900"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isAddingDepense}
            className="w-full min-h-[64px] rounded-2xl bg-[#D63031] hover:bg-red-700 text-white font-black text-xl flex items-center justify-center gap-2 shadow-md transition active:scale-95"
          >
            <Plus className="w-6 h-6 stroke-[3]" />
            <span>AJOUTER DÉPENSE</span>
          </button>
        </form>

        {/* Liste des dépenses existantes */}
        {effectiveDepenses.length === 0 ? (
          <p className="text-center py-4 font-bold text-gray-400 italic">
            Aucune dépense enregistrée pour l'instant.
          </p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {effectiveDepenses.map((d) => (
              <div
                key={d.id}
                className="p-3 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between"
              >
                <div>
                  <h5 className="font-black text-base text-gray-900">{d.type}</h5>
                  <p className="text-xs font-bold text-gray-400">
                    Par {d.cree_par} {d.description && `• ${d.description}`}
                  </p>
                </div>
                <span className="text-lg font-black text-[#D63031]">
                  -{d.montant.toLocaleString('fr-FR')} F
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CORRECTION 11 : MODALE DE CONFIRMATION OUI / NON GÉANTE POUR SUPPRIMER UNE VENTE */}
      {selectedVenteToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-red-500 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 mx-auto flex items-center justify-center shadow">
              <AlertTriangle className="w-10 h-10 stroke-[2.5]" />
            </div>

            <h3 className="text-2xl font-black text-gray-900">
              SUPPRIMER CETTE VENTE ?
            </h3>

            <div className="p-4 rounded-2xl bg-red-50 border-2 border-red-200 text-left space-y-2">
              <p className="text-lg font-black text-gray-900">
                Article : {selectedVenteToDelete.qte}x {selectedVenteToDelete.produit_nom}
              </p>
              <p className="text-base font-bold text-red-700">
                Montant : {selectedVenteToDelete.montant_total.toLocaleString('fr-FR')} F CFA
              </p>
              <p className="text-sm font-semibold text-gray-600">
                Client : {selectedVenteToDelete.client_nom || 'Comptant'}
              </p>
              <div className="pt-2 border-t border-red-200 text-xs font-black text-emerald-700 flex items-center gap-1.5">
                <RotateCcw className="w-4 h-4" />
                <span>Le stock ({selectedVenteToDelete.qte} pièce(s)) sera automatiquement réintégré en magasin.</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <button
                type="button"
                onClick={() => setSelectedVenteToDelete(null)}
                className="min-h-[80px] rounded-2xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-black text-xl flex items-center justify-center"
              >
                NON ✕ Annuler
              </button>

              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeleteVente}
                className="min-h-[80px] rounded-2xl bg-[#D63031] hover:bg-red-700 text-white font-black text-xl flex items-center justify-center shadow-lg shadow-red-500/25"
              >
                OUI ✓ Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Règlement Crédit */}
      {selectedCredit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border-4 border-[#E17055] text-center">
            <h4 className="text-xl font-black text-gray-900 mb-1">
              RÈGLEMENT DE CRÉDIT
            </h4>
            <p className="text-sm font-bold text-gray-500 mb-4">
              Client : <span className="text-gray-900">{selectedCredit.client_nom}</span>
            </p>

            <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 mb-4">
              <span className="text-xs font-bold uppercase text-orange-700">
                Reste à payer actuel
              </span>
              <p className="text-2xl font-black text-[#E17055]">
                {selectedCredit.reste_a_payer.toLocaleString('fr-FR')} F CFA
              </p>
            </div>

            <div className="mb-4 text-left">
              <label className="block text-xs font-black uppercase text-gray-600 mb-1">
                Montant payé aujourd'hui (F) :
              </label>
              <input
                type="number"
                min={1}
                max={selectedCredit.reste_a_payer}
                value={remboursementMontant}
                onChange={(e) => setRemboursementMontant(e.target.value)}
                className="w-full text-2xl font-black text-center p-3 rounded-xl border-2 border-orange-300 focus:outline-none text-gray-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSelectedCredit(null)}
                className="py-3 rounded-xl bg-gray-200 text-gray-800 font-bold"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleRembourserCredit}
                className="py-3 rounded-xl bg-[#00B894] text-white font-black shadow-md hover:bg-emerald-600"
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
