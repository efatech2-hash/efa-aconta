import React, { useState } from 'react';
import {
  ArrowLeft,
  Pencil,
  Plus,
  Minus,
  Trash2,
  Package,
  AlertTriangle,
  Check,
  Camera,
  Image as ImageIcon,
  Sparkles,
  TrendingUp,
  Tag,
  DollarSign,
  Layers,
  BellRing,
  Lock,
} from 'lucide-react';
import type { Patron, Produit } from '../lib/types';
import { db } from '../lib/db';
import { queueSyncItem } from '../lib/sync';
import { speakFrench } from '../lib/speech';
import { logAction } from '../lib/historique';
import { canAddArticle, getArticleLimitInfo } from '../lib/checkLimits';
import {
  isProActive,
  getMainStoreId,
  getTotalArticleCount,
  canAddArticlePro,
  PRO_MAX_ARTICLES,
} from '../lib/mesBoutiques';
import { BoutonRetour } from './BoutonRetour';
import { deleteProductWithStorageCleanup } from '../lib/productDelete';
import { checkProductQuota, uploadProductImage, PLAN_LIMITS } from '../lib/productStorage';
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

interface StockScreenProps {
  patron: Patron;
  products: Produit[];
  onBack: () => void;
  onRefresh: () => void;
  onOpenAddProduct?: () => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

export const StockScreen: React.FC<StockScreenProps> = ({
  patron,
  products,
  onBack,
  onRefresh,
  onOpenSubscriptionModal,
}) => {
  // Modal Édition
  const [editingProduct, setEditingProduct] = useState<Produit | null>(null);
  const [editNom, setEditNom] = useState('');
  const [editCategorie, setEditCategorie] = useState('');
  const [editPrixAchat, setEditPrixAchat] = useState('');
  const [editPrixVente, setEditPrixVente] = useState('');
  const [editStockQte, setEditStockQte] = useState('');
  const [editSeuilAlerte, setEditSeuilAlerte] = useState<number>(5);
  const [editPhotoUrl, setEditPhotoUrl] = useState('');

  // Modal Confirmation Suppression
  const [productToDelete, setProductToDelete] = useState<Produit | null>(null);

  // Modal Ajout Nouveau Produit
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newNom, setNewNom] = useState('');
  const [newCategorie, setNewCategorie] = useState('Vêtements');
  const [newPrixAchat, setNewPrixAchat] = useState('');
  const [newPrixVente, setNewPrixVente] = useState('');
  const [newStockQte, setNewStockQte] = useState('10');
  const [newSeuilAlerte, setNewSeuilAlerte] = useState(5);
  const [newPhotoUrl, setNewPhotoUrl] = useState(
    'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=600&q=80'
  );

  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // LOGIQUE DES 300 ARTICLES PARTAGÉS (PRO) & QUOTA STOCKAGE
  const isPro = isProActive(patron);
  const mainStoreId = getMainStoreId(patron);
  const [totalArticlesPro, setTotalArticlesPro] = useState<number>(products.length);
  const userPlan: ProductPlan = normalizePlanForCompression(patron.subscription_status);
  const maxArticlesPlan = isPro ? 300 : PLAN_LIMITS[userPlan] || 7;
  const currentTotalArticles = isPro ? totalArticlesPro : products.length;
  const quotaPercent = Math.min(100, Math.round((currentTotalArticles / maxArticlesPlan) * 100));

  React.useEffect(() => {
    if (isPro) {
      getTotalArticleCount(mainStoreId).then((cnt) => {
        setTotalArticlesPro(cnt);
      });
    } else {
      setTotalArticlesPro(products.length);
    }
  }, [patron, products, isPro, mainStoreId]);

  // Séparation stock bas et stock normal
  const stockBasProducts = products.filter((p) => {
    const seuil = p.seuil_alerte ?? 5;
    return p.stock_qte <= seuil;
  });

  const stockNormalProducts = products.filter((p) => {
    const seuil = p.seuil_alerte ?? 5;
    return p.stock_qte > seuil;
  });

  // Ouvrir la modal d'édition
  const handleOpenEdit = (p: Produit) => {
    setEditingProduct(p);
    setEditNom(p.nom);
    setEditCategorie(p.categorie || 'Général');
    setEditPrixAchat(p.prix_achat.toString());
    setEditPrixVente(p.prix_vente.toString());
    setEditStockQte(p.stock_qte.toString());
    setEditSeuilAlerte(p.seuil_alerte ?? 5);
    setEditPhotoUrl(p.photo_url || '');

    // Restauration d'un brouillon d'édition si l'OS avait déchargé la vue
    const draft = restoreFormState<any>(`edit_product_${p.id}`);
    if (draft) {
      if (draft.nom) setEditNom(draft.nom);
      if (draft.categorie) setEditCategorie(draft.categorie);
      if (draft.prix_achat) setEditPrixAchat(draft.prix_achat);
      if (draft.prix_vente) setEditPrixVente(draft.prix_vente);
      if (draft.stock_qte) setEditStockQte(draft.stock_qte);
      if (draft.seuil_alerte !== undefined) setEditSeuilAlerte(draft.seuil_alerte);
      if (draft.photo_url) setEditPhotoUrl(draft.photo_url);
    }
  };

  // Capture CAMÉRA in-app Capacitor pour l'édition de produit
  const handleCameraEditPhoto = async () => {
    const formData = {
      productId: editingProduct?.id,
      nom: editNom,
      categorie: editCategorie,
      prix_achat: editPrixAchat,
      prix_vente: editPrixVente,
      stock_qte: editStockQte,
      seuil_alerte: editSeuilAlerte,
      photo_url: editPhotoUrl,
    };
    const photo = await takePhotoFromCamera({
      formKey: `edit_product_${editingProduct?.id || 'active'}`,
      formData,
    });
    if (photo) {
      setEditPhotoUrl(photo);
    }
  };

  // Sélection GALERIE in-app Capacitor pour l'édition de produit
  const handleGalleryEditPhoto = async () => {
    const formData = {
      productId: editingProduct?.id,
      nom: editNom,
      categorie: editCategorie,
      prix_achat: editPrixAchat,
      prix_vente: editPrixVente,
      stock_qte: editStockQte,
      seuil_alerte: editSeuilAlerte,
      photo_url: editPhotoUrl,
    };
    const photo = await pickPhotoFromGallery({
      formKey: `edit_product_${editingProduct?.id || 'active'}`,
      formData,
    });
    if (photo) {
      setEditPhotoUrl(photo);
    }
  };

  const handlePickEditPhoto = handleCameraEditPhoto;

  // Capture CAMÉRA in-app Capacitor pour nouvel article rapide
  const handleCameraNewPhoto = async () => {
    const formData = {
      nom: newNom,
      categorie: newCategorie,
      prix_achat: newPrixAchat,
      prix_vente: newPrixVente,
      stock_qte: newStockQte,
      seuil_alerte: newSeuilAlerte,
      photo_url: newPhotoUrl,
    };
    const photo = await takePhotoFromCamera({
      formKey: 'quick_add_product',
      formData,
    });
    if (photo) {
      setNewPhotoUrl(photo);
    }
  };

  // Sélection GALERIE in-app Capacitor pour nouvel article rapide
  const handleGalleryNewPhoto = async () => {
    const formData = {
      nom: newNom,
      categorie: newCategorie,
      prix_achat: newPrixAchat,
      prix_vente: newPrixVente,
      stock_qte: newStockQte,
      seuil_alerte: newSeuilAlerte,
      photo_url: newPhotoUrl,
    };
    const photo = await pickPhotoFromGallery({
      formKey: 'quick_add_product',
      formData,
    });
    if (photo) {
      setNewPhotoUrl(photo);
    }
  };

  const handlePickNewPhoto = handleCameraNewPhoto;

  // Réajustement direct de la quantité depuis la carte (+/-)
  const handleQuickAdjustQte = async (p: Produit, delta: number) => {
    const newQte = Math.max(0, p.stock_qte + delta);
    try {
      await db.produits.update(p.id, { stock_qte: newQte });
      await queueSyncItem('produits', 'update', p.id, { stock_qte: newQte });

      // MODIF 1: Log historique modif stock
      logAction({
        patron_id: patron.id,
        action_type: 'modif_stock',
        description: `Ajustement rapide stock ${p.nom} (${delta > 0 ? '+' : ''}${delta}, nouvelle qté: ${newQte})`,
      }).catch(console.error);

      onRefresh();
      if (delta > 0) {
        speakFrench(`+1 pour ${p.nom}. Reste ${newQte}.`);
      } else {
        speakFrench(`-1 pour ${p.nom}. Reste ${newQte}.`);
      }
    } catch (err) {
      console.error('Erreur ajustement stock:', err);
    }
  };

  // Enregistrer les modifications de l'article (Bouton Enregistrer bleu)
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    const numVente = parseInt(editPrixVente, 10);
    const numAchat = parseInt(editPrixAchat, 10) || 0;
    const numQte = parseInt(editStockQte, 10);

    if (isNaN(numVente) || numVente <= 0) {
      alert('Prix de vente invalide');
      return;
    }
    if (isNaN(numQte) || numQte < 0) {
      alert('Quantité invalide');
      return;
    }

    setIsSaving(true);
    try {
      const updatedFields: Partial<Produit> = {
        nom: editNom.trim(),
        categorie: editCategorie.trim() || 'Général',
        prix_vente: numVente,
        prix_achat: numAchat,
        stock_qte: numQte,
        seuil_alerte: editSeuilAlerte,
        photo_url: editPhotoUrl,
      };

      await db.produits.update(editingProduct.id, updatedFields);
      await queueSyncItem('produits', 'update', editingProduct.id, updatedFields);

      // MODIF 1: Log historique modif stock
      logAction({
        patron_id: patron.id,
        action_type: 'modif_stock',
        description: `Modification article ${editNom.trim()} (Prix: ${numVente}F, Stock: ${numQte})`,
        montant: numVente,
      }).catch(console.error);

      speakFrench(`Article ${editNom} mis à jour avec succès.`);
      setFeedback(`Article "${editNom}" modifié avec succès !`);
      if (editingProduct) {
        clearFormState(`edit_product_${editingProduct.id}`);
      }
      setEditingProduct(null);
      onRefresh();
    } catch (err) {
      console.error('Erreur update produit:', err);
      alert('Erreur lors de la mise à jour.');
    } finally {
      setIsSaving(false);
    }
  };

  // Confirmer suppression de l'article (Bouton Supprimer rouge outline)
  const handleConfirmDelete = async () => {
    if (!productToDelete) return;
    try {
      // 1. Suppression préalable de l'image dans Supabase Storage 'efa-aconta-produits' puis DB
      await deleteProductWithStorageCleanup({
        userId: patron.id,
        produitId: productToDelete.id,
        nomProduit: productToDelete.nom,
        stockQte: productToDelete.stock_qte,
        photoUrl: productToDelete.photo_url,
      });

      speakFrench(`Article ${productToDelete.nom} supprimé du stock.`);
      setFeedback(`Article "${productToDelete.nom}" supprimé du stock.`);
      setProductToDelete(null);
      setEditingProduct(null);
      onRefresh();
    } catch (err) {
      console.error('Erreur suppression produit:', err);
      alert('Erreur lors de la suppression.');
    }
  };

  // Enregistrer un nouveau produit
  const handleSaveNewProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNom.trim()) return;

    // 1. VÉRIFICATION STRICTE QUOTA AVANT UPLOAD
    const userPlan = normalizePlanForCompression(patron.subscription_status);
    const quotaCheck = await checkProductQuota(patron.id, userPlan);
    if (!quotaCheck.allowed) {
      alert(quotaCheck.message || 'Limite de produits atteinte.');
      if (onOpenSubscriptionModal) {
        onOpenSubscriptionModal(userPlan === 'gratuit' ? 'populaire' : 'pro', quotaCheck.message);
      }
      return;
    }

    // RÈGLE D'OR : totalArticlesToutesBoutiques <= 300 pour Pro
    if (isPro) {
      const check = await canAddArticlePro(mainStoreId);
      if (!check.allowed) {
        alert("Limite Pro atteinte : 300 articles pour toutes tes boutiques réunies. Supprime un article ou passe en Premium.");
        return;
      }
    }

    const numVente = parseInt(newPrixVente, 10);
    const numAchat = parseInt(newPrixAchat, 10) || 0;
    const numQte = parseInt(newStockQte, 10) || 0;

    if (isNaN(numVente) || numVente <= 0) {
      alert('Prix de vente requis');
      return;
    }

    setIsSaving(true);
    try {
      const prodId = 'prod-' + Date.now();
      let finalPhoto = newPhotoUrl || '';

      // 2. Upload WebP compressé dans le bucket 'efa-aconta-produits' avec chemin ${user_id}/${produit_id}.webp
      if (newPhotoUrl) {
        const uploaded = await uploadProductImage(newPhotoUrl, patron.id, prodId, userPlan);
        if (uploaded) finalPhoto = uploaded;
      }

      const newProd: Produit = {
        id: prodId,
        patron_id: patron.id,
        nom: newNom.trim(),
        categorie: newCategorie.trim() || 'Général',
        prix_vente: numVente,
        prix_achat: numAchat,
        stock_qte: numQte,
        seuil_alerte: newSeuilAlerte,
        photo_url: finalPhoto,
        created_at: new Date().toISOString(),
      };

      await db.produits.put(newProd);
      await queueSyncItem('produits', 'insert', newProd.id, newProd);

      // Synchro distante vers Supabase aconta_produits
      try {
        await supabase.from('aconta_produits').upsert([{
          id: prodId,
          user_id: patron.id,
          nom: newProd.nom,
          categorie: newProd.categorie,
          prix_vente: newProd.prix_vente,
          prix_achat: newProd.prix_achat,
          stock_qte: newProd.stock_qte,
          photo_url: newProd.photo_url,
          created_at: newProd.created_at,
        }]);
      } catch (syncErr) {
        // En cas d'indisponibilité, la file de synchro prend le relai
      }

      // Log historique ajout stock
      logAction({
        patron_id: patron.id,
        action_type: 'ajout_stock',
        description: `Ajout article ${newProd.nom} (${numQte} unités à ${numVente}F)`,
        montant: numQte * numVente,
      }).catch(console.error);

      speakFrench(`Article ${newProd.nom} ajouté au stock.`);
      setFeedback(`Article "${newProd.nom}" ajouté avec succès !`);
      clearFormState('quick_add_product');
      setIsAddingNew(false);
      setNewNom('');
      setNewPrixAchat('');
      setNewPrixVente('');
      setNewStockQte('10');
      setNewPhotoUrl('');
      onRefresh();
    } catch (err) {
      console.error('Erreur ajout produit:', err);
    } finally {
      setIsSaving(false);
    }
  };

  // Rendu d'une carte produit avec le bouton Modifier rouge #EF4444 et boutons +/-
  const renderProductCard = (p: Produit, isBas: boolean) => {
    const seuil = p.seuil_alerte ?? 5;
    const marge = p.prix_vente - p.prix_achat;

    return (
      <div
        key={p.id}
        className={`bg-white rounded-3xl border-2 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between ${
          isBas
            ? 'border-red-400 ring-2 ring-red-100'
            : 'border-gray-200'
        }`}
      >
        {/* Conteneur Image avec bouton Modifier rouge #EF4444 */}
        <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
          <img
            src={p.photo_url || 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=600&q=80'}
            alt={p.nom}
            className="w-full h-full object-cover"
          />

          {/* Badge statut stock en haut à gauche */}
          <div className="absolute top-2 left-2 z-10">
            {p.stock_qte <= 0 ? (
              <span className="px-2.5 py-1 rounded-full bg-red-600 text-white font-black text-xs shadow">
                RUPTURE
              </span>
            ) : isBas ? (
              <span className="px-2.5 py-1 rounded-full bg-amber-500 text-white font-black text-xs shadow flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                STOCK BAS ({p.stock_qte})
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-emerald-600 text-white font-black text-xs shadow">
                {p.stock_qte} en stock
              </span>
            )}
          </div>

          {/* CORRECTION 5 : BOUTON ROND ROUGE #EF4444 ANGLE HAUT DROIT AVEC ICÔNE CRAYON ✏️ */}
          <button
            type="button"
            onClick={() => handleOpenEdit(p)}
            style={{
              position: 'absolute',
              top: '8px',
              right: '8px',
              zIndex: 10,
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: '#EF4444',
            }}
            className="text-white flex items-center justify-center shadow-lg hover:bg-red-600 active:scale-90 transition cursor-pointer border-2 border-white"
            title="Modifier l'article"
          >
            <Pencil className="w-4 h-4 stroke-[2.5]" />
          </button>

          {/* Prix de vente en bas de l'image */}
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
            <span className="px-2.5 py-1 rounded-xl bg-black/75 backdrop-blur-sm text-white font-black text-sm">
              {p.prix_vente.toLocaleString('fr-FR')} F
            </span>
            {p.categorie && (
              <span className="px-2 py-0.5 rounded-lg bg-white/90 text-gray-800 font-bold text-[10px] uppercase">
                {p.categorie}
              </span>
            )}
          </div>
        </div>

        {/* Détails & Réajustement direct de quantité */}
        <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
          <div>
            <h4 className="font-black text-base text-gray-900 line-clamp-1">
              {p.nom}
            </h4>
            <div className="flex items-center justify-between text-xs font-bold text-gray-500 mt-0.5">
              <span>Achat: {p.prix_achat.toLocaleString('fr-FR')} F</span>
              <span className={marge >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                Marge: +{marge.toLocaleString('fr-FR')} F
              </span>
            </div>
          </div>

          {/* Réajustement direct +/- depuis la carte */}
          <div className="flex items-center justify-between gap-1 w-full mt-2 px-1.5 py-1 bg-gray-50 rounded-lg min-w-0">
            <span className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase truncate">
              <span className="hidden sm:inline">QUANTITÉ :</span>
              <span className="sm:hidden">QTÉ:</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleQuickAdjustQte(p, -1)}
                className="w-7 h-7 flex items-center justify-center bg-white border border-gray-300 rounded-full font-black text-sm active:scale-90 transition cursor-pointer hover:bg-gray-100"
                title="Diminuer d'une unité (-1)"
              >
                −
              </button>
              <span className={`w-5 text-center font-black text-sm ${isBas ? 'text-red-600' : 'text-gray-900'}`}>
                {p.stock_qte}
              </span>
              <button
                type="button"
                onClick={() => handleQuickAdjustQte(p, 1)}
                className="w-7 h-7 flex items-center justify-center bg-white border border-gray-300 rounded-full font-black text-sm active:scale-90 transition cursor-pointer hover:bg-gray-100"
                title="Augmenter d'une unité (+1)"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-28 select-none relative pt-2">
      {/* CORRECTION 3: Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onBack} />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 pl-14 sm:pl-0">
        <button
          type="button"
          onClick={onBack}
          className="btn hidden sm:inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] rounded-2xl bg-gray-200 hover:bg-gray-300 font-bold text-gray-800 transition"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Retour</span>
        </button>

        <h2 className="text-xl sm:text-2xl font-black text-gray-900 text-right">
          GESTION DU STOCK
        </h2>
      </div>

      {feedback && (
        <div className="p-4 rounded-2xl bg-emerald-100 border-2 border-emerald-400 text-emerald-800 font-black text-center text-base flex items-center justify-center gap-2 animate-in fade-in">
          <Check className="w-5 h-5 stroke-[3]" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Barre d'action rapide & Statistiques */}
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 rounded-3xl p-6 text-white shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-black uppercase tracking-wider text-emerald-200">
            Inventaire Boutique
          </span>
          <h3 className="text-2xl sm:text-3xl font-black">
            {products.length} Articles en catalogue
          </h3>

          {/* QUOTA UTILISÉ AVEC BARRE DE PROGRESSION (Anti-saturation Stockage) */}
          <div className="mt-3 space-y-2 w-full max-w-sm">
            <div className="flex items-center justify-between text-xs font-black">
              <span className="flex items-center gap-1.5 text-emerald-100">
                <Package className="w-3.5 h-3.5 text-amber-300" />
                <span>{currentTotalArticles} / {maxArticlesPlan} produits utilisés</span>
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                  quotaPercent >= 100
                    ? 'bg-red-500 text-white animate-pulse'
                    : quotaPercent >= 80
                    ? 'bg-amber-400 text-amber-950'
                    : 'bg-emerald-500/50 text-white'
                }`}
              >
                {quotaPercent}%
              </span>
            </div>

            {/* Barre de progression : verte si <80%, orange si >=80%, rouge si 100% */}
            <div className="w-full bg-black/25 rounded-full h-3 overflow-hidden p-0.5 border border-white/20">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  quotaPercent >= 100
                    ? 'bg-red-500'
                    : quotaPercent >= 80
                    ? 'bg-amber-400'
                    : 'bg-emerald-300'
                }`}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>

            {/* Si 100% utilisé, bouton "Augmenter mon plan" */}
            {quotaPercent >= 100 && (
              <div className="pt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenSubscriptionModal?.(userPlan === 'gratuit' ? 'populaire' : 'pro', 'Limite de produits atteinte')}
                  className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs inline-flex items-center gap-1.5 shadow-md active:scale-95 transition cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 fill-amber-600" />
                  <span>Augmenter mon plan</span>
                </button>
              </div>
            )}

            {isPro && (
              <p className="text-[11px] font-bold text-emerald-100">
                Quota partagé sur toutes tes boutiques réunies.
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={async () => {
            if (isPro) {
              const check = await canAddArticlePro(mainStoreId);
              if (!check.allowed) {
                alert("Limite Pro atteinte : 300 articles pour toutes tes boutiques réunies. Supprime un article ou passe en Premium.");
                return;
              }
              setIsAddingNew(true);
              return;
            }
            if (!canAddArticle(patron, products.length)) {
              if (onOpenSubscriptionModal) {
                onOpenSubscriptionModal('populaire', `Limite d'articles atteinte (${products.length} articles)`);
              }
              return;
            }
            setIsAddingNew(true);
          }}
          className={`btn min-h-[50px] px-6 py-3 rounded-2xl font-black text-base inline-flex items-center justify-center gap-2 shadow-lg transition active:scale-95 cursor-pointer ${
            (isPro ? totalArticlesPro < 300 : canAddArticle(patron, products.length))
              ? 'bg-white hover:bg-emerald-50 text-emerald-800'
              : 'bg-amber-100 hover:bg-amber-200 text-amber-950 border-2 border-amber-300 ring-2 ring-amber-400 opacity-90'
          }`}
        >
          {(isPro ? totalArticlesPro < 300 : canAddArticle(patron, products.length)) ? (
            <>
              <Plus className="w-6 h-6 stroke-[3] text-emerald-600" />
              <span>+ AJOUTER UN ARTICLE</span>
            </>
          ) : (
            <>
              <Lock className="w-5 h-5 text-amber-700" />
              <span>+ AJOUTER ARTICLE</span>
              <span className="bg-amber-400 text-amber-950 text-[10px] px-2 py-0.5 rounded-full font-black uppercase shadow-sm">
                PRO
              </span>
            </>
          )}
        </button>
      </div>

      {/* AFFICHAGE DU STOCK OU MESSAGE VIDE */}
      {products.length === 0 ? (
        <div className="min-h-[50vh] flex flex-col items-center justify-center text-center p-6 sm:p-12 bg-emerald-50/50 border-2 border-dashed border-emerald-300 rounded-3xl my-6 space-y-4 animate-in fade-in">
          <Package className="w-16 h-16 text-emerald-400 mx-auto" />
          <button
            type="button"
            onClick={async () => {
              if (isPro) {
                const check = await canAddArticlePro(mainStoreId);
                if (!check.allowed) {
                  alert("Limite Pro atteinte : 300 articles pour toutes tes boutiques réunies. Supprime un article ou passe en Premium.");
                  return;
                }
                setIsAddingNew(true);
                return;
              }
              if (!canAddArticle(patron, products.length)) {
                if (onOpenSubscriptionModal) {
                  onOpenSubscriptionModal('populaire', `Limite d'articles atteinte (${products.length} articles)`);
                }
                return;
              }
              setIsAddingNew(true);
            }}
            className="text-xl sm:text-2xl md:text-3xl font-black text-[#10B981] hover:underline cursor-pointer transition p-2 max-w-2xl leading-relaxed focus:outline-none"
          >
            📦 Aucun article en stock. Cliquez ici pour enregistrer votre premier article →
          </button>
        </div>
      ) : (
        <>
          {/* SECTION 1 : STOCK BAS (SI PRÉSENT) */}
          {stockBasProducts.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-full bg-red-500 animate-ping" />
                <h3 className="text-lg sm:text-xl font-black text-red-600 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <span>STOCK BAS & ALERTES ({stockBasProducts.length})</span>
                </h3>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
                {stockBasProducts.map((p) => renderProductCard(p, true))}
              </div>
            </div>
          )}

          {/* SECTION 2 : STOCK NORMAL */}
          <div className="space-y-3">
            <h3 className="text-lg sm:text-xl font-black text-gray-900 flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              <span>STOCK NORMAL ({stockNormalProducts.length})</span>
            </h3>

            {stockNormalProducts.length === 0 ? (
              <div className="text-center py-8 p-4 bg-gray-50 rounded-2xl border border-gray-200">
                <p className="text-sm font-bold text-gray-500">
                  Tous les articles actuels sont en alerte stock bas.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
                {stockNormalProducts.map((p) => renderProductCard(p, false))}
              </div>
            )}
          </div>
        </>
      )}

      {/* MODAL ÉDITION ARTICLE (CORRECTION 5) */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-[#0984E3] space-y-5 my-8 max-h-[90vh] overflow-y-auto">
            {/* Titre Modal */}
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-blue-100 text-[#0984E3] flex items-center justify-center">
                  <Pencil className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-gray-900">
                    MODIFIER L'ARTICLE
                  </h3>
                  <p className="text-xs font-bold text-gray-500">
                    Mets à jour les informations ou supprime du stock
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingProduct(null)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              {/* Nom du produit */}
              <div>
                <label className="block text-sm font-black text-gray-800 mb-1">
                  Nom de l'article :
                </label>
                <input
                  type="text"
                  required
                  value={editNom}
                  onChange={(e) => setEditNom(e.target.value)}
                  className="w-full text-lg font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-[#0984E3] focus:outline-none bg-gray-50 text-gray-900"
                />
              </div>

              {/* Catégorie */}
              <div>
                <label className="block text-sm font-black text-gray-800 mb-1 flex items-center gap-1.5">
                  <Tag className="w-4 h-4 text-gray-500" />
                  <span>Catégorie :</span>
                </label>
                <input
                  type="text"
                  placeholder="Ex: Robes, Chaussures, Sacs, Bijoux..."
                  value={editCategorie}
                  onChange={(e) => setEditCategorie(e.target.value)}
                  className="w-full text-base font-bold p-3 rounded-2xl border-2 border-gray-300 focus:border-[#0984E3] focus:outline-none bg-gray-50 text-gray-900"
                />
              </div>

              {/* Quantité & Seuil alerte */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-black text-gray-800 mb-1">
                    Quantité en stock :
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={editStockQte}
                    onChange={(e) => setEditStockQte(e.target.value)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-[#0984E3] focus:outline-none bg-gray-50 text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-black text-gray-800 mb-1 flex items-center gap-1">
                    <BellRing className="w-4 h-4 text-red-500" />
                    <span>Seuil alerte stock bas :</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={editSeuilAlerte}
                    onChange={(e) => setEditSeuilAlerte(parseInt(e.target.value, 10) || 1)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-red-400 focus:outline-none bg-gray-50 text-gray-900"
                  />
                </div>
              </div>

              {/* Prix Achat & Prix Vente */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-black text-gray-800 mb-1">
                    Prix d'achat (F CFA) :
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editPrixAchat}
                    onChange={(e) => setEditPrixAchat(e.target.value)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-gray-500 focus:outline-none bg-gray-50 text-gray-900"
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
                    value={editPrixVente}
                    onChange={(e) => setEditPrixVente(e.target.value)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-[#00B894] focus:outline-none bg-emerald-50/40 text-emerald-950"
                  />
                </div>
              </div>

              {/* Photo & Upload */}
              <div>
                <label className="block text-sm font-black text-gray-800 mb-2 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-gray-600" />
                  <span>Photo de l'article :</span>
                </label>
                <div className="space-y-3">
                  {editPhotoUrl && (
                    <div className="flex items-center gap-3">
                      <img
                        src={editPhotoUrl}
                        alt="Aperçu"
                        className="w-20 h-20 rounded-2xl object-cover border-2 border-gray-300 shadow-sm flex-shrink-0"
                      />
                      <span className="text-xs font-bold text-gray-500">Photo actuelle</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCameraEditPhoto}
                      className="min-h-[48px] bg-teal-600 hover:bg-teal-700 active:scale-95 text-white p-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer shadow-sm transition touch-manipulation border border-teal-500/20"
                    >
                      <Camera className="w-4 h-4 stroke-[2.5]" />
                      <span>Caméra</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleGalleryEditPhoto}
                      className="min-h-[48px] bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-white p-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer shadow-sm transition touch-manipulation border border-indigo-500/20"
                    >
                      <ImageIcon className="w-4 h-4 stroke-[2.5]" />
                      <span>Galerie</span>
                    </button>
                  </div>
                  {editPhotoUrl && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setEditPhotoUrl('')}
                        className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-2xl text-xs font-bold border border-red-200 transition active:scale-95 cursor-pointer touch-manipulation"
                      >
                        Retirer la photo
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* 2 BOUTONS DU BAS : ENREGISTRER (bleu) & SUPPRIMER ARTICLE (rouge outline) */}
              <div className="pt-4 border-t border-gray-200 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* 1. Bouton Enregistrer (bleu) */}
                <button
                  type="submit"
                  disabled={isSaving}
                  className="btn min-h-[56px] px-6 py-3 rounded-2xl bg-[#0984E3] hover:bg-blue-600 active:scale-95 text-white font-black text-lg inline-flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 transition"
                >
                  <Check className="w-6 h-6 stroke-[3]" />
                  <span>{isSaving ? 'ENREGISTREMENT...' : 'ENREGISTRER'}</span>
                </button>

                {/* 2. Bouton Supprimer article (rouge outline avec confirm) */}
                <button
                  type="button"
                  onClick={() => setProductToDelete(editingProduct)}
                  className="btn min-h-[56px] px-6 py-3 rounded-2xl border-2 border-[#EF4444] text-[#EF4444] hover:bg-red-50 active:scale-95 font-black text-base inline-flex items-center justify-center gap-2 transition"
                >
                  <Trash2 className="w-5 h-5 stroke-[2.5]" />
                  <span>SUPPRIMER ARTICLE</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CONFIRMATION SUPPRESSION ARTICLE */}
      {productToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-red-500 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 mx-auto flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 stroke-[2.5]" />
            </div>

            <h3 className="text-2xl font-black text-gray-900">
              SUPPRIMER CET ARTICLE ?
            </h3>

            <p className="text-sm font-bold text-gray-600">
              Vraiment supprimer <strong>"{productToDelete.nom}"</strong> du stock ? Cette action est irréversible.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setProductToDelete(null)}
                className="btn min-h-[50px] p-3 rounded-2xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-black text-sm"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={handleConfirmDelete}
                className="btn min-h-[50px] p-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-sm shadow-md"
              >
                Oui, Supprimer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL AJOUT RAPIDE NOUVEL ARTICLE */}
      {isAddingNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in overflow-y-auto">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl border-4 border-emerald-500 space-y-5 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
                  <Plus className="w-6 h-6 stroke-[3]" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-gray-900">
                    NOUVEL ARTICLE AU STOCK
                  </h3>
                  <p className="text-xs font-bold text-gray-500">
                    Enregistre un produit avec photo et prix
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddingNew(false)}
                className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveNewProduct} className="space-y-4">
              <div>
                <label className="block text-sm font-black text-gray-800 mb-1">
                  Nom du produit :
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex : Robe Wax Rouge, Sandales..."
                  value={newNom}
                  onChange={(e) => setNewNom(e.target.value)}
                  className="w-full text-lg font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-emerald-500 focus:outline-none bg-gray-50 text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-black text-gray-800 mb-1">
                  Catégorie :
                </label>
                <input
                  type="text"
                  placeholder="Ex : Vêtements, Chaussures, Cosmétiques..."
                  value={newCategorie}
                  onChange={(e) => setNewCategorie(e.target.value)}
                  className="w-full text-base font-bold p-3 rounded-2xl border-2 border-gray-300 focus:border-emerald-500 focus:outline-none bg-gray-50 text-gray-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-black text-gray-800 mb-1">
                    Prix d'achat (F CFA) :
                  </label>
                  <input
                    type="number"
                    min={0}
                    placeholder="Ex : 3000"
                    value={newPrixAchat}
                    onChange={(e) => setNewPrixAchat(e.target.value)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-emerald-500 focus:outline-none bg-gray-50 text-gray-900"
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
                    value={newPrixVente}
                    onChange={(e) => setNewPrixVente(e.target.value)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-[#00B894] focus:outline-none bg-emerald-50/40 text-emerald-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-black text-gray-800 mb-1">
                    Quantité reçue :
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={newStockQte}
                    onChange={(e) => setNewStockQte(e.target.value)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-emerald-500 focus:outline-none bg-gray-50 text-gray-900"
                  />
                </div>

                <div>
                  <label className="block text-sm font-black text-gray-800 mb-1 flex items-center gap-1">
                    <BellRing className="w-4 h-4 text-red-500" />
                    <span>Seuil alerte stock bas :</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newSeuilAlerte}
                    onChange={(e) => setNewSeuilAlerte(parseInt(e.target.value, 10) || 1)}
                    className="w-full text-xl font-black p-3.5 rounded-2xl border-2 border-gray-300 focus:border-red-400 focus:outline-none bg-gray-50 text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-black text-gray-800 mb-2 flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-gray-600" />
                  <span>Photo du produit :</span>
                </label>
                <div className="space-y-3">
                  {newPhotoUrl && (
                    <div className="flex items-center gap-3">
                      <img
                        src={newPhotoUrl}
                        alt="Aperçu"
                        className="w-20 h-20 rounded-2xl object-cover border-2 border-emerald-400 shadow-sm flex-shrink-0"
                      />
                      <span className="text-xs font-bold text-emerald-700">Photo sélectionnée</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleCameraNewPhoto}
                      className="min-h-[48px] bg-teal-600 hover:bg-teal-700 active:scale-95 text-white p-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer shadow-sm transition touch-manipulation border border-teal-500/20"
                    >
                      <Camera className="w-4 h-4 stroke-[2.5]" />
                      <span>Caméra</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleGalleryNewPhoto}
                      className="min-h-[48px] bg-[#6C5CE7] hover:bg-[#5b4bc4] active:scale-95 text-white p-3 rounded-2xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer shadow-sm transition touch-manipulation border border-indigo-500/20"
                    >
                      <ImageIcon className="w-4 h-4 stroke-[2.5]" />
                      <span>Galerie</span>
                    </button>
                  </div>
                  {newPhotoUrl && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setNewPhotoUrl('')}
                        className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-2xl text-xs font-bold border border-red-200 transition active:scale-95 cursor-pointer touch-manipulation"
                      >
                        Retirer la photo
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="btn w-full min-h-[60px] px-6 py-3 rounded-2xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-xl inline-flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition"
                >
                  <Plus className="w-6 h-6 stroke-[3]" />
                  <span>{isSaving ? 'ENREGISTREMENT...' : 'ENREGISTRER AU STOCK'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
