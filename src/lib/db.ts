import Dexie, { type Table } from 'dexie';
import type {
  Patron,
  Employe,
  Produit,
  Vente,
  Depense,
  Credit,
  Parrainage,
  LogSuppression,
  SyncQueueItem,
  HistoriqueAction,
  SubscriptionRecord,
  ConnectedDevice,
  BoutiqueRecord,
} from './types';

export class EfaDatabase extends Dexie {
  patrons!: Table<Patron, string>;
  employes!: Table<Employe, string>;
  produits!: Table<Produit, string>;
  ventes!: Table<Vente, string>;
  depenses!: Table<Depense, string>;
  credits!: Table<Credit, string>;
  parrainage!: Table<Parrainage, string>;
  logsSuppression!: Table<LogSuppression, string>;
  syncQueue!: Table<SyncQueueItem, number>;
  historiqueActions!: Table<HistoriqueAction, string>;
  subscriptions!: Table<SubscriptionRecord, string>;
  appareils!: Table<ConnectedDevice, string>;
  boutiques!: Table<BoutiqueRecord, string>;

  constructor() {
    super('EfaAcontaV5');
    this.version(4).stores({
      patrons: 'id, telephone',
      employes: 'id, patron_id, telephone',
      produits: 'id, patron_id, nom',
      ventes: 'id, patron_id, date, synced, vendu_par_id',
      depenses: 'id, patron_id, date, synced',
      credits: 'id, patron_id, client_nom, synced',
      parrainage: 'id, parrain_id, status, lien_code',
      logsSuppression: 'id, patron_id, vente_id, date',
      syncQueue: '++id, table_name, action',
      historiqueActions: 'id, patron_id, employe_id, action_type, created_at',
      subscriptions: 'id, patron_id, plan, status',
      appareils: 'id, patron_id, device_id, last_active',
      boutiques: 'id, patron_id, is_active',
    });
  }
}

export const db = new EfaDatabase();

// MODIF 1: ARRÊTER L'AFFICHAGE AUTO DES PRODUITS PAR DÉFAUT
// Nouveau compte = vide total jusqu'à ajout manuel
export async function seedDemoProducts(_patronId: string): Promise<void> {
  // Désactivé : NE JAMAIS injecter d'exemples automatiques.
  return;
}

// Fonction de nettoyage pour les anciens comptes qui ont encore des produits exemples
export async function deleteDemoProducts(patronId: string): Promise<number> {
  const demoIds = ['prod-1', 'prod-2', 'prod-3', 'prod-4'];
  const demoNames = [
    'Pull Noir Coton',
    'Pagne Wax Premium',
    'Robe Wax Moderne',
    'Sandales Cuir Élégantes',
  ];

  const allProducts = await db.produits.where('patron_id').equals(patronId).toArray();
  const demoProducts = allProducts.filter(
    (p) =>
      demoIds.includes(p.id) ||
      demoNames.includes(p.nom) ||
      p.is_exemple === true
  );

  for (const p of demoProducts) {
    await db.produits.delete(p.id);
  }

  return demoProducts.length;
}
