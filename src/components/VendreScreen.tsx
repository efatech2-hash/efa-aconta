import React, { useState, useEffect } from 'react';
import {
  ShoppingBag,
  ShoppingCart,
  Check,
  Plus,
  Minus,
  Trash2,
  User,
  CreditCard,
  ArrowLeft,
  AlertTriangle,
  AlertCircle,
  FileText,
  Share2,
  Download,
  Sparkles,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import type { Produit, Patron, VenteItem, CurrentUser } from '../lib/types';
import { db } from '../lib/db';
import { queueSyncItem } from '../lib/sync';
import { speakFrench } from '../lib/speech';
import { getAccord } from '../lib/accord';
import { VocalInput } from './VocalInput';
import { logAction } from '../lib/historique';
import { BoutonRetour } from './BoutonRetour';
import { isBoutiquePro } from '../lib/checkLimits';

interface VendreScreenProps {
  patron: Patron;
  currentUser: CurrentUser;
  products: Produit[];
  onBack: () => void;
  onSaleCompleted: () => void;
  onGoToStock?: () => void;
  onOpenSubscriptionModal?: (plan?: 'populaire' | 'pro', reason?: string) => void;
}

interface CartItem extends VenteItem {
  stockMax: number;
}

export const VendreScreen: React.FC<VendreScreenProps> = ({
  patron,
  currentUser,
  products,
  onBack,
  onSaleCompleted,
  onGoToStock,
  onOpenSubscriptionModal,
}) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientNom, setClientNom] = useState<string>('');
  const [estCredit, setEstCredit] = useState<boolean>(false);
  const [resteAPayer, setResteAPayer] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isBlockedUser, setIsBlockedUser] = useState<boolean>(false);

  // Vérification si employé bloqué ou supprimé
  useEffect(() => {
    if (currentUser.role !== 'patron') {
      db.employes.get(currentUser.id).then((emp) => {
        if (emp && (emp.is_blocked || emp.status === 'blocked' || emp.is_active === false || emp.is_deleted || emp.status === 'deleted')) {
          setIsBlockedUser(true);
        }
      }).catch(console.error);
    }
  }, [currentUser.id, currentUser.role]);

  const accord = getAccord(currentUser.genre);

  // Filtrage des produits par recherche manuelle ou vocale
  const filteredProducts = products.filter((p) =>
    p.nom.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  // Traitement retour de la recherche vocale
  const handleVoiceSearchResult = (transcript: string) => {
    const term = transcript.trim().toLowerCase();
    const matching = products.filter((p) =>
      p.nom.toLowerCase().includes(term)
    );
    if (matching.length === 1) {
      speakFrench(`Produit ${matching[0].nom} trouvé`);
    } else if (matching.length > 1) {
      speakFrench(`${matching.length} produits trouvés`);
    } else {
      speakFrench(`Aucun produit trouvé pour ${transcript}`);
    }
  };
  const [generatedTicket, setGeneratedTicket] = useState<{
    ticketId: string;
    pdfBlobUrl: string;
    pdfDoc: jsPDF;
    clientNom: string;
    total: number;
    items: CartItem[];
    dateStr: string;
    estCredit: boolean;
    reste: number;
  } | null>(null);

  // Ajout d'un produit au panier
  const handleAddToCart = (prod: Produit) => {
    if (prod.stock_qte <= 0) {
      speakFrench('Attention, ce produit est en rupture de stock.');
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.produit_id === prod.id);
      if (existing) {
        if (existing.qte >= prod.stock_qte) {
          speakFrench('Quantité maximale en stock atteinte.');
          return prev;
        }
        return prev.map((item) =>
          item.produit_id === prod.id
            ? {
                ...item,
                qte: item.qte + 1,
                sous_total: (item.qte + 1) * item.prix_unitaire_negocie,
              }
            : item
        );
      } else {
        return [
          ...prev,
          {
            id: 'item-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
            produit_id: prod.id,
            produit_nom: prod.nom,
            qte: 1,
            prix_unitaire_negocie: prod.prix_vente, // Négociable par défaut au prix catalogue
            sous_total: prod.prix_vente,
            stockMax: prod.stock_qte,
          },
        ];
      }
    });

    speakFrench(`${prod.nom} ajouté au panier`);
  };

  // Mise à jour de quantité
  const handleUpdateQty = (produitId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.produit_id === produitId) {
            const newQte = Math.max(1, Math.min(item.stockMax, item.qte + delta));
            return {
              ...item,
              qte: newQte,
              sous_total: newQte * item.prix_unitaire_negocie,
            };
          }
          return item;
        })
        .filter((item) => item.qte > 0)
    );
  };

  // NÉGOCIATION DE PRIX : modification libre du prix unitaire
  const handleUpdatePrice = (produitId: string, newPriceStr: string) => {
    const newPrice = Math.max(0, parseInt(newPriceStr, 10) || 0);
    setCart((prev) =>
      prev.map((item) => {
        if (item.produit_id === produitId) {
          return {
            ...item,
            prix_unitaire_negocie: newPrice,
            sous_total: item.qte * newPrice,
          };
        }
        return item;
      })
    );
  };

  const handleRemoveItem = (produitId: string) => {
    setCart((prev) => prev.filter((item) => item.produit_id !== produitId));
  };

  // Total général panier
  const totalGeneral = cart.reduce((sum, item) => sum + item.sous_total, 0);

  // Génération du Ticket PDF avec jsPDF
  const generateTicketPDF = (ticketId: string, isCreditSale: boolean, reste: number): { pdfDoc: jsPDF; pdfBlobUrl: string } => {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, 160], // Format Ticket de caisse 80mm
    });

    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }) + ' ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    // En-tête
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(patron.nom_boutique || 'MA BOUTIQUE', 40, 10, { align: 'center' });

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('TICKET DE CAISSE OFFICIEL', 40, 15, { align: 'center' });
    doc.text(`Ticket N° : ${ticketId}`, 40, 19, { align: 'center' });
    doc.text(`Date : ${dateStr}`, 40, 23, { align: 'center' });
    doc.text(`${accord.titreVendeur} : ${currentUser.nom}`, 40, 27, { align: 'center' });

    if (clientNom.trim()) {
      doc.setFont('helvetica', 'bold');
      doc.text(`Client : ${clientNom.trim()}`, 40, 31, { align: 'center' });
    }

    doc.setLineWidth(0.3);
    doc.line(5, 34, 75, 34);

    // Lignes d'articles
    let y = 39;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.text('ARTICLE', 5, y);
    doc.text('QTÉ x PRIX', 45, y);
    doc.text('TOTAL', 75, y, { align: 'right' });

    y += 4;
    doc.setFont('helvetica', 'normal');

    cart.forEach((item) => {
      doc.text(item.produit_nom.substring(0, 18), 5, y);
      doc.text(`${item.qte} x ${item.prix_unitaire_negocie}F`, 45, y);
      doc.text(`${item.sous_total}F`, 75, y, { align: 'right' });
      y += 5;
    });

    doc.line(5, y, 75, y);
    y += 5;

    // Total
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('TOTAL :', 5, y);
    doc.text(`${totalGeneral.toLocaleString('fr-FR')} F CFA`, 75, y, { align: 'right' });

    y += 6;
    doc.setFontSize(8);
    if (isCreditSale) {
      doc.text('MODE : VENTE À CRÉDIT', 5, y);
      y += 4;
      doc.text(`Reste à payer : ${reste.toLocaleString('fr-FR')} F`, 5, y);
    } else {
      doc.text('MODE : COMPTANT (PAYÉ)', 5, y);
    }

    y += 8;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text('Merci pour votre confiance !', 40, y, { align: 'center' });
    y += 4;
    doc.setFontSize(6.5);
    doc.text('Géré avec EFA ACONTA', 40, y, { align: 'center' });

    const blobUrl = doc.output('bloburl');
    return { pdfDoc: doc, pdfBlobUrl: blobUrl as unknown as string };
  };

  // Validation finale du Panier
  const handleFinalSale = async (creditMode: boolean) => {
    if (cart.length === 0) return;

    // Check avant vente : si l'employé est bloqué ou supprimé
    if (currentUser.role !== 'patron') {
      const emp = await db.employes.get(currentUser.id);
      const isBlocked = emp?.is_blocked || emp?.status === 'blocked' || emp?.is_active === false || emp?.is_deleted || emp?.status === 'deleted';
      if (isBlocked) {
        setIsBlockedUser(true);
        speakFrench("Vous êtes bloqué pour le moment. Vente impossible.");
        return;
      }
    }

    setIsLoading(true);

    const ticketId = 'TCK-' + Math.floor(100000 + Math.random() * 900000);
    const nowIso = new Date().toISOString();
    const parsedReste = creditMode ? parseInt(resteAPayer, 10) || totalGeneral : 0;

    try {
      // 1. Sauvegarder chaque ligne de vente et décrémenter les stocks
      for (const item of cart) {
        const venteId = `vente-${ticketId}-${item.produit_id}`;
        const saleRecord = {
          id: venteId,
          ticket_id: ticketId,
          patron_id: patron.id,
          produit_id: item.produit_id,
          produit_nom: item.produit_nom,
          qte: item.qte,
          montant_total: item.sous_total,
          client_nom: clientNom.trim() || (creditMode ? 'Client Crédit' : 'Client Comptant'),
          est_credit: creditMode,
          reste_a_payer: creditMode ? item.sous_total : 0,
          vendu_par_id: currentUser.id,
          vendu_par_nom: currentUser.nom,
          vendu_par_genre: currentUser.genre,
          date: nowIso,
          synced: false,
          items: cart,
        };

        await db.ventes.put(saleRecord);
        await queueSyncItem('ventes', 'insert', venteId, saleRecord);

        // Décrémenter stock
        const currentProd = products.find((p) => p.id === item.produit_id);
        if (currentProd) {
          const newStock = Math.max(0, currentProd.stock_qte - item.qte);
          await db.produits.update(item.produit_id, { stock_qte: newStock });
          await queueSyncItem('produits', 'update', item.produit_id, { stock_qte: newStock });
        }
      }

      // 2. Si crédit, enregistrer dans la table credits
      if (creditMode) {
        const creditId = 'cred-' + ticketId;
        const creditRecord = {
          id: creditId,
          patron_id: patron.id,
          client_nom: clientNom.trim() || 'Client Crédit',
          montant_initial: totalGeneral,
          reste_a_payer: parsedReste,
          telephone: '',
          dernier_paiement: nowIso,
          synced: false,
        };
        await db.credits.put(creditRecord);
        await queueSyncItem('credits', 'insert', creditId, creditRecord);
      }

      // MODIF 1: Log historique complet de la vente
      const saleDescription = cart.length === 1
        ? `Vente ${cart[0].qte}x ${cart[0].produit_nom} à ${cart[0].sous_total}F par ${currentUser.role === 'patron' ? 'Patron' : (currentUser.prenom || currentUser.nom)}`
        : `Vente panier (${cart.map((c) => `${c.qte}x ${c.produit_nom}`).join(', ')}) total ${totalGeneral}F par ${currentUser.role === 'patron' ? 'Patron' : (currentUser.prenom || currentUser.nom)}`;

      await logAction({
        patron_id: patron.id,
        user_id: currentUser.id,
        employe_id: currentUser.role === 'patron' ? null : currentUser.id,
        employe_nom: currentUser.role === 'patron' ? undefined : (currentUser.prenom || currentUser.nom),
        action_type: 'vente',
        description: saleDescription,
        montant: totalGeneral,
      });

      // 3. Générer le ticket PDF
      const { pdfDoc, pdfBlobUrl } = generateTicketPDF(ticketId, creditMode, parsedReste);

      setGeneratedTicket({
        ticketId,
        pdfDoc,
        pdfBlobUrl,
        clientNom: clientNom.trim() || (creditMode ? 'Client Crédit' : 'Client Comptant'),
        total: totalGeneral,
        items: [...cart],
        dateStr: new Date().toLocaleDateString('fr-FR'),
        estCredit: creditMode,
        reste: parsedReste,
      });

      const messageVocal = creditMode
        ? `Vente à crédit enregistrée pour un total de ${totalGeneral.toLocaleString('fr-FR')} francs. Ticket PDF prêt !`
        : `Vente comptant de ${totalGeneral.toLocaleString('fr-FR')} francs enregistrée avec succès. Ticket PDF prêt !`;

      speakFrench(messageVocal);
    } catch (err) {
      console.error('Erreur vente panier:', err);
      speakFrench('Erreur lors de la vente.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadPDF = () => {
    if (generatedTicket) {
      generatedTicket.pdfDoc.save(`Ticket-${generatedTicket.ticketId}.pdf`);
    }
  };

  const handleShareWhatsAppTicket = () => {
    if (!generatedTicket) return;
    const itemsSummary = generatedTicket.items
      .map((it) => `• ${it.qte}x ${it.produit_nom} = ${it.sous_total} F`)
      .join('\n');

    const msg = encodeURIComponent(
      `🧾 *TICKET DE CAISSE - ${patron.nom_boutique}*\n` +
      `Ticket N°: ${generatedTicket.ticketId}\n` +
      `Client: ${generatedTicket.clientNom}\n` +
      `${accord.titreVendeur}: ${currentUser.nom}\n\n` +
      `*Détails articles:*\n${itemsSummary}\n\n` +
      `*TOTAL:* ${generatedTicket.total.toLocaleString('fr-FR')} F CFA\n` +
      (generatedTicket.estCredit ? `⚠️ Crédit restant: ${generatedTicket.reste.toLocaleString('fr-FR')} F\n` : `✅ Payé comptant\n`) +
      `\nMerci pour votre fidélité !`
    );

    window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
  };

  return (
    <div className="space-y-6 pb-28 select-none relative pt-2">
      {/* CORRECTION 3: Bouton Retour tactile mobile responsive */}
      <BoutonRetour onBack={onBack} />

      {/* Message en haut rouge discret si l'employé est bloqué */}
      {isBlockedUser && (
        <div className="p-2.5 px-4 rounded-2xl bg-red-600 text-white font-bold text-xs sm:text-sm flex items-center justify-between shadow-md border border-red-400 animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>Vous êtes bloqué pour le moment</span>
          </div>
          <span className="text-[10px] bg-red-700/80 px-2 py-0.5 rounded-full font-black">
            Vente interdite
          </span>
        </div>
      )}

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
          VENTE MULTI-ARTICLES (PANIER)
        </h2>
      </div>

      {/* MODAL DU TICKET PDF SUCCÈS CORRECTION 7 */}
      {generatedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border-4 border-[#00B894] text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow">
              <Check className="w-9 h-9 stroke-[3]" />
            </div>

            <h3 className="text-2xl font-black text-gray-900">
              VENTE ENREGISTRÉE !
            </h3>
            <p className="text-sm font-bold text-gray-500">
              Ticket N° <span className="font-mono text-gray-900">{generatedTicket.ticketId}</span>
            </p>

            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-200 text-left space-y-1">
              <div className="flex justify-between font-bold text-sm text-gray-600">
                <span>Total réglé :</span>
                <span className="font-black text-gray-900 text-base">
                  {generatedTicket.total.toLocaleString('fr-FR')} F CFA
                </span>
              </div>
              <div className="flex justify-between font-bold text-xs text-gray-500">
                <span>Articles :</span>
                <span>{generatedTicket.items.length} article(s)</span>
              </div>
              <div className="flex justify-between font-bold text-xs text-gray-500">
                <span>Client :</span>
                <span>{generatedTicket.clientNom}</span>
              </div>
            </div>

            <div className={`grid gap-3 pt-2 ${isBoutiquePro(patron) || patron.subscription_status === 'trial' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
              {(isBoutiquePro(patron) || patron.subscription_status === 'trial') && (
                <button
                  type="button"
                  onClick={handleDownloadPDF}
                  className="min-h-[64px] p-3 rounded-2xl bg-[#0984E3] hover:bg-blue-600 active:scale-95 text-white font-black text-sm flex items-center justify-center gap-2 shadow"
                >
                  <Download className="w-5 h-5 stroke-[2.5]" />
                  <span>TÉLÉCHARGER FACTURE PDF</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleShareWhatsAppTicket}
                className="min-h-[64px] p-3 rounded-2xl bg-[#25D366] hover:bg-emerald-600 active:scale-95 text-white font-black text-sm flex items-center justify-center gap-2 shadow"
              >
                <Share2 className="w-5 h-5 stroke-[2.5]" />
                <span>PARTAGER REÇU WHATSAPP</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setGeneratedTicket(null);
                setCart([]);
                setClientNom('');
                onSaleCompleted();
              }}
              className="w-full min-h-[60px] rounded-2xl bg-[#00B894] hover:bg-emerald-600 text-white font-black text-lg flex items-center justify-center gap-2 shadow-md transition"
            >
              <ShoppingCart className="w-6 h-6" />
              <span>NOUVELLE VENTE</span>
            </button>
          </div>
        </div>
      )}

      {/* CORRECTION 4: MESSAGE VIDE VERT + REDIRECTION VERS STOCK */}
      {products.length === 0 ? (
        <div className="min-h-[55vh] flex flex-col items-center justify-center text-center p-6 sm:p-12 bg-emerald-50/50 border-2 border-dashed border-emerald-300 rounded-3xl my-6 animate-in fade-in">
          <button
            type="button"
            onClick={onGoToStock}
            className="text-xl sm:text-2xl md:text-3xl font-black text-[#10B981] hover:underline cursor-pointer transition p-4 max-w-2xl leading-relaxed focus:outline-none"
          >
            📦 Aucun article en stock. Cliquez ici pour enregistrer vos articles dans Stock →
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* COLONNE GAUCHE (7 cols) : GRILLE DES PRODUITS */}
        <div className="lg:col-span-7 space-y-4">
          {/* MODIF 4 & CORRECTION 4: BARRE DE RECHERCHE + MICRO VOCAL PRO */}
          <div className="space-y-1">
            <VocalInput
              value={searchQuery}
              onChange={setSearchQuery}
              onResult={handleVoiceSearchResult}
              isPro={isBoutiquePro(patron)}
              onUpgradeRequired={() => {
                if (onOpenSubscriptionModal) {
                  onOpenSubscriptionModal('pro', "La reconnaissance vocale est réservée à l'offre Boutique Pro");
                }
              }}
              placeholder="🔍 Recherche un article ou touche le micro..."
            />
          </div>

          <div className="flex items-center justify-between">
            <label className="text-base font-black text-gray-800">
              1. Touche un article pour l'ajouter au panier :
            </label>
            <span className="text-xs font-bold text-gray-400">
              {filteredProducts.length} sur {products.length} produit(s)
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="p-8 text-center bg-gray-50 border-2 border-dashed border-gray-300 rounded-3xl space-y-3">
              <p className="text-base font-black text-gray-600">
                Aucun produit ne correspond à « {searchQuery} »
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="px-4 py-2 bg-purple-100 hover:bg-purple-200 text-[#6C5CE7] font-black rounded-xl text-sm transition"
              >
                Effacer la recherche
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredProducts.map((prod) => {
              // CORRECTION 2 : Détection seuil alerte stock bas
              const seuil = prod.seuil_alerte ?? 5;
              const isStockBas = prod.stock_qte <= seuil;
              const isRupture = prod.stock_qte <= 0;

              return (
                <button
                  key={prod.id}
                  type="button"
                  disabled={isRupture}
                  onClick={() => handleAddToCart(prod)}
                  className={`relative p-3 rounded-2xl border-2 text-left transition transform active:scale-95 flex flex-col justify-between bg-white ${
                    isRupture
                      ? 'opacity-50 border-gray-200 cursor-not-allowed'
                      : isStockBas
                      ? 'border-red-400 hover:border-red-500 shadow-md ring-2 ring-red-100'
                      : 'border-gray-200 hover:border-[#6C5CE7] hover:shadow-md'
                  }`}
                >
                  <div className="relative mb-2 w-full aspect-square rounded-xl overflow-hidden bg-gray-100">
                    <img
                      src={prod.photo_url || 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=400&q=80'}
                      alt={prod.nom}
                      className="w-full h-full object-cover"
                    />

                    {/* CORRECTION 2: BADGE ROUGE CLIGNOTANT STOCK BAS */}
                    {isStockBas && !isRupture && (
                      <span className="absolute top-1 left-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-red-600 text-white animate-pulse shadow">
                        ⚠️ Stock bas ({prod.stock_qte})
                      </span>
                    )}

                    {isRupture && (
                      <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-xs font-black">
                        ÉPUISÉ
                      </span>
                    )}

                    {!isStockBas && !isRupture && (
                      <span className="absolute top-1 right-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-900/80 text-white">
                        {prod.stock_qte} dispo
                      </span>
                    )}
                  </div>

                  <div>
                    <h4 className="font-black text-sm sm:text-base text-gray-900 line-clamp-1">
                      {prod.nom}
                    </h4>
                    <p className="text-base font-black text-[#00B894] mt-0.5">
                      {prod.prix_vente.toLocaleString('fr-FR')} F
                    </p>
                  </div>
                </button>
              );
            })}
            </div>
          )}
        </div>

        {/* COLONNE DROITE (5 cols) : PANIER DÉTAILLÉ + NÉGOCIATION + TICKET */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-3xl p-5 border-2 border-gray-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-6 h-6 text-[#6C5CE7]" />
                <h3 className="text-xl font-black text-gray-900">
                  PANIER EN COURS
                </h3>
              </div>
              <span className="text-xs font-black px-2.5 py-1 rounded-full bg-purple-100 text-[#6C5CE7]">
                {cart.length} ligne(s)
              </span>
            </div>

            {/* Liste des articles du panier */}
            {cart.length === 0 ? (
              <div className="text-center py-10 font-bold text-gray-400">
                <ShoppingBag className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                <p>Le panier est vide.</p>
                <p className="text-xs text-gray-400 mt-1">Touche un article à gauche pour l'ajouter.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                {cart.map((item) => (
                  <div
                    key={item.produit_id}
                    className="p-3.5 rounded-2xl bg-gray-50 border border-gray-200 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <h5 className="font-black text-base text-gray-900 line-clamp-1">
                        {item.produit_nom}
                      </h5>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.produit_id)}
                        className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Quantité (-/+) et Négociation prix unitaire */}
                    <div className="grid grid-cols-2 gap-2 items-center">
                      {/* Contrôle quantité */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(item.produit_id, -1)}
                          className="w-8 h-8 rounded-xl bg-gray-200 hover:bg-gray-300 flex items-center justify-center font-black"
                        >
                          <Minus className="w-4 h-4 stroke-[3]" />
                        </button>
                        <span className="w-7 text-center font-black text-lg">
                          {item.qte}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(item.produit_id, 1)}
                          className="w-8 h-8 rounded-xl bg-gray-200 hover:bg-gray-300 flex items-center justify-center font-black"
                        >
                          <Plus className="w-4 h-4 stroke-[3]" />
                        </button>
                      </div>

                      {/* NÉGOCIATION PRIX UNITAIRE : input number éditable */}
                      <div>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            value={item.prix_unitaire_negocie}
                            onChange={(e) => handleUpdatePrice(item.produit_id, e.target.value)}
                            className="w-full text-right pr-6 py-1 px-2 rounded-xl border border-gray-300 font-black text-sm bg-white text-gray-900 focus:outline-none focus:border-[#6C5CE7]"
                            title="Prix unitaire négocié"
                          />
                          <span className="absolute right-2 top-1.5 text-xs font-bold text-gray-400">
                            F
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between text-xs font-bold text-gray-500 pt-1 border-t border-gray-200/60">
                      <span>Sous-total ligne :</span>
                      <span className="font-black text-[#00B894] text-sm">
                        {item.sous_total.toLocaleString('fr-FR')} F
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* UN SEUL CHAMP CLIENT NOM POUR TOUT LE PANIER */}
            <div>
              <label className="block text-xs font-black uppercase text-gray-500 mb-1 flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                <span>Client (recommandé si crédit) :</span>
              </label>
              <input
                type="text"
                placeholder="Ex : Koffi, Akossiwa, Maman Kodjo..."
                value={clientNom}
                onChange={(e) => setClientNom(e.target.value)}
                className="w-full text-base font-bold p-3 rounded-2xl border-2 border-gray-200 focus:border-[#6C5CE7] focus:outline-none bg-gray-50 text-gray-900"
              />
            </div>

            {/* Mode crédit : Reste à payer */}
            {estCredit && (
              <div className="p-3 rounded-2xl bg-orange-50 border border-orange-300 space-y-2 animate-in fade-in">
                <label className="block text-xs font-black uppercase text-orange-800">
                  Reste à payer (F CFA) :
                </label>
                <input
                  type="number"
                  placeholder={`Montant restant (défaut : ${totalGeneral} F)`}
                  value={resteAPayer}
                  onChange={(e) => setResteAPayer(e.target.value)}
                  className="w-full text-lg font-black p-2.5 rounded-xl border border-orange-300 bg-white text-orange-950"
                />
              </div>
            )}

            {/* TOTAL GÉNÉRAL DU PANIER */}
            <div className="p-4 rounded-2xl bg-gray-100 flex items-center justify-between">
              <span className="text-base font-black text-gray-700">TOTAL PANIER :</span>
              <span className="text-2xl sm:text-3xl font-black text-gray-900">
                {totalGeneral.toLocaleString('fr-FR')} F CFA
              </span>
            </div>

            {/* LES 2 BOUTONS FINAUX GÉANTS */}
            <div className="grid grid-cols-1 gap-3 pt-2">
              <button
                type="button"
                disabled={isLoading || cart.length === 0 || isBlockedUser}
                onClick={() => handleFinalSale(false)}
                className="min-h-[80px] p-4 rounded-2xl bg-[#00B894] hover:bg-emerald-600 active:scale-95 text-white font-black text-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/25 transition disabled:opacity-50"
              >
                <Check className="w-7 h-7 stroke-[3]" />
                <span>{isBlockedUser ? 'COMPTE BLOQUÉ (VENTE IMPOSSIBLE)' : 'VENDRE COMPTANT'}</span>
              </button>

              <button
                type="button"
                disabled={isLoading || cart.length === 0 || isBlockedUser}
                onClick={() => {
                  if (!estCredit) {
                    setEstCredit(true);
                  } else {
                    handleFinalSale(true);
                  }
                }}
                className="min-h-[80px] p-4 rounded-2xl bg-[#E17055] hover:bg-orange-600 active:scale-95 text-white font-black text-xl flex items-center justify-center gap-2 shadow-lg shadow-orange-500/25 transition disabled:opacity-50"
              >
                <CreditCard className="w-7 h-7 stroke-[2.5]" />
                <span>{isBlockedUser ? 'COMPTE BLOQUÉ' : estCredit ? 'VALIDER VENTE CRÉDIT' : 'VENDRE À CRÉDIT'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);
};
