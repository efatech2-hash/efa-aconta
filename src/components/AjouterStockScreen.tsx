import React, { useState } from 'react';
import {
  Camera,
  Image as ImageIcon,
  Sparkles,
  Check,
  Plus,
  Minus,
  ArrowLeft,
  TrendingUp,
  Package,
  RefreshCw,
  BellRing,
  Lock,
} from 'lucide-react';
import type { Patron, Produit } from '../lib/types';
import { db } from '../lib/db';
import { queueSyncItem } from '../lib/sync';
import { speakFrench } from '../lib/speech';
import { logAction } from '../lib/historique';
import { canAddArticle, getArticleLimitInfo } from '../lib/checkLimits';
import { checkProductQuota, uploadProductImage } from '../lib/productStorage';
import { normalizePlanForCompression, type ProductPlan } from '../lib/productCompressor';
import { supabase } from '../lib/supabase';
import {
  takePhotoFromCamera,
  pickPhotoFromGallery,
  pickPhotoInApp,
  persistFormState,
  restoreFormState,
  clearFormState,
} from '../lib/camera';

interface AjouterStockScreenProps {
  patron: Patron;
  products?: Produit[];
  onBack: () => void;
  onProductAdded: () => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

export const AjouterStockScreen: React.FC<AjouterStockScreenProps> = ({
  patron,
  products = [],
  onBack,
  onProductAdded,
  onOpenSubscriptionModal,
}) => {
  const [nom, setNom] = useState('');
  const [prixAchat, setPrixAchat] = useState('');
  const [prixVente, setPrixVente] = useState('');
  const [stockQte, setStockQte] = useState('10');
  const [seuilAlerte, setSeuilAlerte] = useState<number>(5); // Correction 2: seuil alerte par défaut 5
  const [photoUrl, setPhotoUrl] = useState<string>(
    'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=600&q=80'
  );

  // Correction 1: Génération 4 images EFA
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generationSeed, setGenerationSeed] = useState(Date.now());

  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Restauration automatique du formulaire si déchargé par l'OS Android
  React.useEffect(() => {
    const draft = restoreFormState<{
      nom?: string;
      prixAchat?: string;
      prixVente?: string;
      stockQte?: string;
      seuilAlerte?: number;
      photoUrl?: string;
    }>('ajouter_stock');

    if (draft) {
      if (draft.nom) setNom(draft.nom);
      if (draft.prixAchat) setPrixAchat(draft.prixAchat);
      if (draft.prixVente) setPrixVente(draft.prixVente);
      if (draft.stockQte) setStockQte(draft.stockQte);
      if (draft.seuilAlerte !== undefined) setSeuilAlerte(draft.seuilAlerte);
      if (draft.photoUrl) setPhotoUrl(draft.photoUrl);
    }
  }, []);

  // Marge auto calculée
  const numAchat = parseInt(prixAchat, 10) || 0;
  const numVente = parseInt(prixVente, 10) || 0;
  const marge = numVente - numAchat;
  const isLimitReached = !canAddArticle(patron, products.length);

  // Capture CAMÉRA in-app Capacitor
  const handleCamera = async () => {
    const currentForm = {
      nom,
      prixAchat,
      prixVente,
      stockQte,
      seuilAlerte,
      photoUrl,
    };
    const photo = await takePhotoFromCamera({
      formKey: 'ajouter_stock',
      formData: currentForm,
    });
    if (photo) {
      setPhotoUrl(photo);
      setGeneratedImages([]);
    }
  };

  // Sélection GALERIE in-app Capacitor
  const handleGallery = async () => {
    const currentForm = {
      nom,
      prixAchat,
      prixVente,
      stockQte,
      seuilAlerte,
      photoUrl,
    };
    const photo = await pickPhotoFromGallery({
      formKey: 'ajouter_stock',
      formData: currentForm,
    });
    if (photo) {
      setPhotoUrl(photo);
      setGeneratedImages([]);
    }
  };

  const handlePickPhoto = handleCamera;

  // Correction 1: Générer 4 images avec EFA via Pollinations API
  const handleGenerateImages = (seedOffset = 0) => {
    if (!nom.trim()) {
      setFeedback("Tape d'abord le nom du produit (ex: Robe wax rouge)");
      speakFrench("Indique d'abord le nom du produit pour que je puisse générer les photos");
      return;
    }

    setIsGenerating(true);
    setFeedback(null);
    const newSeed = Date.now() + seedOffset;
    setGenerationSeed(newSeed);

    const promptText = `${nom.trim()} product photo white background e-commerce professional studio lighting`;
    const encodedPrompt = encodeURIComponent(promptText);

    // 4 variations de seed
    const variations = [
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=500&height=500&nologo=true&seed=${newSeed + 1}`,
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=500&height=500&nologo=true&seed=${newSeed + 2}`,
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=500&height=500&nologo=true&seed=${newSeed + 3}`,
      `https://image.pollinations.ai/prompt/${encodedPrompt}?width=500&height=500&nologo=true&seed=${newSeed + 4}`,
    ];

    setGeneratedImages(variations);
    speakFrench('Voici 4 propositions photos créées par EFA. Choisis celle qui te plaît !');
    setIsGenerating(false);
  };

  const handleSelectGeneratedImage = (url: string) => {
    setPhotoUrl(url);
    setGeneratedImages([]);
    speakFrench('Photo sélectionnée pour le produit !');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nom.trim()) {
      setFeedback('Donne un nom au produit.');
      return;
    }
    if (numVente <= 0) {
      setFeedback('Indique le prix de vente.');
      return;
    }

    // GARDE-FOU STRICT : Vérification quota articles avant upload (7 en gratuit, 100 en payant, 300 en pro)
    const userPlan = normalizePlanForCompression(patron.subscription_status);
    const quotaCheck = await checkProductQuota(patron.id, userPlan);
    if (!quotaCheck.allowed) {
      setFeedback(quotaCheck.message || 'Limite de produits atteinte.');
      speakFrench(quotaCheck.message || 'Limite atteinte');
      if (onOpenSubscriptionModal) {
        onOpenSubscriptionModal(userPlan === 'gratuit' ? 'populaire' : 'pro', quotaCheck.message);
      }
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    const prodId = 'prod-' + Date.now();
    let finalPhotoUrl = photoUrl;

    // Upload WebP compressé vers bucket 'efa-aconta-produits' avec chemin ${user_id}/${produit_id}.webp
    if (photoUrl) {
      try {
        const uploaded = await uploadProductImage(photoUrl, patron.id, prodId, userPlan);
        if (uploaded) finalPhotoUrl = uploaded;
      } catch (uploadErr) {
        console.warn('[AjouterStock] Erreur upload image, conservation locale:', uploadErr);
      }
    }

    const newProduit: Produit = {
      id: prodId,
      patron_id: patron.id,
      nom: nom.trim(),
      photo_url: finalPhotoUrl,
      prix_achat: numAchat,
      prix_vente: numVente,
      stock_qte: parseInt(stockQte, 10) || 1,
      seuil_alerte: seuilAlerte,
      created_at: new Date().toISOString(),
    };

    try {
      await db.produits.put(newProduit);
      await queueSyncItem('produits', 'insert', prodId, newProduit);

      // Synchro directe Supabase aconta_produits
      try {
        await supabase.from('aconta_produits').upsert([{
          id: prodId,
          user_id: patron.id,
          nom: newProduit.nom,
          prix_vente: newProduit.prix_vente,
          prix_achat: newProduit.prix_achat,
          stock_qte: newProduit.stock_qte,
          photo_url: newProduit.photo_url,
          created_at: newProduit.created_at,
        }]);
      } catch {}

      // MODIF 1: Log historique ajout stock
      logAction({
        patron_id: patron.id,
        action_type: 'ajout_stock',
        description: `Ajout nouveau produit ${newProduit.nom} (${newProduit.stock_qte} unités à ${newProduit.prix_vente}F)`,
        montant: newProduit.stock_qte * newProduit.prix_vente,
      }).catch(console.error);

      speakFrench(`Produit ${newProduit.nom} ajouté avec succès au stock !`);
      setFeedback(`Produit "${newProduit.nom}" ajouté avec succès !`);

      clearFormState('ajouter_stock');
      setNom('');
      setPrixAchat('');
      setPrixVente('');
      setStockQte('10');
      setSeuilAlerte(5);

      setTimeout(() => {
        onProductAdded();
      }, 900);
    } catch (err) {
      console.error('Erreur ajout stock:', err);
      setFeedback("Erreur lors de l'enregistrement.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-28 select-none">
      {/* Header avec retour */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Retour</span>
        </button>

        <h2 className="text-2xl font-black text-gray-900">
          AJOUTER UN PRODUIT
        </h2>
      </div>

      {feedback && (
        <div className="p-4 rounded-2xl bg-amber-100 border-2 border-amber-400 text-amber-900 font-black text-center text-lg flex items-center justify-center gap-2">
          <span>{feedback}</span>
        </div>
      )}

      {/* Bannière Limite Articles Atteinte */}
      {isLimitReached && (
        <div className="p-4 sm:p-5 rounded-3xl bg-amber-50 border-2 border-amber-300 text-amber-950 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-200 text-amber-900 flex items-center justify-center font-black shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-black text-sm sm:text-base">
                Limite d'articles atteinte pour votre forfait ({products.length} articles)
              </h4>
              <p className="text-xs font-semibold text-amber-800">
                Passez à Boutique Pro pour débloquer jusqu'à 300 articles en stock !
              </p>
            </div>
          </div>
          {onOpenSubscriptionModal && (
            <button
              type="button"
              onClick={() => onOpenSubscriptionModal('pro', 'Débloquer jusqu\'à 300 articles')}
              className="px-4 py-2 rounded-xl bg-[#0A53FF] hover:bg-blue-700 active:scale-95 text-white font-black text-xs shadow-md transition cursor-pointer shrink-0"
            >
              Passer à Pro (300 articles) 👑
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-6 border-2 border-gray-200 shadow-sm space-y-6">
        {/* Nom du produit en premier pour permettre la génération photo */}
        <div>
          <label className="block text-base font-black text-gray-800 mb-1 flex items-center gap-2">
            <Package className="w-5 h-5 text-[#E17055]" />
            1. Nom de l'article :
          </label>
          <input
            type="text"
            required
            placeholder="Ex : Robe wax rouge, Chemise coton, Sandales..."
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            className="w-full text-xl font-bold p-4 rounded-2xl border-2 border-gray-300 focus:border-[#E17055] focus:outline-none bg-gray-50 text-gray-900"
          />
        </div>

        {/* CORRECTION 1 : 3 OPTIONS PHOTO EN LIGNE */}
        <div>
          <label className="block text-base font-black text-gray-800 mb-2">
            2. Photo du produit (3 options faciles) :
          </label>

          <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
            <div className="relative w-32 h-32 rounded-2xl overflow-hidden border-4 border-[#E17055] shadow-md flex-shrink-0 bg-gray-100">
              <img
                src={photoUrl}
                alt="Aperçu produit"
                className="w-full h-full object-cover"
              />
            </div>

            <div className="w-full space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {/* Bouton 1 : Caméra */}
                <button
                  type="button"
                  onClick={handleCamera}
                  className="min-h-[52px] p-3 rounded-2xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer text-center transition touch-manipulation border border-teal-500/20"
                >
                  <Camera className="w-4 h-4 stroke-[2.5]" />
                  <span>Caméra</span>
                </button>

                {/* Bouton 2 : Galerie */}
                <button
                  type="button"
                  onClick={handleGallery}
                  className="min-h-[52px] p-3 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm cursor-pointer text-center transition touch-manipulation border border-indigo-500/20"
                >
                  <ImageIcon className="w-4 h-4 stroke-[2.5]" />
                  <span>Galerie</span>
                </button>
              </div>

              {/* Option IA : GÉNÉRER AVEC EFA ✨ */}
              <button
                type="button"
                onClick={() => handleGenerateImages(0)}
                disabled={isGenerating}
                className="w-full min-h-[46px] p-2.5 rounded-2xl bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow text-center transition touch-manipulation"
              >
                <Sparkles className="w-4 h-4 stroke-[2.5]" />
                <span>GÉNÉRER AVEC EFA ✨</span>
              </button>
            </div>
          </div>

          {/* Grille 2x2 des 4 images générées par EFA */}
          {generatedImages.length > 0 && (
            <div className="p-4 rounded-3xl bg-purple-50 border-2 border-purple-300 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-sm font-black text-purple-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#6C5CE7]" />
                  4 photos générées par EFA pour "{nom}" :
                </span>
                <button
                  type="button"
                  onClick={() => handleGenerateImages(100)}
                  className="px-3 py-1.5 rounded-xl bg-purple-200 hover:bg-purple-300 text-purple-900 text-xs font-black flex items-center gap-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Régénérer 4 autres</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {generatedImages.map((imgUrl, idx) => (
                  <div
                    key={idx}
                    className="bg-white rounded-2xl p-2 border-2 border-purple-200 flex flex-col items-center gap-2 shadow-sm"
                  >
                    <div className="w-full aspect-square rounded-xl overflow-hidden bg-gray-100">
                      <img
                        src={imgUrl}
                        alt={`Proposition ${idx + 1}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectGeneratedImage(imgUrl)}
                      className="w-full py-2 px-3 rounded-xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-1 shadow"
                    >
                      <Check className="w-4 h-4 stroke-[3]" />
                      <span>CHOISIR</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Prix achat & Prix vente */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-800 mb-1">
              Prix d'achat (F CFA) :
            </label>
            <input
              type="number"
              min={0}
              placeholder="Ex : 3000"
              value={prixAchat}
              onChange={(e) => setPrixAchat(e.target.value)}
              className="w-full text-2xl font-black p-4 rounded-2xl border-2 border-gray-300 focus:border-[#E17055] focus:outline-none bg-gray-50 text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-black text-gray-800 mb-1">
              Prix de vente (F CFA) :
            </label>
            <input
              type="number"
              required
              min={1}
              placeholder="Ex : 5000"
              value={prixVente}
              onChange={(e) => setPrixVente(e.target.value)}
              className="w-full text-2xl font-black p-4 rounded-2xl border-2 border-[#00B894] focus:outline-none bg-emerald-50/40 text-emerald-900"
            />
          </div>
        </div>

        {/* Stock initial & CORRECTION 2 : SEUIL ALERTE BAS AJUSTABLE */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-black text-gray-800 mb-1">
              Quantité en stock reçue :
            </label>
            <input
              type="number"
              min={1}
              required
              value={stockQte}
              onChange={(e) => setStockQte(e.target.value)}
              className="w-full text-2xl font-black p-4 rounded-2xl border-2 border-gray-300 focus:border-[#E17055] focus:outline-none bg-gray-50 text-gray-900"
            />
          </div>

          <div>
            <label className="block text-sm font-black text-gray-800 mb-1 flex items-center gap-1.5">
              <BellRing className="w-4 h-4 text-red-500" />
              <span>Seuil alerte stock bas :</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSeuilAlerte((s) => Math.max(1, s - 1))}
                className="w-12 h-14 rounded-2xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-black text-xl flex items-center justify-center active:scale-95"
              >
                <Minus className="w-5 h-5 stroke-[3]" />
              </button>
              <div className="flex-1 text-center bg-red-50 border-2 border-red-300 rounded-2xl h-14 flex items-center justify-center">
                <span className="text-2xl font-black text-red-700">{seuilAlerte}</span>
                <span className="text-xs font-bold text-red-500 ml-1.5">unités</span>
              </div>
              <button
                type="button"
                onClick={() => setSeuilAlerte((s) => s + 1)}
                className="w-12 h-14 rounded-2xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-black text-xl flex items-center justify-center active:scale-95"
              >
                <Plus className="w-5 h-5 stroke-[3]" />
              </button>
            </div>
            <p className="text-[11px] font-bold text-gray-400 mt-1">
              Alerte rouge clignotante quand il reste {seuilAlerte} pièce(s) ou moins.
            </p>
          </div>
        </div>

        {/* MARGE AUTO CALCULÉE VERTE */}
        {numVente > 0 && (
          <div className="p-4 rounded-2xl bg-emerald-50 border-2 border-emerald-400 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-[#00B894]" />
              <span className="text-base font-black text-emerald-900">
                BÉNÉFICE PAR PIÈCE :
              </span>
            </div>
            <span
              className={`text-2xl font-black ${
                marge >= 0 ? 'text-[#00B894]' : 'text-red-600'
              }`}
            >
              {marge >= 0 ? `+${marge.toLocaleString('fr-FR')} F` : `${marge.toLocaleString('fr-FR')} F`}
            </span>
          </div>
        )}

        {/* BOUTON ENREGISTRER PRODUIT GÉANT ORANGE */}
        <button
          type="submit"
          disabled={isLoading || isLimitReached}
          className={`w-full min-h-[85px] py-4 px-6 rounded-2xl font-black text-xl sm:text-2xl flex items-center justify-center gap-3 shadow-xl transition border-2 mt-4 cursor-pointer ${
            isLimitReached
              ? 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed opacity-80'
              : 'bg-[#E17055] hover:bg-orange-600 active:scale-95 text-white shadow-orange-500/25 border-orange-500'
          }`}
        >
          {isLimitReached ? (
            <>
              <Lock className="w-7 h-7 stroke-[2.5]" />
              <span>LIMITE ATTEINTE (PASSER À PRO)</span>
            </>
          ) : (
            <>
              <Plus className="w-8 h-8 stroke-[3]" />
              <span>{isLoading ? 'ENREGISTREMENT...' : 'ENREGISTRER LE PRODUIT'}</span>
            </>
          )}
        </button>
      </form>
    </div>
  );
};
