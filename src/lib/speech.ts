import type { ParsedVoiceCommand, Produit } from './types';

// MODIF 3: Gestion activation / coupure Voix EFA
export function isVoiceEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem('efa_voice_on') !== 'false';
}

export function setVoiceEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('efa_voice_on', enabled ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('efa_voice_toggle', { detail: enabled }));
}

// Synthèse vocale en Français (fr-FR)
export function speakFrench(text: string, onEnd?: () => void) {
  // MODIF 3: Si la voix est coupée, annuler et sortir directement
  if (!isVoiceEnabled()) {
    if (onEnd) onEnd();
    return;
  }

  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return;
  }

  // Cancel prior speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'fr-FR';
  utterance.rate = 0.95; // Légèrement posé pour clarté
  utterance.pitch = 1.05; // Ton chaleureux

  // Choix d'une voix française si disponible
  const voices = window.speechSynthesis.getVoices();
  const frVoice = voices.find((v) => v.lang.startsWith('fr') || v.lang.includes('FR'));
  if (frVoice) {
    utterance.voice = frVoice;
  }

  if (onEnd) {
    utterance.onend = () => onEnd();
    utterance.onerror = () => onEnd();
  }

  window.speechSynthesis.speak(utterance);
}

// Nettoyage et conversion des chiffres prononcés en lettres
function normalizeFrenchNumbers(text: string): string {
  let cleaned = text.toLowerCase();
  
  // Remplacements usuels de nombres parlés
  const wordMap: Record<string, string> = {
    'un': '1', 'une': '1', 'deux': '2', 'trois': '3', 'quatre': '4',
    'cinq': '5', 'six': '6', 'sept': '7', 'huit': '8', 'neuf': '9',
    'dix': '10', 'vingt': '20', 'trente': '30', 'quarante': '40',
    'cinquante': '50', 'cent': '100', 'mille': '1000'
  };

  // Traitement spécial pour "10 mille", "50 mille", etc.
  cleaned = cleaned.replace(/(\d+)\s*mille/gi, (_, n) => `${parseInt(n, 10) * 1000}`);
  
  return cleaned;
}

// Extraction intelligente des commandes vocales de la boutique
export function parseVoiceCommand(
  rawTranscript: string,
  availableProducts: Produit[]
): ParsedVoiceCommand | null {
  const text = rawTranscript.trim();
  const lower = normalizeFrenchNumbers(text);

  // 1. Navigation simple
  if (lower.includes('mon argent') || lower.includes('montre mon argent') || lower.includes('caisse')) {
    return {
      type: 'navigation',
      summary: 'Aller à l\'écran MON ARGENT',
      raw_transcript: rawTranscript,
      data: { target: 'mon-argent' },
    };
  }

  if (lower.startsWith('vendre') && lower.length < 15) {
    return {
      type: 'navigation',
      summary: 'Aller à l\'écran VENDRE',
      raw_transcript: rawTranscript,
      data: { target: 'vendre' },
    };
  }

  // 2. Commande DÉPENSE: "Ajoute dépense loyer 50000", "dépense transport 2000"
  if (lower.includes('dépense') || lower.includes('depense')) {
    // Regex pour extraire montant et type
    // ex: "ajoute dépense loyer 50000" ou "dépense taxi 1500"
    const amountMatch = lower.match(/(\d+)\s*(f|fcfa|francs)?$/i) || lower.match(/(\d{3,})/);
    const amount = amountMatch ? parseInt(amountMatch[1], 10) : 0;

    let typeDepense = 'Dépense courante';
    const cleanNoAmount = lower.replace(/\d+/g, '').replace(/(ajoute|ajoutez|dépense|depense|de|pour|le|la|f|fcfa|francs)/gi, '').trim();
    if (cleanNoAmount.length > 0) {
      typeDepense = cleanNoAmount.charAt(0).toUpperCase() + cleanNoAmount.slice(1);
    } else if (lower.includes('loyer')) {
      typeDepense = 'Loyer boutique';
    } else if (lower.includes('salaire')) {
      typeDepense = 'Salaire';
    } else if (lower.includes('transport') || lower.includes('taxi')) {
      typeDepense = 'Transport';
    } else if (lower.includes('charbon')) {
      typeDepense = 'Charbon';
    } else if (lower.includes('nourriture') || lower.includes('manger')) {
      typeDepense = 'Nourriture';
    }

    if (amount > 0) {
      return {
        type: 'depense',
        summary: `Ajouter une dépense de ${amount.toLocaleString('fr-FR')} F pour "${typeDepense}"`,
        raw_transcript: rawTranscript,
        data: {
          type: typeDepense,
          montant: amount,
          description: `Ajouté par voix EFA: "${text}"`,
        },
      };
    }
  }

  // 3. Commande AJOUTER PRODUIT: "Ajoute pull noir achat 3000 vente 5000 stock 10"
  if (lower.includes('achat') && lower.includes('vente')) {
    const achatMatch = lower.match(/achat\s*(\d+)/i);
    const venteMatch = lower.match(/vente\s*(\d+)/i);
    const stockMatch = lower.match(/stock\s*(\d+)/i) || lower.match(/quantit[ée]\s*(\d+)/i);

    const prixAchat = achatMatch ? parseInt(achatMatch[1], 10) : 0;
    const prixVente = venteMatch ? parseInt(venteMatch[1], 10) : 0;
    const stockQte = stockMatch ? parseInt(stockMatch[1], 10) : 10;

    // Nom du produit
    let nomProduit = 'Nouveau produit';
    const nomPart = text.replace(/ajoute|ajouter/gi, '').split(/achat/i)[0]?.trim();
    if (nomPart && nomPart.length > 2) {
      nomProduit = nomPart.charAt(0).toUpperCase() + nomPart.slice(1);
    }

    if (prixVente > 0) {
      return {
        type: 'produit',
        summary: `Ajouter produit "${nomProduit}" (Achat: ${prixAchat.toLocaleString('fr-FR')} F | Vente: ${prixVente.toLocaleString('fr-FR')} F | Stock: ${stockQte})`,
        raw_transcript: rawTranscript,
        data: {
          nom: nomProduit,
          prix_achat: prixAchat,
          prix_vente: prixVente,
          stock_qte: stockQte,
        },
      };
    }
  }

  // 4. Commande VENTE: "Vends 2 pulls noirs à Koffi crédit 10000", "vends 1 pagne 12000"
  if (lower.includes('vend') || lower.includes('vente')) {
    // Quantité
    let qte = 1;
    const qteMatch = lower.match(/(?:vend|vends|vendez)\s+(\d+)/i);
    if (qteMatch) {
      qte = parseInt(qteMatch[1], 10);
    }

    // Est crédit ?
    const estCredit = lower.includes('crédit') || lower.includes('credit');

    // Montant crédit / reste
    let creditAmount = 0;
    const creditMatch = lower.match(/cr[ée]dit\s*(\d+)/i);
    if (creditMatch) {
      creditAmount = parseInt(creditMatch[1], 10);
    }

    // Nom du client (ex: "à Koffi", "pour Akossiwa")
    let clientNom = '';
    const clientMatch = text.match(/(?:[àa]|pour)\s+([A-ZÀ-Ÿa-zà-ÿ]+)/i);
    if (clientMatch) {
      clientNom = clientMatch[1].charAt(0).toUpperCase() + clientMatch[1].slice(1);
    }

    // Match produit parmi availableProducts
    let matchedProduct = availableProducts[0] || null;
    let maxMatchScore = 0;

    for (const prod of availableProducts) {
      const prodNameWords = prod.nom.toLowerCase().split(/\s+/);
      let score = 0;
      for (const word of prodNameWords) {
        if (word.length > 3 && lower.includes(word)) {
          score += 2;
        }
      }
      if (score > maxMatchScore) {
        maxMatchScore = score;
        matchedProduct = prod;
      }
    }

    if (matchedProduct) {
      const montantTotal = matchedProduct.prix_vente * qte;
      const resteAPayer = estCredit ? (creditAmount > 0 ? creditAmount : montantTotal) : 0;

      const summary = estCredit
        ? `Vendre ${qte} ${matchedProduct.nom} à ${clientNom || 'Client'} À CRÉDIT (${montantTotal.toLocaleString('fr-FR')} F)`
        : `Vendre ${qte} ${matchedProduct.nom} COMPTANT (${montantTotal.toLocaleString('fr-FR')} F)`;

      return {
        type: 'vente',
        summary,
        raw_transcript: rawTranscript,
        data: {
          produit_id: matchedProduct.id,
          produit_nom: matchedProduct.nom,
          qte,
          montant_total: montantTotal,
          client_nom: clientNom || (estCredit ? 'Client sans nom' : ''),
          est_credit: estCredit,
          reste_a_payer: resteAPayer,
        },
      };
    }
  }

  return null;
}
