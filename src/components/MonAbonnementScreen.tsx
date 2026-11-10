import React, { useState, useEffect } from 'react';
import {
  Crown,
  Sparkles,
  ArrowLeft,
  Check,
  Lock,
  Smartphone,
  Users,
  Package,
  Store,
  Calendar,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  Zap,
  MessageCircle,
} from 'lucide-react';
import type { Patron, SubscriptionStatus } from '../lib/types';
import { BoutonRetour } from './BoutonRetour';
import { getSubscriptionUsage, PLAN_CONFIGS } from '../lib/checkLimits';

interface MonAbonnementScreenProps {
  patron: Patron;
  onBack: () => void;
  onOpenSubscriptionModal: (plan?: 'populaire' | 'pro', reason?: string) => void;
  onRefreshPatron?: () => void;
}

export const MonAbonnementScreen: React.FC<MonAbonnementScreenProps> = ({
  patron,
  onBack,
  onOpenSubscriptionModal,
  onRefreshPatron,
}) => {
  const [usage, setUsage] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadUsageData = async () => {
    setIsLoading(true);
    try {
      const data = await getSubscriptionUsage(patron);
      setUsage(data);
    } catch (err) {
      console.error('Erreur chargement usage abonnement:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsageData();
  }, [patron]);

  const currentPlan: SubscriptionStatus = patron.subscription_status || 'trial';
  const planConfig = PLAN_CONFIGS[currentPlan] || PLAN_CONFIGS.trial;
  const isPro = currentPlan === 'pro';
  const isPopulaire = currentPlan === 'populaire';
  const isTrial = currentPlan === 'trial';

  const handleOpenWhatsAppPayment = () => {
    const nomClient = patron?.nom || 'Client';
    const nomBoutique = patron?.nom_boutique || 'Ma Boutique';
    const text = `Bonjour EFA TECH Aconta, je suis ${nomClient} boutique ${nomBoutique}, je veux payer mon abonnement`;
    const whatsappNum = (import.meta.env && import.meta.env.VITE_WHATSAPP_NUMBER) || '22896100972';
    const url = `https://wa.me/${whatsappNum}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6 pb-28 select-none relative pt-4">
      {/* Bouton Retour tactile mobile */}
      <BoutonRetour onBack={onBack} />

      {/* Header */}
      <div className="flex items-center justify-between pl-14 sm:pl-0">
        <div className="hidden sm:block">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Retour</span>
          </button>
        </div>

        <div>
          <h2 className="text-xl sm:text-2xl font-black text-gray-900 flex items-center gap-2">
            <Crown className="w-6 h-6 text-amber-500" />
            <span>MON ABONNEMENT & LIMITES</span>
          </h2>
          <p className="text-xs sm:text-sm font-semibold text-gray-500">
            Gestion du forfait, limites d'utilisation en temps réel
          </p>
        </div>
      </div>

      {toastMessage && (
        <div className="p-4 rounded-2xl bg-emerald-100 border-2 border-emerald-400 text-emerald-900 font-black text-center text-sm sm:text-base flex items-center justify-center gap-2 shadow-sm animate-in fade-in">
          <Check className="w-5 h-5 stroke-[3] text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* CARTE STATUT ACTUEL */}
      <div
        className={`rounded-3xl p-6 text-white shadow-xl relative overflow-hidden border-2 ${
          isPro
            ? 'bg-gradient-to-br from-amber-600 via-amber-700 to-yellow-800 border-amber-400'
            : isPopulaire
            ? 'bg-gradient-to-br from-[#0A53FF] via-[#083cb8] to-[#04217d] border-blue-400'
            : 'bg-gradient-to-br from-gray-700 via-gray-800 to-gray-900 border-gray-600'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/20 border border-white/30 text-xs font-black uppercase tracking-wider mb-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>Forfait Actuel</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-black tracking-tight">{planConfig.name}</h3>
            <p className="text-sm font-semibold text-white/80 mt-1 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-white/70" />
              <span>
                {patron.subscription_end_date
                  ? `Valide jusqu'au ${new Date(patron.subscription_end_date).toLocaleDateString('fr-FR')}`
                  : isTrial
                  ? `Essai gratuit en cours jusqu'au ${new Date(patron.trial_end_date || Date.now()).toLocaleDateString('fr-FR')}`
                  : 'Sans engagement'}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap sm:flex-col gap-2">
            <button
              type="button"
              onClick={() => onOpenSubscriptionModal('pro', 'Débloquer Boutique Pro')}
              className="px-5 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 active:scale-95 text-amber-950 font-black text-xs sm:text-sm shadow-lg transition cursor-pointer flex items-center gap-2"
            >
              <Zap className="w-4 h-4 text-amber-900" />
              <span>{isPro ? 'Gérer mon forfait' : 'Passer à Boutique Pro'}</span>
            </button>
            {!isPopulaire && !isPro && (
              <button
                type="button"
                onClick={() => onOpenSubscriptionModal('populaire', 'Activer le forfait Populaire')}
                className="px-5 py-3 rounded-2xl bg-white/20 hover:bg-white/30 active:scale-95 text-white font-black text-xs sm:text-sm border border-white/40 transition cursor-pointer flex items-center gap-2"
              >
                <span>Forfait Populaire (1 500 F)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* JAUGES D'USAGE EN TEMPS RÉEL (EX: 45/100 ARTICLES) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base sm:text-lg font-black text-gray-900">
            📊 Utilisation & Limites du forfait
          </h3>
          <button
            type="button"
            onClick={loadUsageData}
            disabled={isLoading}
            className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Actualiser</span>
          </button>
        </div>

        {usage && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 1. ARTICLES */}
            <div className="p-4 rounded-2xl bg-white border-2 border-gray-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black">
                    <Package className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-gray-800">Articles en stock</h4>
                    <p className="text-[11px] font-semibold text-gray-400">Catalogue de vente</p>
                  </div>
                </div>
                <span className="font-black text-base text-gray-900">
                  {usage.articles.used} / {usage.articles.max}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden border border-gray-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usage.articles.isLimitReached
                      ? 'bg-red-500'
                      : usage.articles.percent > 80
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                  }`}
                  style={{ width: `${usage.articles.percent}%` }}
                />
              </div>
              {usage.articles.isLimitReached && (
                <p className="text-xs font-bold text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Limite atteinte. Passez à Pro pour débloquer 300 articles.</span>
                </p>
              )}
            </div>

            {/* 2. VENDEURS */}
            <div className="p-4 rounded-2xl bg-white border-2 border-gray-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center font-black">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-gray-800">Vendeurs PIN</h4>
                    <p className="text-[11px] font-semibold text-gray-400">Comptes avec code PIN</p>
                  </div>
                </div>
                <span className="font-black text-base text-gray-900">
                  {usage.employes.used} / {usage.employes.max}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden border border-gray-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usage.employes.isLimitReached
                      ? 'bg-red-500'
                      : usage.employes.percent > 80
                      ? 'bg-amber-500'
                      : 'bg-purple-600'
                  }`}
                  style={{ width: `${usage.employes.percent}%` }}
                />
              </div>
              {usage.employes.isLimitReached && (
                <p className="text-xs font-bold text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Limite atteinte. Passez à Pro pour autoriser jusqu'à 10 vendeurs.</span>
                </p>
              )}
            </div>

            {/* 3. APPAREILS CONNECTÉS */}
            <div className="p-4 rounded-2xl bg-white border-2 border-gray-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-black">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-gray-800">Appareils connectés</h4>
                    <p className="text-[11px] font-semibold text-gray-400">Téléphones & tablettes</p>
                  </div>
                </div>
                <span className="font-black text-base text-gray-900">
                  {usage.appareils.used} / {usage.appareils.max}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden border border-gray-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usage.appareils.isLimitReached
                      ? 'bg-red-500'
                      : 'bg-teal-600'
                  }`}
                  style={{ width: `${usage.appareils.percent}%` }}
                />
              </div>
            </div>

            {/* 4. BOUTIQUES */}
            <div className="p-4 rounded-2xl bg-white border-2 border-gray-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-black">
                    <Store className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-black text-sm text-gray-800">Boutiques distinctes</h4>
                    <p className="text-[11px] font-semibold text-gray-400">Points de vente distincts</p>
                  </div>
                </div>
                <span className="font-black text-base text-gray-900">
                  {usage.boutiques.used} / {usage.boutiques.max}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden border border-gray-200">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    usage.boutiques.isLimitReached
                      ? 'bg-red-500'
                      : 'bg-amber-500'
                  }`}
                  style={{ width: `${usage.boutiques.percent}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* TABLEAU DES FONCTIONNALITÉS DÉBLOQUÉES vs BLOQUÉES SELON PLAN */}
      <div className="p-5 rounded-3xl bg-white border-2 border-gray-200 shadow-sm space-y-4">
        <h3 className="text-base sm:text-lg font-black text-gray-900">
          ✨ Détail des fonctionnalités de votre offre
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm font-bold">
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-800">
            <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            <span>Voix EFA : Synthèse vocale des ventes & alertes</span>
          </div>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-800">
            <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            <span>Calcul automatique du bénéfice & solde caisse</span>
          </div>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-800">
            <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            <span>Reçus de caisse WhatsApp instantanés</span>
          </div>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-gray-800">
            <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            <span>Sauvegarde sécurisée dans le Cloud</span>
          </div>

          {/* Micro Vocal */}
          <div
            className={`flex items-center gap-2 p-2.5 rounded-xl border ${
              isPro
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-gray-100 border-gray-200 text-gray-400'
            }`}
          >
            {isPro ? (
              <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            ) : (
              <Lock className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            <span>Micro vocal interactif (Commandes dictées) {isPro ? '✅' : '(Réservé Pro)'}</span>
          </div>

          {/* Facture PDF */}
          <div
            className={`flex items-center gap-2 p-2.5 rounded-xl border ${
              isPro || isTrial
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-gray-100 border-gray-200 text-gray-400'
            }`}
          >
            {isPro || isTrial ? (
              <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            ) : (
              <Lock className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            <span>Reçu & Facture officielle PDF téléchargeable {isPro ? '✅' : '(Réservé Pro)'}</span>
          </div>

          {/* Export comptable */}
          <div
            className={`flex items-center gap-2 p-2.5 rounded-xl border ${
              isPro
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-gray-100 border-gray-200 text-gray-400'
            }`}
          >
            {isPro ? (
              <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            ) : (
              <Lock className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            <span>Export comptable Excel / CSV avancé {isPro ? '✅' : '(Réservé Pro)'}</span>
          </div>

          {/* Support WhatsApp prioritaire */}
          <div
            className={`flex items-center gap-2 p-2.5 rounded-xl border ${
              isPro
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-gray-100 border-gray-200 text-gray-400'
            }`}
          >
            {isPro ? (
              <Check className="w-4 h-4 text-emerald-600 stroke-[3] shrink-0" />
            ) : (
              <Lock className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            <span>Support WhatsApp prioritaire 7j/7 {isPro ? '✅' : '(Réservé Pro)'}</span>
          </div>
        </div>
      </div>

      {/* PAIEMENT MANUEL VIA WHATSAPP */}
      <div className="p-5 sm:p-6 rounded-3xl bg-emerald-50 border-2 border-emerald-300 shadow-sm space-y-3">
        <div className="flex items-center gap-2.5 text-emerald-950">
          <div className="w-9 h-9 rounded-xl bg-[#25D366] text-white flex items-center justify-center shadow-xs">
            <MessageCircle className="w-5 h-5 fill-white stroke-none" />
          </div>
          <div>
            <h4 className="font-black text-sm sm:text-base text-emerald-950">
              Paiement Sécurisé & Activation Rapide
            </h4>
            <p className="text-[11px] font-bold text-emerald-700">
              Assistance EFA TECH & validation Mobile Money (T-Money, Flooz)
            </p>
          </div>
        </div>
        <p className="text-xs sm:text-sm font-semibold text-emerald-900 leading-relaxed">
          Pour renouveler ou débloquer votre abonnement (6 mois à 50 000 F CFA ou 1 an à 90 000 F CFA),
          contactez directement notre service commercial par WhatsApp pour activer votre compte.
        </p>

        <div className="pt-2">
          <button
            type="button"
            onClick={handleOpenWhatsAppPayment}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-[#25D366] hover:bg-[#20ba5a] active:scale-95 text-white font-black text-sm sm:text-base transition cursor-pointer shadow-md"
          >
            <MessageCircle className="w-5 h-5 fill-white stroke-none" />
            <span>Payer via WhatsApp</span>
          </button>
        </div>
      </div>
    </div>
  );
};
