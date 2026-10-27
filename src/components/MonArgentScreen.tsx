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

  // Charger les logs de suppression
  const loadLogs = async () => {
    try {
      const logs = await db.logsSuppression.where('patron_id').equals(patron.id).reverse().sortBy('date');
      setLogsList(logs);
    } catch (err) {
      console.warn('Erreur chargement logs suppressions:', err);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [patron.id]);

  // 1. Calculs financiers
  const totalVentes = ventes.reduce((sum, v) => sum + v.montant_total, 0);
  const totalDepenses = depenses.reduce((sum, d) => sum + d.montant, 0);
  const soldeCaisse = totalVentes - totalDepenses;

  // Calcul du bénéfice brut (Marge sur ventes)
  const totalBenefice = ventes.reduce((sum, v) => {
    const prod = products.find((p) => p.id === v.produit_id);
    const coutAchat = prod ? prod.prix_achat * v.qte : 0;
    return sum + (v.montant_total - coutAchat);
  }, 0);

  const totalCreditsDus = credits.reduce((sum, c) => sum + c.reste_a_payer, 0);
  const creditsParClient = credits.filter((c) => c.reste_a_payer > 0);

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

    const depenseId = 'dep-' + Date.now();
    const newDepense: Depense = {
      id: depenseId,
      patron_id: patron.id,
      type: typeDepense.trim(),
      montant,
      description: descriptionDepense.trim() || undefined,
      cree_par: currentUser.nom,
      date: new Date().toISOString(),
      synced: false,
    };

    try {
      await db.depenses.put(newDepense);
      await queueSyncItem('depenses', 'insert', depenseId, newDepense);

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
    const updatedCredit = {
      ...selectedCredit,
      reste_a_payer: nouveauReste,
      dernier_paiement: new Date().toISOString(),
    };

    try {
      await db.credits.put(updatedCredit);
      await queueSyncItem('credits', 'update', selectedCredit.id, updatedCredit);

      // MODIF 2: Log historique action remboursement dette
      logAction({
        patron_id: patron.id,
        user_id: currentUser.id,
        employe_id: currentUser.role !== 'patron' ? currentUser.id : null,
        employe_nom: currentUser.nom,
        action_type: 'remboursement_dette',
        description: `Remboursement dette: ${selectedCredit.client_nom} a remboursé ${montantPaye}F sur dette de ${selectedCredit.montant_initial}F par ${currentUser.nom || 'Patron'}`,
        montant: montantPaye,
      }).catch(console.error);

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

  // CORRECTION 11 : SUPPRESSION D'UNE VENTE AVEC REMISE EN STOCK
  const handleConfirmDeleteVente = async () => {
    if (!selectedVenteToDelete || currentUser.role !== 'patron') return;
    setIsDeleting(true);

    const vente = selectedVenteToDelete;
    const nowIso = new Date().toISOString();

    try {
      // 1. Supprimer de la table locale ventes
      await db.ventes.delete(vente.id);
      await queueSyncItem('ventes', 'delete', vente.id, {});

      // 2. Remettre le stock du produit vendu
      const prod = products.find((p) => p.id === vente.produit_id);
      if (prod) {
        const restoredStock = prod.stock_qte + vente.qte;
        await db.produits.update(prod.id, { stock_qte: restoredStock });
        await queueSyncItem('produits', 'update', prod.id, { stock_qte: restoredStock });
      }

      // 3. Si crédit, déduire ou supprimer le crédit
      if (vente.est_credit) {
        const clientCredits = credits.filter((c) => c.client_nom === vente.client_nom);
        for (const c of clientCredits) {
          const newReste = Math.max(0, c.reste_a_payer - vente.montant_total);
          if (newReste === 0) {
            await db.credits.delete(c.id);
            await queueSyncItem('credits', 'delete', c.id, {});
          } else {
            await db.credits.update(c.id, { reste_a_payer: newReste });
            await queueSyncItem('credits', 'update', c.id, { reste_a_payer: newReste });
          }
        }
      }

      // 4. Logger dans la table logsSuppression
      const logEntry: LogSuppression = {
        id: 'log-' + Date.now(),
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

      // MODIF 1: Log historique action suppression
      logAction({
        patron_id: patron.id,
        user_id: currentUser.id,
        action_type: 'suppression',
        description: `Annulation vente ${vente.qte}x ${vente.produit_nom} (${vente.montant_total}F). Motif: Annulation erreur de saisie`,
        montant: vente.montant_total,
      }).catch(console.error);

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
                {ventes.length} vente(s) active(s)
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
              Ventes actives ({ventes.length})
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
              Ventes supprimées ({logsList.length})
            </button>
          </div>
        </div>

        {/* CONTENU ONGLETS TRANSACTIONS */}
        {activeTransactionsTab === 'actives' ? (
          ventes.length === 0 ? (
            <p className="text-center py-6 font-bold text-gray-400 italic">
              Aucune vente active aujourd'hui.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {ventes.map((v) => (
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
                      {v.client_nom && `• Client : ${v.client_nom}`}
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
          /* Liste des ventes supprimées (LOGS) */
          logsList.length === 0 ? (
            <p className="text-center py-6 font-bold text-gray-400 italic">
              Aucune vente supprimée dans les journaux.
            </p>
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {logsList.map((log) => (
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
              ))}
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
        {depenses.length === 0 ? (
          <p className="text-center py-4 font-bold text-gray-400 italic">
            Aucune dépense enregistrée pour l'instant.
          </p>
        ) : (
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {depenses.map((d) => (
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
