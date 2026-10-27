import React, { useState, useEffect } from 'react';
import {
  Gift,
  Share2,
  Award,
  CheckCircle,
  Clock,
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  Calendar,
  Send,
  Copy,
  QrCode,
  Eye,
  Check,
  AlertCircle,
  Users,
} from 'lucide-react';
import QRCode from 'qrcode';
import type { Patron, Parrainage } from '../lib/types';
import { speakFrench } from '../lib/speech';
import { getAccord } from '../lib/accord';
import { BoutonRetour } from './BoutonRetour';
import { getFilleulsForParrain, generateReferralCode, type FilleulInfo } from '../lib/ambassadeur';

interface AmbassadriceScreenProps {
  patron: Patron;
  parrainages: Parrainage[];
  onBack: () => void;
  onRefresh: () => void;
  onPreviewInvite?: (slug: string) => void;
}

export const AmbassadriceScreen: React.FC<AmbassadriceScreenProps> = ({
  patron,
  parrainages,
  onBack,
  onRefresh,
  onPreviewInvite,
}) => {
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [filleulsList, setFilleulsList] = useState<FilleulInfo[]>([]);
  const [isLoadingFilleuls, setIsLoadingFilleuls] = useState(true);

  const accord = getAccord(patron.genre);

  // Code Parrain Officiel
  const referralCode = patron.referral_code || (patron as any).code_parrain || 'EFA-ACONTA';

  // Lien officiel de parrainage demandé : https://efa-aconta.vercel.app/?ref=VOTRE_CODE
  const lienInviteUrl = `https://efa-aconta.vercel.app/?ref=${referralCode}`;

  // Récupération dynamique des filleuls rattachés à ce code parrain
  useEffect(() => {
    let isMounted = true;
    setIsLoadingFilleuls(true);

    getFilleulsForParrain(referralCode)
      .then((data) => {
        if (!isMounted) return;
        // Si la recherche distante/locale renvoie des résultats
        if (data.length > 0) {
          setFilleulsList(data);
        } else if (parrainages.length > 0) {
          // Fallback sur la prop historique parrainages
          const mapped: FilleulInfo[] = parrainages.map((p) => {
            const isAnnual = p.status === 'valide';
            return {
              id: p.id,
              nom: p.filleul_nom,
              nom_boutique: p.filleul_nom,
              telephone: p.filleul_phone,
              created_at: p.date_inscription,
              plan: isAnnual ? 'pro_annuel' : 'essai',
              statutText: isAnnual ? 'Payé 1 AN (Bonus +60j donné ✅)' : 'Essai',
              isBonusAwarded: isAnnual,
            };
          });
          setFilleulsList(mapped);
        } else {
          setFilleulsList([]);
        }
      })
      .catch((err) => {
        console.warn('Erreur chargement filleuls:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingFilleuls(false);
      });

    return () => {
      isMounted = false;
    };
  }, [referralCode, parrainages]);

  // Filleuls validés ayant payé 1 AN
  const filleulsValides = filleulsList.filter((f) => f.isBonusAwarded || f.statutText.startsWith('Payé 1 AN'));
  const countValides = filleulsValides.length;

  // Total jours / mois gratuits gagnés (+60j = 2 mois par filleul 1 an)
  const totalJoursGagnes = patron.bonus_days_earned || countValides * 60;
  const totalMoisGagnes = Math.floor(totalJoursGagnes / 30);

  // Génération du QR Code
  useEffect(() => {
    QRCode.toDataURL(lienInviteUrl, { width: 220, margin: 1, color: { dark: '#4834D4', light: '#FFFFFF' } })
      .then((url) => setQrCodeDataUrl(url))
      .catch((err) => console.warn('Erreur génération QR Code:', err));
  }, [lienInviteUrl]);

  // Calcul du palier
  let palierNom = 'Bronze';
  let palierColor = 'from-amber-600 to-amber-800';
  let nextThreshold = 6;

  if (countValides >= 21) {
    palierNom = 'Diamant';
    palierColor = 'from-cyan-500 to-blue-600';
    nextThreshold = 50;
  } else if (countValides >= 11) {
    palierNom = 'Or (VIP Ambassadrice)';
    palierColor = 'from-yellow-400 to-amber-500';
    nextThreshold = 21;
  } else if (countValides >= 6) {
    palierNom = 'Argent';
    palierColor = 'from-gray-300 to-gray-500';
    nextThreshold = 11;
  }

  // Copier le lien
  const handleCopyLink = () => {
    navigator.clipboard.writeText(lienInviteUrl);
    setCopied(true);
    speakFrench('Lien de parrainage copié !');
    setTimeout(() => setCopied(false), 2500);
  };

  // PARTAGE SUR WHATSAPP : Texte exact demandé
  const handleShareWhatsApp = () => {
    const message = `Rejoins EFA ACONTA avec mon lien : ${lienInviteUrl} - Paye 1 AN et on gagne 2 MOIS GRATUITS chacun !`;
    const textEncoded = encodeURIComponent(message);
    window.open(`https://api.whatsapp.com/send?text=${textEncoded}`, '_blank');
  };

  // Fermeture automatique du toast après 4 secondes
  useEffect(() => {
    if (successBanner) {
      const timer = setTimeout(() => {
        setSuccessBanner(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [successBanner]);

  const formattedExpiry = new Date(
    patron.fin_abonnement || patron.subscription_end_date || patron.abonnement_expire
  ).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6 pb-28 select-none">
      {/* Toast compact notification en haut à droite */}
      {successBanner && (
        <div className="fixed top-4 right-4 z-50 max-w-[320px] w-auto max-sm:w-[90vw] max-sm:left-1/2 max-sm:-translate-x-1/2 max-sm:right-auto max-sm:top-3 p-3 bg-emerald-600 text-white rounded-2xl shadow-xl flex items-center gap-2.5 text-sm max-sm:text-[13px] font-bold border border-emerald-400 animate-in fade-in slide-in-from-top-2">
          <Check className="w-5 h-5 flex-shrink-0 text-white stroke-[3]" />
          <span className="flex-1 leading-snug">{successBanner}</span>
          <button
            type="button"
            onClick={() => setSuccessBanner(null)}
            className="p-1 rounded-lg hover:bg-emerald-700 text-white transition flex-shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onBack} />

      {/* Header */}
      <div className="flex items-center justify-between pl-14 sm:pl-0">
        <button
          type="button"
          onClick={onBack}
          className="btn hidden sm:inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Retour</span>
        </button>

        <h2 className="text-xl sm:text-2xl font-black text-gray-900 flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-amber-500" />
          <span>PROGRAMME AMBASSADEUR</span>
        </h2>
      </div>

      {/* Carte Statut Ambassadrice & Palier */}
      <div className={`rounded-3xl p-6 text-white bg-gradient-to-tr ${palierColor} shadow-xl relative overflow-hidden`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center">
              <Award className="w-9 h-9 text-yellow-300" />
            </div>
            <div>
              <span className="text-xs font-black uppercase tracking-wider text-white/80">
                Statut Ambassadeur
              </span>
              <h3 className="text-2xl sm:text-3xl font-black">Palier {palierNom}</h3>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs font-black uppercase text-white/80">Bonus gagné</span>
            <div className="text-2xl sm:text-3xl font-black">+{totalJoursGagnes} JOURS</div>
            <span className="text-xs font-bold text-yellow-200 block">({totalMoisGagnes} mois offerts)</span>
          </div>
        </div>

        {/* Date d'expiration repoussée */}
        <div className="bg-black/20 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-yellow-300" />
            <span className="text-sm font-bold">Ton abonnement est valide jusqu'au :</span>
          </div>
          <span className="text-base font-black text-yellow-200">{formattedExpiry}</span>
        </div>

        {/* Statistiques clics & filleuls */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
          <div className="p-2.5 rounded-xl bg-white/20">
            <span className="block text-2xl font-black">{filleulsList.length}</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">Commerçantes inscrites</span>
          </div>
          <div className="p-2.5 rounded-xl bg-white/20">
            <span className="block text-2xl font-black text-yellow-300">{countValides}</span>
            <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">Abonnées 1 AN (+60j)</span>
          </div>
        </div>

        {/* Progression vers palier suivant */}
        <div className="mt-4">
          <div className="flex justify-between text-xs font-black mb-1">
            <span>{countValides} filleule(s) abonnée(s) 1 an</span>
            <span>Objectif : {nextThreshold} filleules</span>
          </div>
          <div className="w-full bg-white/30 h-3 rounded-full overflow-hidden">
            <div
              className="bg-yellow-300 h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, (countValides / nextThreshold) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* RÈGLE D'OR : EXPLICATION CLAIRE */}
      <div className="bg-emerald-50 border-2 border-emerald-400 rounded-3xl p-5">
        <div className="flex items-start gap-3">
          <Sparkles className="w-8 h-8 text-emerald-600 flex-shrink-0 mt-1" />
          <div className="space-y-1">
            <h4 className="text-lg font-black text-emerald-900">
              RÈGLE D'OR DU PARRAINAGE :
            </h4>
            <p className="text-sm font-bold text-emerald-800">
              Quand une commerçante que tu invites paye un abonnement <strong>1 AN</strong> (Populaire 16.500F ou Boutique Pro 90.000F) :
            </p>
            <div className="mt-2 inline-block px-4 py-2 bg-emerald-600 text-white font-black text-base rounded-xl shadow-md">
              🎁 TU GAGNES IMMÉDIATEMENT +60 JOURS (2 MOIS) GRATUITS !
            </div>
          </div>
        </div>
      </div>

      {/* LIEN PERSONNEL, QR CODE ET WHATSAPP */}
      <div className="bg-white rounded-3xl p-6 border-2 border-gray-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row items-center gap-5">
          {/* QR Code */}
          {qrCodeDataUrl && (
            <div className="flex flex-col items-center">
              <div className="p-2 rounded-2xl border-2 border-purple-200 bg-white shadow-md">
                <img src={qrCodeDataUrl} alt="QR Code Parrainage" className="w-36 h-36" />
              </div>
              <span className="text-[11px] font-black text-purple-700 mt-1 flex items-center gap-1">
                <QrCode className="w-3 h-3" />
                Scanne pour t'inscrire
              </span>
            </div>
          )}

          {/* Lien à copier */}
          <div className="flex-1 w-full space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black uppercase text-gray-500">
                Ton lien d'invitation exclusif :
              </label>
              <span className="text-xs font-mono font-black text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-200">
                Code : {referralCode}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={lienInviteUrl}
                className="w-full text-sm font-black p-3.5 rounded-2xl border-2 border-purple-200 bg-purple-50/50 text-[#6C5CE7] select-all font-mono"
              />
              <button
                type="button"
                onClick={handleCopyLink}
                className="p-3.5 rounded-2xl bg-purple-100 hover:bg-purple-200 text-[#6C5CE7] font-black flex items-center justify-center transition flex-shrink-0 cursor-pointer"
                title="Copier le lien"
              >
                {copied ? <Check className="w-6 h-6 text-emerald-600" /> : <Copy className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* BOUTON VERT GÉANT PARTAGER SUR WHATSAPP */}
        <div>
          <button
            type="button"
            onClick={handleShareWhatsApp}
            className="btn min-h-[74px] w-full p-4 rounded-2xl bg-[#25D366] hover:bg-[#20b858] active:scale-95 text-white font-black text-lg sm:text-xl flex items-center justify-center gap-3 shadow-xl shadow-emerald-500/25 transition cursor-pointer text-center"
          >
            <Share2 className="w-7 h-7 stroke-[2.5] shrink-0" />
            <span>PARTAGER SUR WHATSAPP (+2 MOIS OFFERTS)</span>
          </button>

          {/* CONDITIONS EN PETIT TEXTE DEMANDÉ */}
          <p className="text-[11px] font-semibold text-gray-500 mt-2 text-center leading-relaxed">
            *Bonus de 2 mois offert uniquement si votre filleul paye un forfait de 1 AN (Populaire 16.500F ou Boutique Pro 90.000F). Valable 1 fois par filleul. Parrainage illimité.
          </p>
        </div>
      </div>

      {/* Règles Anti-Fraude */}
      <div className="bg-gray-100 rounded-3xl p-5 border border-gray-300">
        <div className="flex items-center gap-2 text-gray-700 font-black text-sm mb-2">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <span>SÉCURITÉ ANTI-FRAUDE & VALIDATION :</span>
        </div>
        <ul className="text-xs font-bold text-gray-600 space-y-1 list-disc list-inside">
          <li>1 boutique / numéro WhatsApp = 1 seule attribution de bonus.</li>
          <li>Le bonus de +60 jours est activé automatiquement dès validation du paiement 1 AN par la direction.</li>
          <li>Les forfaits mensuels (1.500F) et 6 mois (50.000F) ne déclenchent aucun bonus ambassadeur.</li>
        </ul>
      </div>

      {/* LISTE DES FILLEULS AVEC STATUTS OFFICIELS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-600" />
            <span>Tes commerçantes filleules ({filleulsList.length})</span>
          </h3>
          <span className="text-xs font-bold text-gray-400">
            {countValides} validée(s) 1 AN
          </span>
        </div>

        {isLoadingFilleuls ? (
          <div className="p-8 text-center text-gray-400 text-sm font-bold">
            Chargement de tes filleules...
          </div>
        ) : filleulsList.length === 0 ? (
          <div className="p-8 text-center rounded-2xl bg-white border-2 border-dashed border-gray-200">
            <p className="font-bold text-gray-400 italic">
              Aucune filleule pour le moment. Partage ton lien sur WhatsApp pour commencer à gagner !
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filleulsList.map((f) => {
              // Rendu du badge de statut exact
              const renderBadge = () => {
                switch (f.statutText) {
                  case 'Payé 1 AN (Bonus +60j donné ✅)':
                    return (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Payé 1 AN (Bonus +60j donné ✅)</span>
                      </span>
                    );
                  case 'Payé 6 mois (non éligible)':
                    return (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-purple-100 text-purple-800 border border-purple-200">
                        <span>Payé 6 mois (non éligible)</span>
                      </span>
                    );
                  case 'Payé 30j (non éligible)':
                    return (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-200">
                        <span>Payé 30j (non éligible)</span>
                      </span>
                    );
                  case 'Essai':
                  default:
                    return (
                      <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-black bg-slate-100 text-slate-700 border border-slate-200">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        <span>Essai</span>
                      </span>
                    );
                }
              };

              return (
                <div
                  key={f.id}
                  className="p-4 rounded-2xl bg-white border-2 border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div>
                    <h5 className="font-black text-base text-gray-900">{f.nom_boutique}</h5>
                    <p className="text-xs font-bold text-gray-500">
                      Gérant(e) : {f.nom} {f.telephone ? `• 📞 ${f.telephone}` : ''}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    {renderBadge()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
