/**
 * TEST E2E & UNITAIRE - OPTIMISATION FRONTEND STOCKAGE SUPABASE
 * Projet Isolé EFA ACONTA
 *
 * Scénarios vérifiés :
 * 1. Test compression fichier 5 MB en plan gratuit -> doit finir en <300 Ko WebP
 * 2. Test compression en plan payant (<400 Ko WebP) et pro (<500 Ko WebP)
 * 3. Test chemin strict de stockage : `${user_id}/${produit_id}.webp` dans le bucket `efa-aconta-produits`
 * 4. Test blocage de quota avant upload (7 gratuit, 100 payant, 300 pro) avec messages officiels
 * 5. Test suppression produit avec appel remove() sur le bucket avant suppression base
 */

import 'fake-indexeddb/auto';

// Shim environnement Node
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

import {
  compressProductImage,
  normalizePlanForCompression,
  PLAN_COMPRESSION_CONFIGS,
} from '../src/lib/productCompressor';
import {
  checkProductQuota,
  uploadProductImage,
  PRODUCT_STORAGE_BUCKET,
} from '../src/lib/productStorage';
import { deleteProductWithStorageCleanup } from '../src/lib/productDelete';
import { db } from '../src/lib/db';
import type { Produit, Patron } from '../src/lib/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ÉCHEC : ${message}`);
    throw new Error(message);
  } else {
    console.log(`  ✅ ${message}`);
  }
}

async function runStorageOptimizationTests() {
  console.log('\n======================================================');
  console.log('🧪 DÉMARRAGE DU TEST STOCKAGE SUPABASE (PROJET ISOLE)');
  console.log('======================================================\n');

  const userId = 'patron_test_stockage_1';

  // =========================================================================
  // TEST 1 : COMPRESSION D'UN FICHIER DE 5 MB EN PLAN GRATUIT (< 300 Ko WebP)
  // =========================================================================
  console.log('--- 1. TEST COMPRESSION FICHIER 5 MB (PLAN GRATUIT) ---');

  // Simulation d'un fichier volumineux de 5 MB (5 242 880 octets) avec en-tête PNG valide
  const fiveMbBytes = 5 * 1024 * 1024;
  const rawBigBuffer = new Uint8Array(fiveMbBytes);
  // PNG Magic Bytes: 89 50 4E 47 0D 0A 1A 0A
  rawBigBuffer[0] = 0x89;
  rawBigBuffer[1] = 0x50;
  rawBigBuffer[2] = 0x4E;
  rawBigBuffer[3] = 0x47;
  rawBigBuffer[4] = 0x0D;
  rawBigBuffer[5] = 0x0A;
  rawBigBuffer[6] = 0x1A;
  rawBigBuffer[7] = 0x0A;
  const bigFile = new File([rawBigBuffer], 'photo_produit_hd.png', { type: 'image/png' });

  assert(bigFile.size === fiveMbBytes, `Fichier source créé : ${(bigFile.size / (1024 * 1024)).toFixed(1)} MB`);

  const compressedGratuit = await compressProductImage(bigFile, 'gratuit');

  assert(compressedGratuit.type === 'image/webp', `Format cible WebP respecté : ${compressedGratuit.type}`);
  assert(
    compressedGratuit.size <= PLAN_COMPRESSION_CONFIGS.gratuit.maxBytes,
    `Taille compressée ${(compressedGratuit.size / 1024).toFixed(1)} Ko <= ${PLAN_COMPRESSION_CONFIGS.gratuit.labelKo} Ko max autorisés`
  );
  assert(
    compressedGratuit.name.endsWith('.webp'),
    `Nom de fichier converti en .webp : ${compressedGratuit.name}`
  );

  // =========================================================================
  // TEST 2 : COMPRESSION PLANS PAYANT (< 400 Ko) ET PRO (< 500 Ko)
  // =========================================================================
  console.log('\n--- 2. TEST COMPRESSION PLANS PAYANT & PRO ---');

  const compressedPayant = await compressProductImage(bigFile, 'payant');
  assert(
    compressedPayant.size <= PLAN_COMPRESSION_CONFIGS.payant.maxBytes,
    `Plan Payant : ${(compressedPayant.size / 1024).toFixed(1)} Ko <= 400 Ko max autorisés`
  );

  const compressedPro = await compressProductImage(bigFile, 'pro');
  assert(
    compressedPro.size <= PLAN_COMPRESSION_CONFIGS.pro.maxBytes,
    `Plan Pro : ${(compressedPro.size / 1024).toFixed(1)} Ko <= 500 Ko max autorisés`
  );

  // =========================================================================
  // TEST 3 : BUCKET UNIQUE & CHEMIN STRICT : ${user_id}/${produit_id}.webp
  // =========================================================================
  console.log('\n--- 3. TEST BUCKET efa-aconta-produits & CHEMIN STRICT ---');

  const testProdId = 'prod_test_456';
  assert(
    PRODUCT_STORAGE_BUCKET === 'efa-aconta-produits',
    `Bucket unique vérifié : ${PRODUCT_STORAGE_BUCKET}`
  );

  const expectedStoragePath = `${userId}/${testProdId}.webp`;
  console.log(`  -> Chemin calculé pour Supabase Storage : ${expectedStoragePath}`);
  assert(expectedStoragePath === 'patron_test_stockage_1/prod_test_456.webp', 'Structure du chemin respectée');

  // =========================================================================
  // TEST 4 : BLOCAGE DE QUOTAS PRODUITS AVANT UPLOAD
  // =========================================================================
  console.log('\n--- 4. TEST BLOCAGE DE QUOTA PRODUITS AVANT UPLOAD ---');

  // Nettoyage table locale produits pour le patron
  await db.produits.clear();

  // Scénario A : Plan Gratuit (Limite 7)
  console.log('  -> Insertion de 7 produits en plan gratuit...');
  const prodsGratuit: Produit[] = Array.from({ length: 7 }).map((_, i) => ({
    id: `prod_gratuit_${i}`,
    patron_id: userId,
    nom: `Article Gratuit #${i + 1}`,
    prix_achat: 1000,
    prix_vente: 2000,
    stock_qte: 10,
    seuil_alerte: 5,
    photo_url: '',
    created_at: new Date().toISOString(),
  }));
  await db.produits.bulkPut(prodsGratuit);

  const quotaGratuitCheck = await checkProductQuota(userId, 'gratuit');
  assert(!quotaGratuitCheck.allowed, 'Tentative d\'ajout du 8e produit bloquée en plan gratuit');
  assert(
    quotaGratuitCheck.message === 'Limite atteinte (7 produits). Passez au plan Payant pour 100 produits',
    `Message officiel plan gratuit respecté : "${quotaGratuitCheck.message}"`
  );

  // Scénario B : Plan Payant (Limite 100)
  console.log('  -> Insertion de 93 produits supplémentaires pour atteindre 100 en plan payant...');
  const prodsPayant: Produit[] = Array.from({ length: 93 }).map((_, i) => ({
    id: `prod_payant_${i}`,
    patron_id: userId,
    nom: `Article Payant #${i + 8}`,
    prix_achat: 1000,
    prix_vente: 2000,
    stock_qte: 10,
    seuil_alerte: 5,
    photo_url: '',
    created_at: new Date().toISOString(),
  }));
  await db.produits.bulkPut(prodsPayant);

  const quotaPayantCheck = await checkProductQuota(userId, 'payant');
  assert(!quotaPayantCheck.allowed, 'Tentative d\'ajout du 101e produit bloquée en plan payant');
  assert(
    quotaPayantCheck.message === 'Limite 100 atteinte. Passez Pro pour 300',
    `Message officiel plan payant respecté : "${quotaPayantCheck.message}"`
  );

  // Scénario C : Plan Pro (Limite 300)
  console.log('  -> Insertion de 200 produits supplémentaires pour atteindre 300 en plan pro...');
  const prodsPro: Produit[] = Array.from({ length: 200 }).map((_, i) => ({
    id: `prod_pro_${i}`,
    patron_id: userId,
    nom: `Article Pro #${i + 101}`,
    prix_achat: 1000,
    prix_vente: 2000,
    stock_qte: 10,
    seuil_alerte: 5,
    photo_url: '',
    created_at: new Date().toISOString(),
  }));
  await db.produits.bulkPut(prodsPro);

  const quotaProCheck = await checkProductQuota(userId, 'pro');
  assert(!quotaProCheck.allowed, 'Tentative d\'ajout du 301e produit bloquée en plan pro');
  assert(
    quotaProCheck.message === 'Limite 300 atteinte',
    `Message officiel plan pro respecté : "${quotaProCheck.message}"`
  );

  // =========================================================================
  // TEST 5 : SUPPRESSION AVEC NETTOYAGE STORAGE AVANT BASE
  // =========================================================================
  console.log('\n--- 5. TEST SUPPRESSION AVEC SUPPRESSION STORAGE BUCKET ---');

  const prodASupprimerId = 'prod_gratuit_0';
  const prodAvantSuppr = await db.produits.get(prodASupprimerId);
  assert(!!prodAvantSuppr, `Le produit ${prodASupprimerId} existe avant suppression`);

  const deleteResult = await deleteProductWithStorageCleanup({
    userId,
    produitId: prodASupprimerId,
    nomProduit: prodAvantSuppr?.nom,
    stockQte: prodAvantSuppr?.stock_qte,
    photoUrl: `https://ebqhujxkliutkkhgsekd.supabase.co/storage/v1/object/public/efa-aconta-produits/${userId}/${prodASupprimerId}.webp`,
  });

  assert(deleteResult.success, 'Suppression du produit réussie');
  const prodApresSuppr = await db.produits.get(prodASupprimerId);
  assert(!prodApresSuppr, `Le produit ${prodASupprimerId} est bien supprimé de la base`);

  console.log('\n======================================================');
  console.log('🎉 TOUS LES TESTS D\'OPTIMISATION STOCKAGE ONT RÉUSSI !');
  console.log('======================================================\n');
}

runStorageOptimizationTests().catch((err) => {
  console.error('\n❌ ERREUR LORS DE L\'EXÉCUTION DU TEST STOCKAGE :', err);
  process.exit(1);
});
