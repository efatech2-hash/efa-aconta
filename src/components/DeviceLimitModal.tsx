import React from 'react';
import { Smartphone, AlertTriangle, ArrowRight, X, MessageCircle, Crown, Shield } from 'lucide-react';
import type { EfaDeviceRecord } from '../lib/deviceAuth';

interface DeviceLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: string;
  activeCount: number;
  maxAllowed: number;
  activeDevices?: EfaDeviceRecord[];
  onUpgrade?: (targetPlan: 'populaire' | 'pro') => void;
  onDisconnectDevice?: (deviceId: string) => Promise<void>;
}

export const DeviceLimitModal: React.FC<DeviceLimitModalProps> = ({
  isOpen,
  onClose,
  plan,
  activeCount,
  maxAllowed,
  activeDevices = [],
  onUpgrade,
  onDisconnectDevice,
}) => {
  if (!isOpen) return null;

  const planLabel = plan === 'pro' ? 'Boutique Pro' : plan === 'populaire' ? 'Populaire' : 'Essai';
  const whatsappUrl = `https://wa.me/22896100972?text=${encodeURIComponent(
    `Bonjour EFA, j'ai atteint la limite d'appareils (${maxAllowed} max) pour ma boutique et je souhaite passer à un forfait supérieur.`
  )}`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border-4 border-amber-400 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center font-black">
              <Smartphone className="w-6 h-6 stroke-[2.5]" />
            </div>
            <div>
              <span className="text-[11px] font-black uppercase text-amber-600 tracking-wider">
                Multi-Appareils
              </span>
              <h3 className="text-xl font-black text-gray-900 leading-tight">
                Limite d'appareils atteinte
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Explication claire */}
        <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-200 space-y-2">
          <div className="flex items-center gap-2 text-amber-900 font-black text-sm">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>
              Plan {planLabel} = {maxAllowed} appareil{maxAllowed > 1 ? 's' : ''} connecté{maxAllowed > 1 ? 's' : ''}
            </span>
          </div>
          <p className="text-xs sm:text-sm font-semibold text-amber-900/90 leading-relaxed">
            Votre boutique utilise déjà {activeCount} appareil{activeCount > 1 ? 's' : ''} sur les {maxAllowed} autorisé{maxAllowed > 1 ? 's' : ''}.
            Pour connecter ce nouveau téléphone ou tablette, passez à l'offre supérieure.
          </p>
        </div>

        {/* Offres pour débloquer plus d'appareils */}
        <div className="space-y-3">
          <h4 className="text-xs font-black uppercase tracking-wider text-gray-500">
            Augmenter la limite d'appareils :
          </h4>

          {plan !== 'populaire' && plan !== 'pro' && (
            <div className="p-4 rounded-2xl bg-blue-50 border-2 border-blue-300 flex items-center justify-between gap-3 shadow-xs">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-black uppercase mb-1">
                  Recommandé
                </div>
                <h5 className="font-black text-base text-blue-950">Forfait Populaire</h5>
                <p className="text-xs font-bold text-blue-800">
                  📱 Jusqu'à <strong>3 appareils</strong> connectés • 3 vendeurs
                </p>
                <div className="text-xs font-black text-[#0A53FF] mt-0.5">1 500 F CFA / mois</div>
              </div>
              {onUpgrade ? (
                <button
                  type="button"
                  onClick={() => onUpgrade('populaire')}
                  className="px-4 py-2.5 rounded-xl bg-[#0A53FF] hover:bg-blue-700 active:scale-95 text-white font-black text-xs shadow-md shrink-0 flex items-center gap-1"
                >
                  <span>Choisir</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>
          )}

          {plan !== 'pro' && (
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 flex items-center justify-between gap-3 shadow-xs">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500 text-amber-950 text-[10px] font-black uppercase mb-1">
                  <Crown className="w-3 h-3" />
                  <span>Illimité</span>
                </div>
                <h5 className="font-black text-base text-amber-950">Boutique PRO</h5>
                <p className="text-xs font-bold text-amber-900">
                  📱 Jusqu'à <strong>5 appareils</strong> connectés • 10 vendeurs
                </p>
                <div className="text-xs font-black text-amber-900 mt-0.5">4 999 F CFA / mois</div>
              </div>
              {onUpgrade ? (
                <button
                  type="button"
                  onClick={() => onUpgrade('pro')}
                  className="px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-amber-950 font-black text-xs shadow-md shrink-0 flex items-center gap-1"
                >
                  <span>Choisir</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* Bouton Support WhatsApp */}
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-3.5 px-4 rounded-2xl bg-[#25D366] hover:bg-emerald-600 active:scale-95 text-white font-black text-sm flex items-center justify-center gap-2 shadow-lg transition text-center"
        >
          <MessageCircle className="w-5 h-5 fill-white text-[#25D366]" />
          <span>Contacter le Support WhatsApp pour débloquer</span>
        </a>

        {/* Option de déconnecter un ancien appareil */}
        {activeDevices.length > 0 && onDisconnectDevice && (
          <div className="pt-2 border-t border-gray-100 space-y-2">
            <p className="text-xs font-bold text-gray-500">
              Ou libérez un slot en déconnectant un ancien appareil :
            </p>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {activeDevices.map((dev) => (
                <div
                  key={dev.id || dev.device_id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 border border-gray-200 text-xs"
                >
                  <div>
                    <span className="font-black text-gray-800">{dev.device_name}</span>
                    <span className="text-[10px] text-gray-400 block">
                      Actif : {new Date(dev.last_seen).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDisconnectDevice(dev.device_id)}
                    className="px-2.5 py-1 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 font-black text-[11px] transition cursor-pointer"
                  >
                    Déconnecter
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs"
        >
          Fermer
        </button>
      </div>
    </div>
  );
};
