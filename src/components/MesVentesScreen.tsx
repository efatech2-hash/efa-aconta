import React from 'react';
import { Receipt, ArrowLeft, ShoppingBag } from 'lucide-react';
import type { Vente, CurrentUser } from '../lib/types';
import { getAccord } from '../lib/accord';
import { BoutonRetour } from './BoutonRetour';

interface MesVentesScreenProps {
  currentUser: CurrentUser;
  ventes: Vente[];
  onBack: () => void;
}

export const MesVentesScreen: React.FC<MesVentesScreenProps> = ({
  currentUser,
  ventes,
  onBack,
}) => {
  const accord = getAccord(currentUser.genre);

  // Filtre strict selon son vendu_par_id (règle RLS employée)
  const mySales = ventes.filter((v) => v.vendu_par_id === currentUser.id);
  const totalMonChiffre = mySales.reduce((sum, v) => sum + v.montant_total, 0);

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
              {mySales.length} article(s) {accord.venduAccord}(s) par toi aujourd'hui
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

        {mySales.length === 0 ? (
          <div className="bg-white rounded-3xl p-8 border-2 border-gray-200 text-center font-bold text-gray-400">
            <ShoppingBag className="w-12 h-12 mx-auto text-gray-300 mb-2" />
            <p>Tu n'as pas encore enregistré de vente aujourd'hui.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {mySales.map((v) => (
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
