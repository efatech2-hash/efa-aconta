import React, { useState, useEffect } from 'react';
import { Receipt, ArrowLeft, ShoppingBag } from 'lucide-react';
import type { Vente, CurrentUser } from '../lib/types';
import { getAccord } from '../lib/accord';
import { BoutonRetour } from './BoutonRetour';
import { supabase } from '../lib/supabase';
import { getActiveBoutiqueId } from '../lib/deviceAuth';

interface MesVentesScreenProps {
  currentUser: CurrentUser;
  ventes: Vente[];
  boutiqueId?: string;
  onBack: () => void;
}

function isDateToday(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

export const MesVentesScreen: React.FC<MesVentesScreenProps> = ({
  currentUser,
  ventes,
  boutiqueId,
  onBack,
}) => {
  const accord = getAccord(currentUser.genre);
  const [remoteSales, setRemoteSales] = useState<Vente[] | null>(null);
  const activeBoutiqueId = boutiqueId || getActiveBoutiqueId();

  // Charger directement les ventes depuis Supabase pour cet employé dans la boutique active
  const fetchMySales = async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        let query = supabase
          .from('ventes')
          .select('*')
          .or(`vendu_par_id.eq.${currentUser.id},employee_id.eq.${currentUser.id}`);

        if (activeBoutiqueId) {
          query = query.eq('boutique_id', activeBoutiqueId);
        }

        const { data, error } = await query.order('date', { ascending: false });

        if (!error && data) {
          setRemoteSales(data.map((v) => ({
            id: v.id,
            boutique_id: v.boutique_id,
            ticket_id: v.ticket_id || v.id,
            patron_id: v.patron_id,
            produit_id: v.produit_id || '',
            produit_nom: v.produit_nom || '',
            qte: Number(v.qte) || 1,
            montant_total: Number(v.montant_total) || 0,
            client_nom: v.client_nom || '',
            est_credit: Boolean(v.est_credit),
            reste_a_payer: Number(v.reste_a_payer) || 0,
            vendu_par_id: v.vendu_par_id || currentUser.id,
            vendu_par_nom: v.vendu_par_nom || currentUser.nom,
            date: v.date || v.created_at || new Date().toISOString(),
            status: v.status || 'active',
            is_deleted: Boolean(v.is_deleted),
            synced: true,
          })));
        }
      } catch (err) {
        console.warn('[MesVentes] Erreur fetch Supabase:', err);
      }
    }
  };

  useEffect(() => {
    setRemoteSales(null);
    fetchMySales();

    // Abonnement Supabase Realtime
    const channel = supabase
      .channel(`mes_ventes_realtime_${currentUser.id}_${activeBoutiqueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ventes' },
        () => {
          fetchMySales();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUser.id, activeBoutiqueId]);

  // Ventes du jour actives de l'employé pour la boutique active
  const activeSalesSource = remoteSales !== null ? remoteSales : ventes;
  const mySalesToday = activeSalesSource.filter(
    (v) =>
      (!activeBoutiqueId || (v.boutique_id ? v.boutique_id === activeBoutiqueId : v.patron_id === activeBoutiqueId)) &&
      (v.vendu_par_id === currentUser.id || (v as any).employee_id === currentUser.id) &&
      isDateToday(v.date) &&
      (v as any).status !== 'supprimée' &&
      !(v as any).is_deleted
  );

  const totalMonChiffre = mySalesToday.reduce((sum, v) => sum + v.montant_total, 0);
  const totalArticlesVendus = mySalesToday.reduce((sum, v) => sum + (v.qte || 1), 0);

  return (
    <div className="space-y-6 pb-28 select-none relative pt-2">
      {/* CORRECTION 3: Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onBack} />

      {/* Header */}
      <div className="flex items-center justify-between pl-14 sm:pl-0">
        <button
          type="button"
          onClick={onBack}
          className="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Retour</span>
        </button>

        <h2 className="text-xl sm:text-2xl font-black text-gray-900">
          MES VENTES DU JOUR
        </h2>
      </div>

      {/* Résumé accordé selon le genre */}
      <div className="bg-[#0984E3] rounded-3xl p-6 text-white shadow-xl">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-black uppercase text-blue-100 tracking-wider">
              {accord.titreVendeur} : {currentUser.nom}
            </span>
            <h3 className="text-3xl font-black mt-1">
              {totalMonChiffre.toLocaleString('fr-FR')} F CFA
            </h3>
            <p className="text-sm font-bold text-blue-100 mt-0.5">
              {totalArticlesVendus} article(s) {accord.venduAccord}(s) par toi aujourd'hui
            </p>
          </div>
          <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
            <Receipt className="w-8 h-8" />
          </div>
        </div>
      </div>

      {/* Liste de ses ventes uniquement */}
      <div className="space-y-3">
        <h3 className="text-lg font-black text-gray-900">
          Historique de tes enregistrements :
        </h3>

        {mySalesToday.length === 0 ? (
          <div className="bg-white rounded-3xl p-8 border-2 border-gray-200 text-center font-bold text-gray-400">
            <ShoppingBag className="w-12 h-12 mx-auto text-gray-300 mb-2" />
            <p>Tu n'as pas encore enregistré de vente aujourd'hui.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {mySalesToday.map((v) => (
              <div
                key={v.id}
                className="p-4 rounded-2xl bg-white border-2 border-gray-200 shadow-sm flex items-center justify-between"
              >
                <div>
                  <h4 className="font-black text-lg text-gray-900">
                    {v.qte}x {v.produit_nom}
                  </h4>
                  <p className="text-xs font-bold text-gray-500">
                    Client : {v.client_nom || 'Client comptant'} •{' '}
                    {new Date(v.date).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <span className="block font-black text-xl text-gray-900">
                    {v.montant_total.toLocaleString('fr-FR')} F
                  </span>
                  <span
                    className={`inline-block text-[11px] font-black px-2.5 py-0.5 rounded-full ${
                      v.est_credit ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {v.est_credit ? 'À CRÉDIT' : 'COMPTANT'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
