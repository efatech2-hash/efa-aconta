import React from 'react';
import { Crown, Sparkles, X, MessageCircle, Calendar, ShieldCheck, Check } from 'lucide-react';
import type { Patron } from '../lib/types';

interface MonAbonnementModalProps {
  isOpen: boolean;
  onClose: () => void;
  patron: Patron;
}

export const MonAbonnementModal: React.FC<MonAbonnementModalProps> = ({
  isOpen,
  onClose,
  patron,
}) => {
  if (!isOpen) return null;

  // 1. FORFAIT ACTUEL : Badge "TRIAL" ou "6 MOIS (50.000F)" ou "1 AN" - récupéré depuis patron.forfait
  const rawForfait = (
    patron.forfait ||
    patron.subscription_status ||
    (patron as any).plan ||
    'TRIAL'
  ).toUpperCase();

  let badgeLabel = 'TRIAL';
  let badgeColor = 'bg-amber-100 text-amber-900 border-amber-300';
  let totalPeriodDays = 21;
  let avantagesText = "7 jours d'essai, 1 boutique, support WhatsApp";

  if (rawForfait.includes('ANNUEL') || rawForfait.includes('90') || rawForfait === 'PRO' || (rawForfait.includes('1') && rawForfait.includes('AN'))) {
    badgeLabel = '1 AN';
    badgeColor = 'bg-blue-100 text-blue-900 border-blue-400 font-black';
    totalPeriodDays = 365;
    avantagesText = '12 mois complets, boutiques illimitées, appareils illimités, support 24h, tout inclus';
  } else if (rawForfait.includes('6') || rawForfait.includes('50') || rawForfait.includes('PRO_6MOIS')) {
    badgeLabel = '6 MOIS (50.000F)';
    badgeColor = 'bg-purple-100 text-purple-900 border-purple-400 font-black';
    totalPeriodDays = 180;
    avantagesText = '6 mois complets, 2 boutiques max, 3 appareils, support prioritaire, rapports illimités';
  } else if (rawForfait.includes('POPULAIRE') || rawForfait.includes('16500') || rawForfait.includes('16.5')) {
    badgeLabel = 'POPULAIRE (16.500F)';
    badgeColor = 'bg-yellow-100 text-amber-950 border-amber-400 font-black';
    totalPeriodDays = 365;
    avantagesText = '100 articles au catalogue, 3 vendeurs avec code PIN, 3 appareils connectés, calcul bénéfices, reçu WhatsApp';
  } else if (rawForfait.includes('PROLONGE')) {
    badgeLabel = 'PROLONGÉ (+30J)';
    badgeColor = 'bg-amber-100 text-amber-900 border-amber-300 font-black';
    totalPeriodDays = 30;
    avantagesText = '30 jours complets, multi-appareils, support WhatsApp prioritaire, tout inclus';
  } else {
    badgeLabel = 'TRIAL';
    badgeColor = 'bg-amber-100 text-amber-900 border-amber-300 font-black';
    totalPeriodDays = 21;
    avantagesText = "7 jours d'essai, 1 boutique, support WhatsApp";
  }

  // 2. DATE FIN ET JOURS RESTANTS
  const rawEndDate =
    patron.fin_abonnement ||
    patron.subscription_end_date ||
    patron.abonnement_expire ||
    patron.trial_end_date;

  const now = new Date();
  const finDate = rawEndDate ? new Date(rawEndDate) : new Date(Date.now() + 7 * 86400000);
  const diffDays = Math.ceil((finDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const joursRestants = Math.max(0, diffDays);
  const isExpired = diffDays < 0;
  const progressRatio = Math.min(100, Math.max(4, Math.round((joursRestants / totalPeriodDays) * 100)));
  const dateFinFormatted = finDate.toLocaleDateString('fr-FR');

  // 3. WHATSAPP RENOUVELLEMENT
  const whatsappNumber =
    (import.meta.env && import.meta.env.VITE_WHATSAPP_NUMBER) ||
    '22896100972';
  const patronNomEncoded = encodeURIComponent(patron.nom || 'Patron');
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=Bonjour%20EFA%20ACONTA%20je%20veux%20renouveler%20mon%20abonnement%20${patronNomEncoded}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-5 sm:p-6 max-w-sm sm:max-w-md w-full shadow-2xl space-y-4 border-2 border-slate-200 relative select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* BOUTON FERMER X */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center transition active:scale-95 cursor-pointer"
          title="Fermer"
          aria-label="Fermer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* HEADER MODAL */}
        <div className="flex items-center gap-3 pr-8">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-400 to-yellow-300 text-amber-950 flex items-center justify-center shadow-md shrink-0">
            <Crown className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">
              Mon Forfait Caisse
            </h3>
            <p className="text-xs font-semibold text-slate-500">
              {patron.nom_boutique || 'Ma Boutique'}
            </p>
          </div>
        </div>

        {/* a) FORFAIT ACTUEL BADGE */}
        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-slate-500 tracking-wider">
              Forfait Actuel
            </span>
            <span
              className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider border shadow-xs ${badgeColor}`}
            >
              {badgeLabel}
            </span>
          </div>

          {/* b) JOURS RESTANTS + PROGRESS BAR */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Temps restant :</span>
              </span>
              <span
                className={`text-sm font-black ${
                  isExpired
                    ? 'text-rose-600'
                    : joursRestants <= 5
                    ? 'text-amber-600'
                    : 'text-emerald-700'
                }`}
              >
                {isExpired ? 'Abonnement Expiré' : `${joursRestants} jours restants`}
              </span>
            </div>

            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden border border-slate-300/60">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isExpired
                    ? 'bg-rose-500'
                    : joursRestants <= 5
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${progressRatio}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] font-bold text-slate-400">
              <span>{isExpired ? '0%' : `${progressRatio}%`}</span>
              <span>{joursRestants} / {totalPeriodDays} jours</span>
            </div>
          </div>

          {/* c) DATE FIN */}
          <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
            <span className="flex items-center gap-1 text-slate-500">
              <Calendar className="w-4 h-4 text-slate-400" />
              <span>Date d'expiration :</span>
            </span>
            <span className="font-black text-slate-900">
              Expire le {dateFinFormatted}
            </span>
          </div>
        </div>

        {/* d) AVANTAGES DU FORFAIT */}
        <div className="p-3.5 rounded-2xl bg-emerald-50/80 border border-emerald-200 space-y-2">
          <div className="flex items-center gap-1.5 text-emerald-950 font-black text-xs uppercase tracking-wider">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Avantages de votre offre</span>
          </div>
          <p className="text-xs font-bold text-emerald-900 leading-relaxed">
            {avantagesText}
          </p>
        </div>

        {/* e) BOUTON WHATSAPP */}
        <div className="pt-2">
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3.5 px-4 rounded-2xl bg-[#25D366] hover:bg-[#20ba5a] active:scale-95 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition cursor-pointer"
          >
            <MessageCircle className="w-5 h-5 fill-white stroke-none" />
            <span>Renouveler via WhatsApp</span>
          </a>
        </div>
      </div>
    </div>
  );
};

export default MonAbonnementModal;
