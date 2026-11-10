import React, { useState } from 'react';
import { Check, X, Shield, Sparkles, MessageCircle, Crown, Lock, PhoneCall } from 'lucide-react';
import type { Patron, SubscriptionStatus } from '../lib/types';

interface SubscriptionModalProps {
  isOpen: boolean;
  isBlocking?: boolean; // Si true (essai expiré), pas de bouton fermer
  onClose?: () => void;
  patron?: Patron | null;
  highlightPlan?: 'populaire' | 'pro' | null;
  featureReason?: string; // Ex: "Ajout de plus de 100 articles" ou "Multi-boutique"
  onPlanSelected?: (newStatus: SubscriptionStatus) => void;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  isBlocking = false,
  onClose,
  patron,
  highlightPlan = 'populaire',
  featureReason,
  onPlanSelected,
}) => {
  const [selectedBilling, setSelectedBilling] = useState<'mensuel' | 'annuel'>('mensuel');

  if (!isOpen) return null;

  const currentStatus = patron?.subscription_status || 'trial';
  const patronIdentifier = patron?.telephone || patron?.nom || 'mon compte';

  const handleOpenWhatsApp = () => {
    const nomClient = patron?.nom || 'Client';
    const nomBoutique = patron?.nom_boutique || 'Ma Boutique';
    const text = `Bonjour EFA TECH Aconta, je suis ${nomClient} boutique ${nomBoutique}, je veux payer mon abonnement`;
    const whatsappNum = (import.meta.env && import.meta.env.VITE_WHATSAPP_NUMBER) || '22896100972';
    const url = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 overflow-y-auto select-none animate-in fade-in duration-200">
      <div className="relative bg-gradient-to-br from-[#0A3DCE] via-[#082d99] to-[#051c61] rounded-3xl max-w-5xl w-full p-4 sm:p-8 shadow-2xl text-white my-auto max-h-[95vh] overflow-y-auto border-2 border-blue-400/30">
        {/* Bouton Fermer (SEULEMENT si non-bloquant) */}
        {!isBlocking && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 text-white flex items-center justify-center transition z-20 cursor-pointer shadow-md"
            title="Fermer"
          >
            <X className="w-6 h-6" />
          </button>
        )}

        {/* En-tête */}
        <div className="text-center max-w-2xl mx-auto space-y-2 pt-2 pb-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-amber-300 text-xs sm:text-sm font-black uppercase tracking-wider">
            {isBlocking ? <Lock className="w-4 h-4 text-amber-300" /> : <Sparkles className="w-4 h-4 text-amber-300" />}
            <span>{isBlocking ? 'Essai Gratuit Terminé' : 'Forfaits & Abonnements Officiels'}</span>
          </div>

          <h2 className="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
            {isBlocking
              ? '🔒 Votre essai gratuit de 21 jours est terminé'
              : 'Débloquez tout le potentiel de votre commerce'}
          </h2>

          <p className="text-blue-100 font-bold text-sm sm:text-base">
            {featureReason
              ? `Pour accéder à « ${featureReason} », choisissez un forfait adapté à votre activité :`
              : 'Choisissez un forfait pour continuer à vendre et sécuriser votre caisse :'}
          </p>

          {/* Toggle Mensuel / Annuel */}
          <div className="pt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedBilling('mensuel')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition ${
                selectedBilling === 'mensuel'
                  ? 'bg-white text-[#0A3DCE] shadow-md'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              Facturation Mensuelle
            </button>
            <button
              type="button"
              onClick={() => setSelectedBilling('annuel')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition flex items-center gap-1.5 ${
                selectedBilling === 'annuel'
                  ? 'bg-amber-400 text-amber-950 shadow-md ring-2 ring-amber-300'
                  : 'bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              <span>Facturation Annuelle</span>
              <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black uppercase">
                1 mois offert
              </span>
            </button>
          </div>
        </div>

        {/* 3 CARTES OFFRES */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 pt-4 pb-6 items-stretch">
          {/* CARTE 1 - ESSAI GRATUIT */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 text-gray-900 shadow-xl flex flex-col justify-between transition duration-200 hover:scale-[1.02] border-2 border-gray-200 opacity-90">
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-black uppercase tracking-wider text-gray-500">
                  Découverte
                </span>
                <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-xs font-black">
                  {currentStatus === 'expired' ? 'Actuel expiré' : 'Essai initial'}
                </span>
              </div>

              <h3 className="text-xl font-black text-gray-900">ESSAI GRATUIT</h3>
              <p className="text-xs font-bold text-gray-500 mt-0.5">Pour tester la caisse</p>

              {/* Prix */}
              <div className="my-5">
                <span className="text-3xl sm:text-4xl font-black text-gray-900">0 F</span>
                <span className="text-sm font-bold text-gray-500 ml-1">/ mois</span>
                <p className="text-xs font-bold text-gray-400 mt-1">Limité à 21 jours</p>
              </div>

              {/* Avantages */}
              <ul className="space-y-2.5 text-xs sm:text-sm font-bold text-gray-700">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>7 articles enregistrés</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>1 vendeur autorisé</span>
                </li>
                <li className="flex items-center gap-2 text-gray-400 line-through">
                  <X className="w-4 h-4 text-red-500 flex-shrink-0 stroke-[3]" />
                  <span>Pas de micro vocal illimité</span>
                </li>
                <li className="flex items-center gap-2 text-gray-400 line-through">
                  <X className="w-4 h-4 text-red-500 flex-shrink-0 stroke-[3]" />
                  <span>Pas de multi-boutique</span>
                </li>
              </ul>
            </div>

            <div className="pt-6">
              <button
                type="button"
                disabled
                className="w-full min-h-[48px] rounded-2xl bg-gray-200 text-gray-500 font-black text-sm flex items-center justify-center cursor-not-allowed"
              >
                {currentStatus === 'expired' ? 'Expiré' : 'Inclus à l\'inscription'}
              </button>
            </div>
          </div>

          {/* CARTE 2 - OFFRE POPULAIRE - TOP CHOIX (Mise en avant) */}
          <div className="relative bg-white rounded-3xl p-5 sm:p-6 text-gray-900 shadow-2xl flex flex-col justify-between transition duration-200 hover:scale-[1.03] border-[3px] border-[#FFD700] ring-4 ring-amber-300/40 md:-translate-y-2">
            {/* Badge Or flottant en haut */}
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r from-[#FFD700] via-[#FFC300] to-[#FFA500] text-blue-950 text-xs font-black px-4 py-1.5 rounded-full uppercase tracking-wider shadow-lg flex items-center gap-1.5 whitespace-nowrap">
              <Sparkles className="w-3.5 h-3.5" />
              <span>POPULAIRE • TOP CHOIX</span>
            </div>

            <div>
              <div className="flex justify-between items-center mb-3 pt-2">
                <span className="text-xs font-black uppercase tracking-wider text-[#0A3DCE]">
                  Commerce Actif
                </span>
                <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-black border border-amber-300">
                  RECOMMANDÉ
                </span>
              </div>

              <h3 className="text-2xl font-black text-gray-900">OFFRE POPULAIRE</h3>
              <p className="text-xs font-bold text-gray-500 mt-0.5">Idéal pour la majorité des boutiques</p>

              {/* Prix */}
              <div className="my-4">
                {selectedBilling === 'annuel' ? (
                  <div>
                    <span className="text-3xl sm:text-4xl font-black text-gray-900">16 500 F</span>
                    <span className="text-sm font-bold text-gray-500 ml-1">/ an</span>
                    <p className="text-xs font-bold text-gray-400 mt-0.5">Soit ~1 375 F / mois</p>
                  </div>
                ) : (
                  <div>
                    <span className="text-3xl sm:text-4xl font-black text-gray-900">1 500 F</span>
                    <span className="text-sm font-bold text-gray-500 ml-1">/ mois</span>
                    <p className="text-xs font-bold text-gray-400 mt-0.5">= 50 F / jour seulement</p>
                  </div>
                )}
              </div>

              {/* Phrase verte Promo 11 mois */}
              <div className="mb-4 bg-[#DCFCE7] text-[#166534] px-3 py-1.5 rounded-full text-xs font-black text-center flex items-center justify-center gap-1 shadow-sm">
                <span>✅ Payez 11 mois, 12ème OFFERT</span>
              </div>

              {/* Avantages */}
              <ul className="space-y-2.5 text-xs sm:text-sm font-bold text-gray-800">
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>100 articles au catalogue</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>3 vendeurs avec code PIN</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>3 appareils connectés (même compte sur 3 appareils)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Voix EFA</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Calcul de bénéfices & caisse</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Reçu de vente WhatsApp</span>
                </li>
              </ul>
            </div>

            <div className="pt-6">
              <button
                type="button"
                onClick={handleOpenWhatsApp}
                className="w-full min-h-[50px] rounded-2xl bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-white font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition cursor-pointer"
              >
                <MessageCircle className="w-5 h-5 flex-shrink-0" />
                <span>Payer via WhatsApp</span>
              </button>
            </div>
          </div>

          {/* CARTE 3 - BOUTIQUE PRO */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 text-gray-900 shadow-xl flex flex-col justify-between transition duration-200 hover:scale-[1.02] border-2 border-amber-300">
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-black uppercase tracking-wider text-amber-700">
                  Grande Équipe
                </span>
                <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-900 text-xs font-black flex items-center gap-1">
                  <Crown className="w-3.5 h-3.5 text-amber-600" />
                  <span>PREMIUM</span>
                </span>
              </div>

              <h3 className="text-2xl font-black text-gray-900">BOUTIQUE PRO</h3>
              <p className="text-xs font-bold text-gray-500 mt-0.5">Pour les commerces en pleine expansion</p>

              {/* Prix */}
              <div className="my-4">
                {selectedBilling === 'annuel' ? (
                  <div>
                    <span className="text-3xl sm:text-4xl font-black text-gray-900">90 000 F</span>
                    <span className="text-sm font-bold text-gray-500 ml-1">/ 1 an</span>
                    <p className="text-xs font-bold text-gray-400 mt-0.5">Offre annuelle complète 90.000 F</p>
                  </div>
                ) : (
                  <div>
                    <span className="text-3xl sm:text-4xl font-black text-gray-900">50 000 F</span>
                    <span className="text-sm font-bold text-gray-500 ml-1">/ 6 mois</span>
                    <p className="text-xs font-bold text-gray-400 mt-0.5">Ou 25.000 F (3 mois)</p>
                  </div>
                )}
              </div>

              {/* Phrase verte Promo 11 mois */}
              <div className="mb-4 bg-[#DCFCE7] text-[#166534] px-3 py-1.5 rounded-full text-xs font-black text-center flex items-center justify-center gap-1 shadow-sm">
                <span>✅ Activation instantanée par la Direction EFA</span>
              </div>

              {/* Avantages */}
              <ul className="space-y-2 text-xs sm:text-sm font-bold text-gray-800">
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>300 articles en stock</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>10 vendeurs avec code PIN</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>5 appareils connectés (même compte sur 5 appareils)</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Voix EFA + Micro</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Jusqu'à 3 boutiques distinctes</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Reçu + facture officielle PDF</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Export comptable avancé</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Support WhatsApp prioritaire</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Historique des ventes illimité</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 stroke-[3]" />
                  <span>Sauvegarde Cloud automatique & sécurisée</span>
                </li>
              </ul>
            </div>

            <div className="pt-6">
              <button
                type="button"
                onClick={handleOpenWhatsApp}
                className="w-full min-h-[50px] rounded-2xl bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-white font-black text-base flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/30 transition cursor-pointer"
              >
                <MessageCircle className="w-5 h-5 flex-shrink-0" />
                <span>Payer via WhatsApp</span>
              </button>
            </div>
          </div>
        </div>

        {/* GROS BOUTON WHATSAPP VERT OFFICIEL EN BAS DU MODAL */}
        <div className="pt-2 pb-2 text-center">
          <button
            type="button"
            onClick={handleOpenWhatsApp}
            className="w-full max-w-xl mx-auto min-h-[56px] px-6 py-4 rounded-2xl bg-[#25D366] hover:bg-[#20ba59] active:scale-95 text-white font-black text-base sm:text-lg flex items-center justify-center gap-3 shadow-xl shadow-emerald-900/40 transition cursor-pointer"
          >
            <MessageCircle className="w-6 h-6 flex-shrink-0 stroke-[2.5]" />
            <span>Payer via WhatsApp (+228 96 10 09 72)</span>
          </button>
          <p className="text-blue-200 text-xs font-bold mt-2">
            Paiement accepté : T-Money, Flooz, Wave, Carte bancaire • Activation manuelle par la Direction
          </p>
        </div>
      </div>
    </div>
  );
};
