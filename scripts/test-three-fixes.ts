import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computeCreditSalePaidAmount } from '../src/lib/supabaseHelper';
import { PROFILE_PHOTOS_BUCKET } from '../src/lib/productStorage';
import { db } from '../src/lib/db';
import {
  getLimites,
  isBoutiquePro,
  canAddArticle,
  canAddVendeur,
  getActiveBoutiqueProductsCount,
  getRemainingTrialDays,
  isSubscriptionExpired,
} from '../src/lib/checkLimits';
import { checkAndGiveReferralBonus } from '../src/lib/ambassadeur';
import { COUNTRY_CODES, formatPhoneWithCountryCode, validatePhoneNumber } from '../src/lib/countryCodes';
import type { Patron } from '../src/lib/types';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}

async function runTests() {
  console.log('🧪 Running verification checks for all 3 fixes & existing invariants...');

  // 0. Invariants conservés (suppression crédit unique, logs_suppression, efa-photos, EmployeeId, upsertProduitSafely)
  assert.equal(
    computeCreditSalePaidAmount(
      { montant_total: 10000, reste_a_payer: 7000 },
      { montant_total: 10000, montant_paye: 3000, reste_a_payer: 7000 }
    ),
    3000
  );
  assert.equal(PROFILE_PHOTOS_BUCKET, 'efa-photos');

  const monArgentSrc = fs.readFileSync('src/components/MonArgentScreen.tsx', 'utf8');
  assert.ok(
    monArgentSrc.includes(".eq('id', targetCreditId)\n              .eq('boutique_id', currentBtqId)")
  );
  assert.ok(monArgentSrc.includes("'logs_suppression'") && monArgentSrc.includes('client_nom'));

  const addStockSrc = fs.readFileSync('src/components/AjouterStockScreen.tsx', 'utf8');
  assert.ok(addStockSrc.includes('upsertProduitSafely'));

  // 1. FIX 1 : Boutique sans photo (Paramètres, HeaderNav, HomeScreen)
  const settingsSrc = fs.readFileSync('src/components/SettingsModal.tsx', 'utf8');
  assert.equal(
    settingsSrc.includes('Photo de la boutique'),
    false,
    'SettingsModal must NOT have Photo de la boutique field'
  );
  assert.equal(
    settingsSrc.includes('handleSaveBoutiqueBloc'),
    true,
    'SettingsModal must keep handleSaveBoutiqueBloc + Modifier button'
  );
  assert.equal(
    settingsSrc.includes('boutiques.photo_devanture') || settingsSrc.includes('boutiquePhoto'),
    false,
    'SettingsModal must NOT contain boutique photo state or upload'
  );

  const headerSrc = fs.readFileSync('src/components/HeaderNav.tsx', 'utf8');
  assert.equal(
    headerSrc.includes('photo_devanture'),
    false,
    'HeaderNav must NOT fallback to boutique photo_devanture'
  );

  const homeSrc = fs.readFileSync('src/components/HomeScreen.tsx', 'utf8');
  assert.equal(
    homeSrc.includes('boutiquePhotoUrl') || homeSrc.includes('Photo de la boutique'),
    false,
    'HomeScreen must NOT render boutique photo'
  );

  // 2. FIX 2 : Limites exactes + règle dépassement strict + comptage boutique active sans supprimés + date_inscription
  const essaiLim = getLimites('essai');
  assert.deepEqual(
    { maxArticles: essaiLim.maxArticles, maxVendeurs: essaiLim.maxVendeurs, maxBoutiques: essaiLim.maxBoutiques },
    { maxArticles: 7, maxVendeurs: 1, maxBoutiques: 1 }
  );

  const popLim = getLimites('populaire');
  assert.deepEqual(
    {
      maxArticles: popLim.maxArticles,
      maxVendeurs: popLim.maxVendeurs,
      maxAppareils: popLim.maxAppareils,
      maxBoutiques: popLim.maxBoutiques,
    },
    { maxArticles: 100, maxVendeurs: 3, maxAppareils: 3, maxBoutiques: 1 }
  );

  const proLim = getLimites('pro');
  assert.deepEqual(
    {
      maxArticles: proLim.maxArticles,
      maxVendeurs: proLim.maxVendeurs,
      maxAppareils: proLim.maxAppareils,
      maxBoutiques: proLim.maxBoutiques,
    },
    { maxArticles: 300, maxVendeurs: 10, maxAppareils: 5, maxBoutiques: 3 }
  );

  // Populaire must NEVER be classified as Pro
  const popPatron: Patron = {
    id: 'btq_pop_1',
    nom: 'Aminata',
    nom_boutique: 'Boutique Pop',
    telephone: '+22890000001',
    pin_code: '1234',
    pin_hash: 'h',
    genre: 'femme',
    role: 'patron',
    abonnement_expire: new Date(Date.now() + 365 * 86400000).toISOString(),
    subscription_status: 'populaire',
    current_plan: 'populaire',
    created_at: new Date().toISOString(),
    date_inscription: new Date().toISOString(),
  };
  assert.equal(isBoutiquePro(popPatron), false, 'Populaire must NOT be treated as Pro');

  // Strict blocking: 1..7 pass, 8th blocks in essai; 1..100 pass, 101st blocks in populaire; 1..300 pass, 301st blocks in pro
  const essaiPatron: Patron = {
    ...popPatron,
    id: 'btq_essai_1',
    subscription_status: 'trial',
    current_plan: 'trial',
    date_inscription: new Date(Date.now() - 5 * 86400000).toISOString(),
  };
  assert.equal(canAddArticle(essaiPatron, 6), true, 'Essai: 7th article (count=6) MUST pass');
  assert.equal(canAddArticle(essaiPatron, 7), false, 'Essai: 8th article (count=7) MUST block');
  assert.equal(canAddVendeur(essaiPatron, 0), true, 'Essai: 1st vendeur (count=0) MUST pass');
  assert.equal(canAddVendeur(essaiPatron, 1), false, 'Essai: 2nd vendeur (count=1) MUST block');

  assert.equal(canAddArticle(popPatron, 99), true, 'Populaire: 100th article (count=99) MUST pass');
  assert.equal(canAddArticle(popPatron, 100), false, 'Populaire: 101st article (count=100) MUST block');
  assert.equal(canAddVendeur(popPatron, 2), true, 'Populaire: 3rd vendeur (count=2) MUST pass');
  assert.equal(canAddVendeur(popPatron, 3), false, 'Populaire: 4th vendeur (count=3) MUST block');

  const proPatron: Patron = {
    ...popPatron,
    id: 'btq_pro_1',
    subscription_status: 'pro',
    current_plan: 'pro',
    isProActive: true,
  };
  assert.equal(canAddArticle(proPatron, 299), true, 'Pro: 300th article (count=299) MUST pass');
  assert.equal(canAddArticle(proPatron, 300), false, 'Pro: 301st article (count=300) MUST block');
  assert.equal(canAddVendeur(proPatron, 9), true, 'Pro: 10th vendeur (count=9) MUST pass');
  assert.equal(canAddVendeur(proPatron, 10), false, 'Pro: 11th vendeur (count=10) MUST block');

  // Trial days calculated strictly from patrons.date_inscription (21 days), NOT secondary boutique created_at
  const subTrialPatron: Patron = {
    ...essaiPatron,
    id: 'btq_sub_should_use_main_date',
    parentId: 'btq_essai_1',
    type: 'SUB',
    date_inscription: new Date(Date.now() - 22 * 86400000).toISOString(), // inscribed 22 days ago => expired!
    created_at: new Date().toISOString(), // sub created today
  };
  assert.equal(getRemainingTrialDays(subTrialPatron), 0, 'Trial must expire after 21d from patrons.date_inscription');
  assert.equal(isSubscriptionExpired(subTrialPatron), true, 'Trial past 21d from date_inscription must be expired');

  // Product counting strictly scoped to active boutique & excluding deleted
  await db.produits.clear();
  localStorage.clear();
  localStorage.setItem('efa_device_boutique', JSON.stringify(essaiPatron));
  await db.produits.bulkPut([
    { id: 'p1', patron_id: essaiPatron.id, boutique_id: essaiPatron.id, nom: 'A1', photo_url: '', categorie: 'Cat', prix_vente: 100, prix_achat: 50, stock_qte: 1, seuil_alerte: 1, created_at: new Date().toISOString() },
    { id: 'p2_del', patron_id: essaiPatron.id, boutique_id: essaiPatron.id, nom: 'A2', photo_url: '', categorie: 'Cat', prix_vente: 100, prix_achat: 50, stock_qte: 1, seuil_alerte: 1, status: 'deleted', created_at: new Date().toISOString() },
    { id: 'p3_isdel', patron_id: essaiPatron.id, boutique_id: essaiPatron.id, nom: 'A3', photo_url: '', categorie: 'Cat', prix_vente: 100, prix_achat: 50, stock_qte: 1, seuil_alerte: 1, is_deleted: true, created_at: new Date().toISOString() },
    { id: 'p4_other', patron_id: essaiPatron.id, boutique_id: 'btq_sub_other', nom: 'A4', photo_url: '', categorie: 'Cat', prix_vente: 100, prix_achat: 50, stock_qte: 1, seuil_alerte: 1, created_at: new Date().toISOString() },
  ]);
  const activeCount = await getActiveBoutiqueProductsCount(essaiPatron);
  assert.equal(activeCount, 1, 'Must count ONLY active non-deleted products of current active boutique');

  // 3. FIX 3 : Parrainage (1 seule fois par patron principal, jamais pour btq_sub_)
  const subBonusAttempt = await checkAndGiveReferralBonus({
    id: 'btq_sub_999',
    plan: 'pro_annuel',
    last_payment_amount: 90000,
    duration_days: 365,
    referred_by: 'EFA-PARR1',
  });
  assert.equal(subBonusAttempt.success, false, 'Secondary boutique btq_sub_ must NEVER grant referral bonus');

  const ambSrc = fs.readFileSync('src/lib/ambassadeur.ts', 'utf8');
  assert.ok(
    ambSrc.includes("filleul.id.startsWith('btq_sub_')") &&
      ambSrc.includes('alreadyRewardedParr') &&
      ambSrc.includes('mainFilleulId'),
    'ambassadeur.ts must enforce pre-RPC deduplication & main patron ID only'
  );

  // 4. FIX 4-POINTS : Inscription Photo Patron + Genre + Indicatifs WhatsApp + Paramètres Boutique Nom+Modifier
  const welcomeSrc = fs.readFileSync('src/components/WelcomeAuthScreen.tsx', 'utf8');
  assert.ok(
    welcomeSrc.includes('Télécharger') &&
      welcomeSrc.includes('Prendre photo') &&
      welcomeSrc.includes('pickPhotoFromGallery') &&
      welcomeSrc.includes('takePhotoFromCamera'),
    'WelcomeAuthScreen must have Photo patron with Télécharger + Prendre photo buttons using employee method'
  );
  assert.ok(
    welcomeSrc.includes('COUNTRY_CODES') && welcomeSrc.includes("'+228'"),
    'WelcomeAuthScreen must render WhatsApp country dropdown defaulting to +228'
  );

  const requiredCodes = ['+228', '+225', '+229', '+233', '+234', '+221', '+33', '+1'];
  for (const code of requiredCodes) {
    assert.ok(
      COUNTRY_CODES.some((c) => c.code === code),
      `COUNTRY_CODES must include ${code}`
    );
  }
  assert.equal(COUNTRY_CODES[0].code, '+228', '+228 must be first/default country code');

  const fmt1 = formatPhoneWithCountryCode('90123456', '+234');
  assert.equal(fmt1.full, '+23490123456');
  assert.equal(fmt1.localDigits, '90123456');
  assert.equal(fmt1.country, '+234');

  const fmt2 = formatPhoneWithCountryCode('+228 90 12 34 56', '+228');
  assert.equal(fmt2.full, '+22890123456');
  assert.equal(fmt2.localDigits, '90123456');
  assert.equal(validatePhoneNumber('90 12 34 56', '+228'), true);

  assert.ok(
    homeSrc.includes("'Bienvenue Patron'") && homeSrc.includes("'Bienvenue Patronne'"),
    'HomeScreen must compute Bienvenue Patron / Bienvenue Patronne dynamically from genre'
  );
  assert.ok(
    headerSrc.includes("'Bienvenue Patron'") && headerSrc.includes("'Bienvenue Patronne'"),
    'HeaderNav must compute Bienvenue Patron / Bienvenue Patronne dynamically from genre'
  );

  const deviceAuthSrc = fs.readFileSync('src/lib/deviceAuth.ts', 'utf8');
  assert.ok(
    deviceAuthSrc.includes('uploadProfilePhoto') &&
      deviceAuthSrc.includes('photo_profil: uploadedPatronPhoto') &&
      deviceAuthSrc.includes('genre: finalGenre'),
    'deviceAuth.ts must upload patron photo and save photo_profil + genre into patrons'
  );

  const appSrc = fs.readFileSync('src/App.tsx', 'utf8');
  assert.ok(
    appSrc.includes('remotePatron?.genre') && appSrc.includes('freshGenre'),
    'App.tsx loadDatabase must preserve patrons.genre cleanly'
  );

  // 5. NOUVEAUX 4 POINTS : Dashboard footer, Parrain seul +60j, Super Admin sans conversion POPULAIRE->PRO, Connexion responsive
  assert.ok(
    homeSrc.includes('EFA Aconta by') &&
      homeSrc.includes('EFA Technologie') &&
      homeSrc.includes('Donnez mon avis') &&
      homeSrc.includes('https://efa-technologie.vercel.app'),
    'HomeScreen footer must include EFA Aconta by EFA Technologie + Donnez mon avis linking to efa-technologie.vercel.app'
  );

  const serverSrc = fs.readFileSync('server.ts', 'utf8');
  const sqlSrc = fs.readFileSync('supabase/migrations/20261112_000004_referral_parrain_only.sql', 'utf8');
  assert.equal(
    ambSrc.includes('filleulNewEnd') || serverSrc.includes('fNewEnd'),
    false,
    'ambassadeur.ts and server.ts must NEVER extend filleul expiration (+60j is parrain only)'
  );
  assert.ok(
    ambSrc.includes(".from('parrainage')") &&
      ambSrc.includes(".eq('filleul_id', mainFilleulId)") &&
      serverSrc.includes(".from('parrainage')") &&
      sqlSrc.includes("LIKE 'btq_sub_%'"),
    'Referral bonus must verify parrainage WHERE filleul_id = patron_principal and exclude btq_sub_'
  );

  // PROLONGE must NEVER turn Populaire into Pro
  const prolongPatron: Patron = {
    ...popPatron,
    id: 'btq_prolong_1',
    subscription_status: 'populaire',
    current_plan: 'PROLONGE' as any,
    forfait: 'PROLONGE',
  };
  assert.equal(isBoutiquePro(prolongPatron), false, 'PROLONGE forfait must NEVER be classified as Pro');
  assert.equal(getLimites('PROLONGE').plan, 'populaire', 'getLimites(PROLONGE) must resolve to populaire (100/3/3/1)');
  assert.equal(serverSrc.includes("forfait: 'PROLONGE'") || fs.readFileSync('src/components/SuperAdminScreen.tsx', 'utf8').includes("plan: 'PROLONGE'") || fs.readFileSync('src/pages/EfaAdmin.tsx', 'utf8').includes("forfait: 'PROLONGE'"), false, 'Prolongation must preserve real plan instead of writing PROLONGE');

  const superAdminSrc = fs.readFileSync('src/components/SuperAdminScreen.tsx', 'utf8');
  assert.ok(
    superAdminSrc.includes("handleActivateBoutique(b, 365, 16500, 'POPULAIRE 1 AN (16.500 F)', 'populaire')") &&
      superAdminSrc.includes("handleActivateBoutique(b, 180, 50000, 'PRO 6 MOIS (50.000 F)', 'pro_6mois')") &&
      superAdminSrc.includes("handleActivateBoutique(b, 365, 90000, 'PRO 1 AN (90.000 F)', 'pro_annuel')"),
    'SuperAdmin must send exact plan/duration for Populaire (365/populaire), Pro 6 mois (180/pro_6mois), and Pro 1 An (365/pro_annuel)'
  );

  assert.ok(
    welcomeSrc.includes('min-h-[100dvh]') &&
      welcomeSrc.includes('overflow-x-hidden') &&
      welcomeSrc.includes('lg:grid-cols-12'),
    'WelcomeAuthScreen must have responsive mobile+desktop layout classes'
  );

  // 6. PWA INSTALLABLE + SECTION TÉLÉCHARGEMENT ACCUEIL + TWA PLAY STORE
  const manifest = JSON.parse(fs.readFileSync('public/manifest.json', 'utf8'));
  assert.equal(manifest.name, 'EFA Aconta');
  assert.equal(manifest.short_name, 'EFA Aconta');
  assert.equal(manifest.description, 'Application de gestion pour boutiques, artisans et commerçants');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.theme_color, '#1E3A8A');
  assert.equal(manifest.background_color, '#1E3A8A');

  const iconEntries: Array<{ src: string; sizes: string; purpose?: string }> = manifest.icons || [];
  assert.ok(iconEntries.some((i) => i.sizes === '192x192' && i.purpose === 'any'));
  assert.ok(iconEntries.some((i) => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(iconEntries.some((i) => i.sizes === '192x192' && i.purpose === 'maskable'));
  assert.ok(iconEntries.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
  for (const i of iconEntries) {
    assert.ok(fs.existsSync(`public${i.src}`), `Icon file missing: public${i.src}`);
  }

  const swSrc = fs.readFileSync('public/sw.js', 'utf8');
  assert.ok(
    swSrc.includes('supabase.co') &&
      swSrc.includes("'/api/'") &&
      swSrc.includes("'/auth/'") &&
      swSrc.includes("req.method !== 'GET'"),
    'sw.js must never intercept Supabase, auth, API, or non-GET requests'
  );

  const assetLinks = JSON.parse(fs.readFileSync('public/.well-known/assetlinks.json', 'utf8'));
  assert.equal(assetLinks[0]?.target?.namespace, 'android_app');
  assert.equal(assetLinks[0]?.target?.package_name, 'com.efa.technologie.aconta');
  assert.ok(assetLinks[0]?.relation?.includes('delegate_permission/common.handle_all_urls'));

  const pwaHookSrc = fs.readFileSync('src/lib/usePWAInstall.ts', 'utf8');
  const pwaBtnSrc = fs.readFileSync('src/components/PWAInstallButton.tsx', 'utf8');
  assert.ok(pwaHookSrc.includes('beforeinstallprompt') && pwaHookSrc.includes('appinstalled'));
  assert.ok(pwaBtnSrc.includes("Installer l'application") && headerSrc.includes('PWAInstallButton'));
  assert.ok(
    welcomeSrc.includes("Télécharger l'application EFA Aconta") &&
      welcomeSrc.includes('Télécharger sur Google Play') &&
      welcomeSrc.includes("Installer l'application Web") &&
      !welcomeSrc.includes('APK direct') &&
      !welcomeSrc.includes('.apk'),
    'WelcomeAuthScreen must display Google Play + Web App download buttons and NEVER direct APK download'
  );

  console.log('✅ ALL VERIFICATION & REGRESSION TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Test failure:', err);
  process.exit(1);
});
