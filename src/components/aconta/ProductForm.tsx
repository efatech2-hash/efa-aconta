import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Upload,
  RefreshCw,
  Sparkles,
  Lock,
} from 'lucide-react';
import { compressProductImage, normalizePlanForCompression, type ProductPlan } from '../../lib/productCompressor';
import { checkProductQuota, uploadProductImage, PRODUCT_STORAGE_BUCKET } from '../../lib/productStorage';
import { db } from '../../lib/db';
import { queueSyncItem } from '../../lib/sync';
import { logAction } from '../../lib/historique';
import { supabase } from '../../lib/supabase';
import type { Produit, Patron } from '../../lib/types';

interface ProductFormProps {
  patron: Patron;
  onSuccess?: (produit: Produit) => void;
  onCancel?: () => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

export const ProductForm: React.FC<ProductFormProps> = ({
  patron,
  onSuccess,
  onCancel,
  onOpenSubscriptionModal,
}) => {
  const [nom, setNom] = useState('');
  const [categorie, setCategorie] = useState('Général');
  const [prixAchat, setPrixAchat] = useState('');
  const [prixVente, setPrixVente] = useState('');
  const [stockQte, setStockQte] = useState('10');
  const [seuilAlerte, setSeuilAlerte] = useState(5);

  // Fichier sélectionné ou image
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [compressedInfo, setCompressedInfo] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'error' | 'success' | 'warning' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const userPlan: ProductPlan = normalizePlanForCompression(patron.subscription_status);

  // Quota initial
  const [quotaInfo, setQuotaInfo] = useState<{ count: number; max: number; percentage: number }>({
    count: 0,
    max: 7,
    percentage: 0,
  });

  useEffect(() => {
    checkProductQuota(patron.id, userPlan).then((res) => {
      setQuotaInfo({
        count: res.currentCount,
        max: res.maxLimit,
        percentage: res.percentage,
      });
    });
  }, [patron.id, userPlan]);

  const showToast = (message: string, type: 'error' | 'success' | 'warning' = 'error') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Sélection d'image avec compression immédiate WebP
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      // Compression WebP selon le plan
      const compressed = await compressProductImage(file, userPlan);
      setSelectedFile(compressed);

      const objectUrl = URL.createObjectURL(compressed);
      setPreviewUrl(objectUrl);

      const origKo = (file.size / 1024).toFixed(0);
      const newKo = (compressed.size / 1024).toFixed(0);
      setCompressedInfo(`WebP optimisé : ${origKo} Ko → ${newKo} Ko`);
    } catch (err: any) {
      console.error('Erreur compression image:', err);
      showToast("Erreur lors de la compression de l'image.", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nom.trim()) {
      showToast('Veuillez renseigner un nom pour le produit.');
      return;
    }
    const numVente = parseInt(prixVente, 10);
    const numAchat = parseInt(prixAchat, 10) || 0;
    const numQte = parseInt(stockQte, 10) || 1;

    if (isNaN(numVente) || numVente <= 0) {
      showToast('Veuillez renseigner un prix de vente valide.');
      return;
    }

    setIsLoading(true);

    try {
      // 1. VÉRIFICATION STRICTE DU QUOTA AVANT UPLOAD
      const quotaCheck = await checkProductQuota(patron.id, userPlan);
      if (!quotaCheck.allowed) {
        setIsLoading(false);
        showToast(quotaCheck.message || 'Limite de produits atteinte.', 'error');
        if (onOpenSubscriptionModal) {
          onOpenSubscriptionModal(userPlan === 'gratuit' ? 'populaire' : 'pro', quotaCheck.message);
        }
        return;
      }

      const produitId = 'prod-' + Date.now();
      let finalPhotoUrl = previewUrl || 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=600&q=80';

      // 2. UPLOAD DANS BUCKET efa-aconta-produits EN WEBP AVEC CHEMIN ${user_id}/${produit_id}.webp
      if (selectedFile) {
        const uploadedUrl = await uploadProductImage(selectedFile, patron.id, produitId, userPlan);
        if (uploadedUrl) {
          finalPhotoUrl = uploadedUrl;
        }
      }

      // 3. ENREGISTREMENT LOCAL & DISTANT
      const newProduit: Produit = {
        id: produitId,
        patron_id: patron.id,
        nom: nom.trim(),
        categorie: categorie.trim() || 'Général',
        prix_achat: numAchat,
        prix_vente: numVente,
        stock_qte: numQte,
        seuil_alerte: seuilAlerte,
        photo_url: finalPhotoUrl,
        created_at: new Date().toISOString(),
      };

      await db.produits.put(newProduit);
      await queueSyncItem('produits', 'insert', produitId, newProduit);

      // Synchro directe Supabase si connectée
      try {
        await supabase.from('aconta_produits').upsert([{
          id: produitId,
          user_id: patron.id,
          nom: newProduit.nom,
          categorie: newProduit.categorie,
          prix_vente: newProduit.prix_vente,
          prix_achat: newProduit.prix_achat,
          stock_qte: newProduit.stock_qte,
          photo_url: newProduit.photo_url,
          created_at: newProduit.created_at,
        }]);
      } catch (e) {
        // Fallback file sync
      }

      logAction({
        patron_id: patron.id,
        action_type: 'ajout_stock',
        description: `Ajout article ${newProduit.nom} (${numQte} unités à ${numVente}F)`,
        montant: numQte * numVente,
      }).catch(console.error);

      showToast(`Produit "${newProduit.nom}" enregistré avec succès !`, 'success');

      if (onSuccess) {
        onSuccess(newProduit);
      }
    } catch (err: any) {
      console.error('Erreur ajout produit:', err);
      showToast("Une erreur est survenue lors de l'enregistrement.", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-3xl p-6 shadow-xl border-2 border-gray-100 max-w-lg mx-auto relative select-none">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-2xl shadow-xl text-xs sm:text-sm font-black border flex items-center gap-2 ${
            toastMessage.type === 'error'
              ? 'bg-red-600 text-white border-red-700'
              : toastMessage.type === 'success'
              ? 'bg-emerald-600 text-white border-emerald-700'
              : 'bg-amber-500 text-slate-950 border-amber-600'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0" />
          ) : (
            <Check className="w-4 h-4 shrink-0" />
          )}
          <span>{toastMessage.message}</span>
        </div>
      )}

      {/* Barre de progression Quota dans le formulaire */}
      <div className="mb-5 p-3 rounded-2xl bg-gray-50 border border-gray-200">
        <div className="flex items-center justify-between text-xs font-bold mb-1">
          <span className="text-gray-600">Quota articles ({userPlan}) :</span>
          <span
            className={`font-black ${
              quotaInfo.percentage >= 100
                ? 'text-red-600'
                : quotaInfo.percentage >= 80
                ? 'text-amber-600'
                : 'text-emerald-700'
            }`}
          >
            {quotaInfo.count} / {quotaInfo.max} produits utilisés
          </span>
        </div>
        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              quotaInfo.percentage >= 100
                ? 'bg-red-600'
                : quotaInfo.percentage >= 80
                ? 'bg-amber-500'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${quotaInfo.percentage}%` }}
          />
        </div>
      </div>

      <h3 className="text-xl font-black text-gray-900 mb-4 flex items-center gap-2">
        <Sparkles className="w-5 h-5 text-[#6C5CE7]" />
        <span>Nouveau Produit</span>
      </h3>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Upload d'image avec compression automatique WebP */}
        <div className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50/70 hover:bg-gray-50 transition">
          {previewUrl ? (
            <div className="relative w-36 h-36 rounded-2xl overflow-hidden shadow-md border-2 border-purple-300 mb-2">
              <img src={previewUrl} alt="Aperçu" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/40 text-white font-bold text-xs flex items-center justify-center opacity-0 hover:opacity-100 transition"
              >
                Changer la photo
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer text-center py-4 px-6 flex flex-col items-center"
            >
              <div className="w-12 h-12 rounded-full bg-purple-100 text-[#6C5CE7] flex items-center justify-center mb-2">
                <Camera className="w-6 h-6" />
              </div>
              <span className="text-xs font-bold text-gray-700">
                Prendre une photo ou importer
              </span>
              <span className="text-[10px] text-gray-500 font-semibold mt-0.5">
                Conversion WebP automatique (&lt; 1 MB)
              </span>
            </div>
          )}

          {compressedInfo && (
            <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 mt-1">
              ✓ {compressedInfo}
            </span>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/webp,image/jpeg,image/png"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Nom du produit */}
        <div>
          <label className="block text-xs font-black uppercase text-gray-600 mb-1">
            Nom du produit *
          </label>
          <input
            type="text"
            required
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Ex: Robe Pagne Lomé"
            className="w-full p-3 rounded-2xl border-2 border-gray-200 focus:border-[#6C5CE7] focus:outline-none text-sm font-bold bg-white text-gray-900"
          />
        </div>

        {/* Prix d'Achat & Vente */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-black uppercase text-gray-600 mb-1">
              Prix d'achat (F)
            </label>
            <input
              type="number"
              min="0"
              value={prixAchat}
              onChange={(e) => setPrixAchat(e.target.value)}
              placeholder="0"
              className="w-full p-3 rounded-2xl border-2 border-gray-200 focus:border-[#6C5CE7] focus:outline-none text-sm font-bold bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-black uppercase text-gray-600 mb-1">
              Prix de vente (F) *
            </label>
            <input
              type="number"
              required
              min="1"
              value={prixVente}
              onChange={(e) => setPrixVente(e.target.value)}
              placeholder="Ex: 5000"
              className="w-full p-3 rounded-2xl border-2 border-gray-200 focus:border-[#6C5CE7] focus:outline-none text-sm font-bold bg-white text-gray-900"
            />
          </div>
        </div>

        {/* Quantité & Seuil alerte */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-black uppercase text-gray-600 mb-1">
              Quantité en stock
            </label>
            <input
              type="number"
              min="0"
              value={stockQte}
              onChange={(e) => setStockQte(e.target.value)}
              className="w-full p-3 rounded-2xl border-2 border-gray-200 focus:border-[#6C5CE7] focus:outline-none text-sm font-bold bg-white text-gray-900"
            />
          </div>
          <div>
            <label className="block text-xs font-black uppercase text-gray-600 mb-1">
              Seuil alerte
            </label>
            <input
              type="number"
              min="1"
              value={seuilAlerte}
              onChange={(e) => setSeuilAlerte(parseInt(e.target.value, 10) || 5)}
              className="w-full p-3 rounded-2xl border-2 border-gray-200 focus:border-[#6C5CE7] focus:outline-none text-sm font-bold bg-white text-gray-900"
            />
          </div>
        </div>

        {/* Boutons Action */}
        <div className="flex items-center gap-3 pt-3">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-3.5 rounded-2xl border-2 border-gray-200 hover:bg-gray-50 text-gray-700 font-bold text-sm transition"
            >
              Annuler
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading || quotaInfo.percentage >= 100}
            className={`flex-1 py-3.5 rounded-2xl font-black text-sm text-white shadow-md flex items-center justify-center gap-2 transition active:scale-95 ${
              quotaInfo.percentage >= 100
                ? 'bg-red-500 cursor-not-allowed opacity-75'
                : 'bg-[#6C5CE7] hover:bg-purple-700 cursor-pointer shadow-purple-500/25'
            }`}
          >
            {isLoading ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : quotaInfo.percentage >= 100 ? (
              <>
                <Lock className="w-4 h-4" />
                <span>Limite atteinte</span>
              </>
            ) : (
              <>
                <Check className="w-5 h-5 stroke-[2.5]" />
                <span>Enregistrer le produit</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
