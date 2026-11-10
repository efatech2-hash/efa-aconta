import React from 'react';
import { Pencil, AlertTriangle } from 'lucide-react';
import type { Produit } from '../lib/types';

interface StockCardProps {
  product: Produit;
  isBas?: boolean;
  onEdit?: (product: Produit) => void;
  onQuickAdjustQte?: (product: Produit, delta: number) => void;
}

export const StockCard: React.FC<StockCardProps> = ({
  product: p,
  isBas = false,
  onEdit,
  onQuickAdjustQte,
}) => {
  const marge = p.prix_vente - p.prix_achat;

  return (
    <div
      key={p.id}
      className={`bg-white rounded-3xl border-2 overflow-hidden shadow-sm hover:shadow-md transition flex flex-col justify-between ${
        isBas ? 'border-red-400 ring-2 ring-red-100' : 'border-gray-200'
      }`}
    >
      {/* Conteneur Image avec bouton Modifier rouge */}
      <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
        <img
          src={
            p.photo_url ||
            'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?auto=format&fit=crop&w=600&q=80'
          }
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

        {/* Bouton rond rouge angle haut droit */}
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(p)}
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
        )}

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

        {/* Bloc Quantité Compact Anti-débordement */}
        <div className="flex items-center justify-between gap-1 w-full mt-2 px-1.5 py-1 bg-gray-50 rounded-lg min-w-0">
          <span className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase truncate">
            <span className="hidden sm:inline">QUANTITÉ :</span>
            <span className="sm:hidden">QTÉ:</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onQuickAdjustQte && onQuickAdjustQte(p, -1)}
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
              onClick={() => onQuickAdjustQte && onQuickAdjustQte(p, 1)}
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
export default StockCard;
