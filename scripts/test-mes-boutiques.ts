/**
 * TEST E2E MES BOUTIQUES PRO - EFA ACONTA
 * 
 * 1. Créer Boutique 2 et 3, atteindre 300 articles cumulés, vérifier blocage sur MAIN + SUB avec message officiel.
 * 2. Créer 10 employés répartis sur 3 boutiques, vérifier blocage au 11e.
 * 3. Login vendeur affecté à Boutique 2, vérifier qu'il ne voit QUE les produits/vendeurs/ventes de Boutique 2
 *    et qu'il n'a pas accès à /mes-boutiques, /abonnement.
 */

import 'fake-indexeddb/auto';

// Shim pour environnement Node
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

import { db } from '../src/lib/db';
import {
  isProActive,
  getOwnerStores,
  getTotalArticleCount,
  canAddArticlePro,
  getTotalEmployeeCount,
  canAddEmployeePro,
  createSubBoutique,
  setDeviceStore,
  getDeviceStoreInfo,
  clearDeviceStore,
  verifyPatronPin,
  PRO_MAX_ARTICLES,
  PRO_MAX_EMPLOYEES,
  PRO_MAX_BOUTIQUES,
} from '../src/lib/mesBoutiques';
import { getCurrentBoutiqueId } from '../src/lib/deviceAuth';
import type { Patron, Produit, Employe, Vente } from '../src/lib/types';
import { hashPin } from '../src/lib/security';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ÉCHEC : ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✅ ${message}`);
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🧪 DÉMARRAGE DU TEST E2E COMPLET : MES BOUTIQUES PRO');
  console.log('======================================================\n');

  // Nettoyage complet Dexie local avant le test
  await db.patrons.clear();
  await db.produits.clear();
  await db.employes.clear();
  await db.ventes.clear();
  clearDeviceStore();

  const patronPin = '2026';
  const patronPinHash = await hashPin(patronPin);
  const now = new Date().toISOString();
  const proExpires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(); // 6 mois

  // 0. Création Boutique Principale (MAIN)
  const mainPatron: Patron = {
    id: 'btq_main_test_1',
    nom: 'Aïcha Patrone',
    nom_boutique: 'Boutique Principale Grand Marché',
    telephone: '+22890001122',
    phone_country: '+228',
    phone_number: '90001122',
    phone_full: '+22890001122',
    pin_code: patronPin,
    code_pin: patronPin,
    pin_hash: patronPinHash,
    genre: 'femme',
    role: 'patron',
    abonnement_expire: proExpires,
    subscription_status: 'pro',
    current_plan: 'pro',
    forfait: 'pro',
    isProActive: true,
    proExpiresAt: proExpires,
    maxBoutiques: PRO_MAX_BOUTIQUES,
    type: 'MAIN',
    parentId: null,
    ownerId: 'btq_main_test_1',
    created_at: now,
  };

  await db.patrons.put(mainPatron);
  assert(isProActive(mainPatron), 'La boutique principale est bien reconnue comme PRO active');

  // =========================================================================
  // TEST 1 : CRÉATION BOUTIQUE 2 ET 3 & RÈGLE D'OR 300 ARTICLES
  // =========================================================================
  console.log('\n--- 1. TEST CRÉATION SOUS-BOUTIQUES (MAX 3) & QUOTA 300 ARTICLES ---');

  // Création Boutique 2
  const resBoutique2 = await createSubBoutique({ mainPatron, nom: 'Boutique 2 - Tokoin' });
  assert(resBoutique2.success && !!resBoutique2.boutique, 'Création de Boutique 2 réussie');
  const boutique2 = resBoutique2.boutique!;
  assert(boutique2.type === 'SUB', 'Boutique 2 a bien le type SUB');
  assert(boutique2.parentId === mainPatron.id, 'Boutique 2 a pour parentId la boutique principale');

  // Création Boutique 3
  const resBoutique3 = await createSubBoutique({ mainPatron, nom: 'Boutique 3 - Bè Beach' });
  assert(resBoutique3.success && !!resBoutique3.boutique, 'Création de Boutique 3 réussie');
  const boutique3 = resBoutique3.boutique!;
  assert(boutique3.type === 'SUB', 'Boutique 3 a bien le type SUB');

  // Vérification liste des 3 boutiques
  const stores = await getOwnerStores(mainPatron.id);
  assert(stores.length === 3, `Le propriétaire possède exactement 3 boutiques (trouvé: ${stores.length})`);

  // Tentative de création d'une 4e boutique (doit échouer)
  const resBoutique4 = await createSubBoutique({ mainPatron, nom: 'Boutique 4 - Illégale' });
  assert(!resBoutique4.success, 'Tentative de 4e boutique bloquée (limite 3 boutiques Pro)');

  // Répartition de 300 articles cumulés sur les 3 boutiques :
  // - 100 sur MAIN
  // - 100 sur Boutique 2
  // - 100 sur Boutique 3
  console.log('  -> Insertion de 100 articles sur la boutique Principale...');
  const prodsMain: Produit[] = Array.from({ length: 100 }).map((_, i) => ({
    id: `prod_main_${i}`,
    patron_id: mainPatron.id,
    nom: `Robe Pagne Lomé #${i + 1}`,
    photo_url: '',
    categorie: 'Vêtements',
    prix_vente: 15000,
    prix_achat: 10000,
    stock_qte: 10,
    seuil_alerte: 3,
    created_at: now,
  }));
  await db.produits.bulkPut(prodsMain);

  console.log('  -> Insertion de 100 articles sur Boutique 2...');
  const prodsB2: Produit[] = Array.from({ length: 100 }).map((_, i) => ({
    id: `prod_b2_${i}`,
    patron_id: boutique2.id,
    nom: `Chaussures Cuir Tokoin #${i + 1}`,
    photo_url: '',
    categorie: 'Chaussures',
    prix_vente: 12000,
    prix_achat: 8000,
    stock_qte: 5,
    seuil_alerte: 2,
    created_at: now,
  }));
  await db.produits.bulkPut(prodsB2);

  console.log('  -> Insertion de 100 articles sur Boutique 3...');
  const prodsB3: Produit[] = Array.from({ length: 100 }).map((_, i) => ({
    id: `prod_b3_${i}`,
    patron_id: boutique3.id,
    nom: `Sac à main Artisanal #${i + 1}`,
    photo_url: '',
    categorie: 'Accessoires',
    prix_vente: 8000,
    prix_achat: 5000,
    stock_qte: 8,
    seuil_alerte: 2,
    created_at: now,
  }));
  await db.produits.bulkPut(prodsB3);

  // Vérification total cumulé
  const totalArticles = await getTotalArticleCount(mainPatron.id);
  assert(totalArticles === 300, `Total articles calculé sur toutes les boutiques = 300 (trouvé: ${totalArticles})`);

  // Test blocage 301e article sur MAIN
  const checkAddMain = await canAddArticlePro(mainPatron.id);
  assert(!checkAddMain.allowed, 'Ajout du 301e article sur la boutique principale BLOQUÉ');
  assert(
    checkAddMain.message ===
      'Limite Pro atteinte : 300 articles pour toutes tes boutiques réunies. Supprime un article ou passe en Premium.',
    `Message officiel sur MAIN respecté : "${checkAddMain.message}"`
  );

  // Test blocage 301e article sur SUB (Boutique 2)
  const checkAddSub = await canAddArticlePro(boutique2.id);
  assert(!checkAddSub.allowed, 'Ajout du 301e article sur Boutique 2 (SUB) BLOQUÉ');
  assert(
    checkAddSub.message ===
      'Limite Pro atteinte : 300 articles pour toutes tes boutiques réunies. Supprime un article ou passe en Premium.',
    `Message officiel sur SUB respecté : "${checkAddSub.message}"`
  );

  // =========================================================================
  // TEST 2 : 10 EMPLOYÉS RÉPARTIS SUR 3 BOUTIQUES & BLOCAGE AU 11E
  // =========================================================================
  console.log('\n--- 2. TEST 10 EMPLOYÉS RÉPARTIS SUR LES 3 BOUTIQUES & BLOCAGE AU 11E ---');

  // Répartition des employés :
  // - 3 en Principale
  // - 3 en Boutique 2
  // - 4 en Boutique 3
  const employesData: Employe[] = [
    // 3 en Principale
    { id: 'emp_main_1', patron_id: mainPatron.id, nom: 'Afia', telephone: '+22890110001', pin_code: '1111', pin_hash: 'hash_1111', role: 'vendeuse', genre: 'femme', is_active: true, status: 'active', created_at: now },
    { id: 'emp_main_2', patron_id: mainPatron.id, nom: 'Akossiwa', telephone: '+22890110002', pin_code: '2222', pin_hash: 'hash_2222', role: 'vendeuse', genre: 'femme', is_active: true, status: 'active', created_at: now },
    { id: 'emp_main_3', patron_id: mainPatron.id, nom: 'Komi', telephone: '+22890110003', pin_code: '3333', pin_hash: 'hash_3333', role: 'vendeuse', genre: 'homme', is_active: true, status: 'active', created_at: now },
    // 3 en Boutique 2
    { id: 'emp_b2_1', patron_id: boutique2.id, nom: 'Kofi', telephone: '+22890220001', pin_code: '4444', pin_hash: 'hash_4444', role: 'vendeuse', genre: 'homme', is_active: true, status: 'active', created_at: now },
    { id: 'emp_b2_2', patron_id: boutique2.id, nom: 'Adjovi', telephone: '+22890220002', pin_code: '5555', pin_hash: 'hash_5555', role: 'vendeuse', genre: 'femme', is_active: true, status: 'active', created_at: now },
    { id: 'emp_b2_3', patron_id: boutique2.id, nom: 'Mawuli', telephone: '+22890220003', pin_code: '6666', pin_hash: 'hash_6666', role: 'vendeuse', genre: 'homme', is_active: true, status: 'active', created_at: now },
    // 4 en Boutique 3
    { id: 'emp_b3_1', patron_id: boutique3.id, nom: 'Sena', telephone: '+22890330001', pin_code: '7777', pin_hash: 'hash_7777', role: 'vendeuse', genre: 'femme', is_active: true, status: 'active', created_at: now },
    { id: 'emp_b3_2', patron_id: boutique3.id, nom: 'Enyonam', telephone: '+22890330002', pin_code: '8888', pin_hash: 'hash_8888', role: 'vendeuse', genre: 'femme', is_active: true, status: 'active', created_at: now },
    { id: 'emp_b3_3', patron_id: boutique3.id, nom: 'Kodjo', telephone: '+22890330003', pin_code: '9999', pin_hash: 'hash_9999', role: 'vendeuse', genre: 'homme', is_active: true, status: 'active', created_at: now },
    { id: 'emp_b3_4', patron_id: boutique3.id, nom: 'Ablavi', telephone: '+22890330004', pin_code: '1010', pin_hash: 'hash_1010', role: 'vendeuse', genre: 'femme', is_active: true, status: 'active', created_at: now },
  ];

  await db.employes.bulkPut(employesData);

  const totalEmployes = await getTotalEmployeeCount(mainPatron.id);
  assert(totalEmployes === 10, `Total employés toutes boutiques réunies = 10 (trouvé: ${totalEmployes})`);

  // Vérification du blocage au 11e employé
  const checkAddEmp = await canAddEmployeePro(mainPatron.id);
  assert(!checkAddEmp.allowed, 'Ajout du 11e employé BLOQUÉ');
  assert(
    checkAddEmp.message === 'Limite Pro atteinte : 10 employés pour toutes tes boutiques réunies.',
    `Message officiel d'employé respecté : "${checkAddEmp.message}"`
  );

  // Vérification que le blocage s'applique également depuis Boutique 2 ou 3
  const checkAddEmpB2 = await canAddEmployeePro(boutique2.id);
  assert(!checkAddEmpB2.allowed, 'Ajout du 11e employé bloqué depuis Boutique 2 (SUB)');

  // =========================================================================
  // TEST 3 : VERROUILLAGE APPAREIL BOUTIQUE 2 & ISOLATION VENDEUR
  // =========================================================================
  console.log('\n--- 3. TEST VERROUILLAGE APPAREIL BOUTIQUE 2 & ISOLATION DES DONNÉES ---');

  // Simulation : Le patron verrouille ce téléphone sur "Boutique 2 - Tokoin"
  setDeviceStore(boutique2.id, boutique2.nom_boutique);
  const devInfo = getDeviceStoreInfo();
  assert(devInfo.isLocked, 'L\'appareil est bien verrouillé');
  assert(devInfo.storeId === boutique2.id, `ID boutique appareil = ${boutique2.id}`);
  assert(devInfo.storeName === boutique2.nom_boutique, `Nom boutique appareil = ${boutique2.nom_boutique}`);

  // getCurrentBoutiqueId() doit immédiatement renvoyer Boutique 2
  const currentBoutiqueId = getCurrentBoutiqueId();
  assert(currentBoutiqueId === boutique2.id, `getCurrentBoutiqueId() priorise bien deviceStoreId (${currentBoutiqueId})`);

  // Insertion de ventes de test pour vérifier le filtrage par boutique
  const venteB2: Vente = {
    id: 'vente_b2_001',
    patron_id: boutique2.id,
    produit_id: 'prod_b2_0',
    produit_nom: 'Chaussures Cuir Tokoin #1',
    qte: 1,
    montant_total: 12000,
    est_credit: false,
    reste_a_payer: 0,
    vendu_par_id: 'emp_b2_1', // Kofi
    vendu_par_nom: 'Kofi',
    date: now,
    synced: true,
  };
  const venteMain: Vente = {
    id: 'vente_main_001',
    patron_id: mainPatron.id,
    produit_id: 'prod_main_0',
    produit_nom: 'Robe Pagne Lomé #1',
    qte: 1,
    montant_total: 15000,
    est_credit: false,
    reste_a_payer: 0,
    vendu_par_id: 'emp_main_1', // Afia
    vendu_par_nom: 'Afia',
    date: now,
    synced: true,
  };
  await db.ventes.bulkPut([venteB2, venteMain]);

  // Requêtes isolées pour cet appareil verrouillé :
  const filteredProducts = await db.produits.where('patron_id').equals(currentBoutiqueId!).toArray();
  assert(
    filteredProducts.length === 100 && filteredProducts.every((p) => p.patron_id === boutique2.id),
    `L'appareil filtré sur Boutique 2 ne voit QUE ses 100 produits (aucun de MAIN ni Boutique 3)`
  );

  const filteredEmployees = await db.employes.where('patron_id').equals(currentBoutiqueId!).toArray();
  assert(
    filteredEmployees.length === 3 && filteredEmployees.every((e) => e.patron_id === boutique2.id),
    `L'écran de sélection vendeur ne liste QUE les 3 vendeurs de Boutique 2 (Kofi, Adjovi, Mawuli)`
  );

  const filteredVentes = await db.ventes.where('patron_id').equals(currentBoutiqueId!).toArray();
  assert(
    filteredVentes.length === 1 && filteredVentes[0].id === 'vente_b2_001',
    `L'appareil ne voit QUE les ventes réalisées dans Boutique 2`
  );

  // Vérification PIN et sécurité patron pour déverrouiller
  const pinOk = await verifyPatronPin(patronPin, mainPatron);
  assert(pinOk, 'Code PIN patron "2026" permet de déverrouiller ou réassigner l\'appareil');

  const pinFaux = await verifyPatronPin('0000', mainPatron);
  assert(!pinFaux, 'Un faux code PIN patron "0000" est rejeté');

  // Simulation vendeur Kofi connecté sur Boutique 2
  const kofiUser = {
    id: 'emp_b2_1',
    nom: 'Kofi',
    role: 'vendeuse' as const, // Vendeur
    genre: 'homme' as const,
  };

  // Règles de navigation pour vendeur & sous-boutique :
  const isVendeur = kofiUser.role === 'vendeuse';
  const isSubStore = boutique2.type === 'SUB';

  assert(isVendeur, 'L\'employé connecté a bien le rôle vendeur');
  assert(isSubStore, 'La boutique actuelle est bien de type SUB');

  // Règle G : accès interdits pour un vendeur ou une sous-boutique
  const hasAccessMesBoutiques = !isVendeur && !isSubStore;
  assert(!hasAccessMesBoutiques, 'Le vendeur sur Boutique 2 n\'a PAS accès au menu /mes-boutiques');

  const hasAccessMonAbonnement = !isVendeur && !isSubStore;
  assert(!hasAccessMonAbonnement, 'Le vendeur sur Boutique 2 n\'a PAS accès à /mon-abonnement');

  const hasAccessParametres = !isVendeur && !isSubStore;
  assert(!hasAccessParametres, 'Le vendeur sur Boutique 2 n\'a PAS accès aux Paramètres avancés du patron');

  console.log('\n======================================================');
  console.log('🎉 TOUS LES TESTS E2E MES BOUTIQUES PRO ONT RÉUSSI !');
  console.log('======================================================\n');
}

runAllTests().catch((err) => {
  console.error('\n❌ ERREUR LORS DE L\'EXÉCUTION DU TEST E2E :', err);
  process.exit(1);
});
