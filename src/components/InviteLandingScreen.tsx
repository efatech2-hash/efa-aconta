import React from 'react';
import { Gift, Sparkles, Store, CheckCircle, ArrowRight } from 'lucide-react';
import type { Patron } from '../lib/types';
import { getAccord } from '../lib/accord';

interface InviteLandingScreenProps {
  patron: Patron;
  slug: string;
  onAcceptInvite: (slug: string) => void;
  onBack?: () => void;
}

export const InviteLandingScreen: React.FC<InviteLandingScreenProps> = ({
  patron,
  slug,
  onAcceptInvite,
  onBack,
}) => {
  const accord = getAccord(patron.genre);

  const handleStart = () => {
    localStorage.setItem('efa_invite_code', slug);
    onAcceptInvite(slug);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex flex-col items-center justify-center p-4 sm:p-6 select-none">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-[#6C5CE7] text-center space-y-6">
        {/* Badge invitation */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-100 text-amber-900 font-black text-sm">
          <Gift className="w-4 h-4 text-amber-600" />
          <span>INVITATION OFFICIELLE • 1 MOIS OFFERT</span>
        </div>

        {/* Photo ou avatar du parrain */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative mb-2">
            {patron.photo_url ? (
              <img
                src={patron.photo_url}
                alt={patron.nom}
                className="w-28 h-28 rounded-full object-cover border-4 border-[#6C5CE7] shadow-xl"
              />
            ) : (
              <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-[#6C5CE7] to-indigo-500 text-white flex items-center justify-center text-4xl font-black shadow-xl border-4 border-white">
                {patron.nom.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="absolute -bottom-1 -right-1 bg-yellow-400 p-2 rounded-full shadow border-2 border-white">
              👑
            </div>
          </div>

          <h2 className="text-3xl font-black text-gray-900 mt-2">
            {patron.nom} t'invite !
          </h2>
          <p className="text-sm font-extrabold text-[#6C5CE7] flex items-center justify-center gap-1 mt-1">
            <Store className="w-4 h-4" />
            <span>{patron.nom_boutique}</span>
          </p>
        </div>

        {/* Carte offre 1 mois offert */}
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-3xl p-5 text-left space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-emerald-600" />
            <h4 className="text-lg font-black text-emerald-950">
              Gagne du temps et zéro erreur de caisse !
            </h4>
          </div>
          <p className="text-sm font-bold text-emerald-900">
            Rejoins <strong>EFA ACONTA V5</strong> grâce au lien personnel de {patron.nom} et reçois :
          </p>
          <ul className="text-xs sm:text-sm font-extrabold text-emerald-800 space-y-1.5">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>1 mois d'abonnement complet 100% offert</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Caisse tactile et vocale avec l'assistante EFA</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Fonctionne 100% hors-ligne même sans réseau</span>
            </li>
          </ul>
        </div>

        {/* Bouton géant vert s'inscrire */}
        <button
          type="button"
          onClick={handleStart}
          className="w-full min-h-[85px] rounded-2xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-xl sm:text-2xl flex items-center justify-center gap-3 shadow-xl shadow-emerald-500/25 transition"
        >
          <span>S'INSCRIRE AVEC LE CODE DE {patron.nom.toUpperCase()}</span>
          <ArrowRight className="w-7 h-7 stroke-[3]" />
        </button>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-bold text-gray-400 hover:text-gray-600 underline"
          >
            Fermer l'aperçu et retourner à l'application
          </button>
        )}
      </div>
    </div>
  );
};
