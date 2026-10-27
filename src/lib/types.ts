export type Role = 'patron' | 'vendeuse';
export type Genre = 'femme' | 'homme';
export type SubscriptionStatus = 'trial' | 'free' | 'populaire' | 'pro' | 'expired';

export interface CurrentUser {
  id: string;
  nom: string;
  prenom?: string;
  role: Role;
  genre: Genre;
  photo_url?: string;
}

export interface Patron {
  id: string;
  nom: string;
  telephone: string;
  phone_country?: string;
  phone_number?: string;
  phone_full?: string;
  nom_boutique: string;
  pin_hash: string;
  pin_code?: string; // code PIN personnel du patron
  code_pin?: string; // code PIN / mot de passe colonne Supabase
  mot_de_passe?: string; // mot de passe synchro
  photo_url?: string;
  genre: Genre;
  role: 'patron';
  abonnement_expire: string; // ISO date string
  trial_start_date?: string;
  trial_end_date?: string;
  subscription_status?: SubscriptionStatus;
  current_plan?: SubscriptionStatus; // Forfait actuel: 'free' | 'trial' | 'populaire' | 'pro' | 'expired'
  subscription_end_date?: string;
  fin_abonnement?: string;
  forfait?: string;
  statut?: string;
  email?: string;
  referral_code?: string; // code unique ex: EFA-X7Y2Z
  referred_by?: string | null; // code du parrain
  referral_bonus_given?: boolean; // bonus donné 1 seule fois par filleul
  has_paid_annuel?: boolean; // si filleul a payé 1 an
  referrals_count?: number; // nombre de filleuls ayant payé 1 an
  bonus_days_earned?: number; // total jours bonus gagnés (+60j / filleul 1 an)
  auto_logout_after_action?: boolean; // default true
  isProActive?: boolean; // abonnement Pro actif (6 mois ou 12 mois)
  proExpiresAt?: string | null; // date expiration Pro
  parentId?: string | null; // null = boutique principale, ID = boutique parente
  type?: 'MAIN' | 'SUB'; // MAIN = boutique principale, SUB = sous-boutique
  maxBoutiques?: number; // max boutiques permises (default 3 pour Pro)
  ownerId?: string; // ID du patron propriétaire
  created_at: string;
}

export interface ReferralLogRecord {
  id: string;
  parrain_id: string;
  filleul_id: string;
  filleul_plan: string;
  bonus_days: number;
  created_at: string;
  is_annual: boolean;
}

export interface Employe {
  id: string;
  patron_id: string;
  nom: string;
  prenom?: string;
  telephone: string;
  phone_country?: string;
  phone_number?: string;
  phone_full?: string;
  pin_hash: string;
  pin_code?: string; // Correction 1: code PIN visible par le patron
  code_pin?: string; // Supabase code_pin colonne
  status?: 'active' | 'blocked' | 'deleted'; // Correction 1: statut blocage
  is_active?: boolean; // Correction 1: actif/inactif
  is_blocked?: boolean; // Patron a bloqué cet employé
  is_deleted?: boolean; // Employé supprimé
  genre: Genre;
  photo_url?: string;
  role: 'vendeuse';
  subscription_status?: SubscriptionStatus; // Suit automatiquement l'abonnement du patron
  created_at: string;
}

export interface Produit {
  id: string;
  patron_id: string;
  nom: string;
  photo_url: string;
  prix_achat: number;
  prix_vente: number;
  stock_qte: number;
  seuil_alerte: number; // Correction 2: seuil alerte stock bas ajustable, default 5
  categorie?: string; // Correction 5: catégorie article
  is_exemple?: boolean; // Marqueur pour produits de démonstration
  created_at: string;
}

export interface VenteItem {
  id: string;
  produit_id: string;
  produit_nom: string;
  qte: number;
  prix_unitaire_negocie: number;
  sous_total: number;
}

export interface Vente {
  id: string;
  ticket_id?: string;
  patron_id: string;
  produit_id: string;
  produit_nom: string;
  qte: number;
  montant_total: number;
  client_nom?: string;
  est_credit: boolean;
  reste_a_payer: number;
  vendu_par_id: string;
  vendu_par_nom: string;
  vendu_par_genre?: Genre;
  date: string;
  synced: boolean;
  items?: VenteItem[]; // Correction 7: Multi-articles dans un panier
}

export interface Depense {
  id: string;
  patron_id: string;
  type: string; // Texte libre: loyer, salaire, charbon, transport, nourriture, etc.
  montant: number;
  description?: string;
  cree_par: string;
  date: string;
  synced: boolean;
}

export interface Credit {
  id: string;
  patron_id: string;
  client_nom: string;
  montant_initial: number;
  reste_a_payer: number;
  telephone?: string;
  dernier_paiement?: string;
  synced: boolean;
}

export interface Parrainage {
  id: string;
  parrain_id: string;
  filleul_id?: string;
  filleul_nom: string;
  lien_code: string;
  filleul_phone: string;
  status: 'attente' | 'valide' | 'fraude';
  mois_gagnes: number;
  clics?: number; // Correction 10: clics
  conversions?: number; // Correction 10: conversions
  date_inscription: string;
  date_abo_1an?: string;
}

export interface LogSuppression {
  id: string;
  patron_id: string;
  vente_id: string;
  ticket_id?: string;
  produit_nom: string;
  qte: number;
  montant: number;
  client_nom: string;
  raison: string;
  supprime_par: string;
  date: string;
}

export interface SyncQueueItem {
  id?: number;
  table_name: string;
  action: 'insert' | 'update' | 'delete';
  record_id: string;
  data: any;
  created_at: string;
}

export interface ParsedVoiceCommand {
  type: 'vente' | 'depense' | 'produit' | 'navigation';
  summary: string;
  raw_transcript: string;
  data: any;
}

export type ActionType =
  | 'vente'
  | 'ajout_stock'
  | 'modif_stock'
  | 'suppression'
  | 'connexion'
  | 'deconnexion'
  | 'creation_employe'
  | 'blocage_employe'
  | 'remboursement_dette';

export interface HistoriqueAction {
  id: string;
  user_id?: string;
  patron_id: string;
  employe_id?: string | null;
  employe_nom?: string;
  action_type: ActionType;
  description: string;
  montant?: number;
  created_at: string; // ISO UTC format
}

export type SubscriptionPlan = 'free' | 'trial' | 'populaire' | 'pro' | 'expired';

export interface SubscriptionFeatures {
  voix_efa: boolean;
  micro_vocal: boolean;
  benefice_caisse: boolean;
  recu_whatsapp: boolean;
  facture_officielle_pdf: boolean;
  export_comptable_avance: boolean;
  support_whatsapp_prioritaire: boolean;
  historique_illimite: boolean;
  sauvegarde_cloud_auto: boolean;
}

export interface SubscriptionRecord {
  id: string;
  patron_id: string;
  plan: SubscriptionPlan;
  status: 'active' | 'trial' | 'expired' | 'canceled';
  limit_articles: number; // 7, 50, 100, 300
  limit_vendeurs: number; // 1, 2, 3, 10
  limit_appareils: number; // 1, 2, 3, 5
  limit_boutiques: number; // 1, 1, 1, 3
  features: SubscriptionFeatures;
  expires_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface ConnectedDevice {
  id: string;
  patron_id: string;
  device_id: string;
  device_name: string;
  last_active: string;
  created_at: string;
  is_active?: boolean;
}

export interface BoutiqueRecord {
  id: string;
  patron_id: string;
  nom: string;
  adresse?: string;
  current_plan?: SubscriptionPlan;
  parentId?: string | null;
  type?: 'MAIN' | 'SUB';
  ownerId?: string;
  maxBoutiques?: number;
  is_active: boolean;
  created_at: string;
}
