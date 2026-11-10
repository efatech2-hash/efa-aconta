/**
 * TEST COMPLET DE VALIDATION SÉCURITÉ FORTERESSE - EFA ACONTA
 */
import fs from 'fs';
import path from 'path';
import { validateImageFile, escapeHtml, sanitizeInput } from '../src/lib/security';
import { ProductSchema, SaleSchema, EmployeeSchema, AdminLoginSchema, AdminActivateBoutiqueSchema } from '../src/lib/serverValidation';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ÉCHEC ASSERTION: ${msg}`);
    throw new Error(msg);
  }
  console.log(`  ✅ ${msg}`);
}

async function runSecurityTests() {
  console.log('\n======================================================');
  console.log('🛡️  TEST DE SÉCURITÉ FORTERESSE - EFA ACONTA');
  console.log('======================================================\n');

  // 1. VÉRIFICATION DE L'ABSENCE DE CLÉS ET MOTS DE PASSE EN DUR
  console.log('--- 1. SCAN SECRETS & CLÉS EN DUR ---');
  const filesToScan = [
    'src/lib/supabase.js',
    'src/integrations/supabase/client.ts',
    'src/components/SuperAdminScreen.tsx',
    'server.ts',
  ];

  for (const f of filesToScan) {
    const fullPath = path.resolve(process.cwd(), f);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      assert(!content.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS'), `${f} ne contient plus le token JWT anon en dur`);
      assert(!content.includes('2hcetafe'), `${f} ne contient plus le mot de passe admin en dur`);
      assert(!content.includes('efatech2@gmail.com'), `${f} ne contient plus l'email admin en clair`);
    }
  }

  // 2. VÉRIFICATION VALIDATION SERVEUR ZOD (PRIX NÉGATIFS, INJECTIONS)
  console.log('\n--- 2. VALIDATION SERVEUR & SCHÉMAS ZOD ---');
  
  // Test prix négatif
  const invalidPriceResult = ProductSchema.safeParse({
    patron_id: 'patron_123',
    nom: 'Robe Wax',
    prix_achat: 1000,
    prix_vente: -500, // Invalide !
    stock_qte: 10,
  });
  assert(!invalidPriceResult.success, 'Rejet immédiat d\'un produit avec prix de vente négatif (-500)');

  // Test quantité absurde
  const invalidStockResult = ProductSchema.safeParse({
    patron_id: 'patron_123',
    nom: 'Savon',
    prix_vente: 500,
    stock_qte: 50_000_000, // Dépassant 1M
  });
  assert(!invalidStockResult.success, 'Rejet immédiat d\'un stock déraisonnable (> 1 000 000)');

  // Test injection de script dans le nom du produit
  const scriptNameResult = ProductSchema.safeParse({
    patron_id: 'patron_123',
    nom: '<script>alert("hack")</script>Tissu Soie',
    prix_vente: 5000,
  });
  assert(scriptNameResult.success, 'Le schéma a parsé et nettoyé les balises scripts');
  if (scriptNameResult.success) {
    assert(!scriptNameResult.data.nom.includes('<script>'), 'Balise script XSS purgée du nom du produit');
  }

  // Test code PIN employé (doit être 4 chiffres)
  const invalidPinResult = EmployeeSchema.safeParse({
    patron_id: 'patron_123',
    nom: 'Afi',
    code_pin: '12345', // 5 chiffres => rejeté
  });
  assert(!invalidPinResult.success, 'Rejet d\'un code PIN employé invalide (non 4 chiffres)');

  const validPinResult = EmployeeSchema.safeParse({
    patron_id: 'patron_123',
    nom: 'Afi',
    code_pin: '7890',
  });
  assert(validPinResult.success, 'Acceptation d\'un code PIN employé valide à 4 chiffres');

  // 3. VÉRIFICATION DÉSINFECTION XSS
  console.log('\n--- 3. TEST DÉSINFECTION XSS & ÉCHAPPEMENT ---');
  const rawXss = '<img src=x onerror=alert(1)>';
  const escaped = escapeHtml(rawXss);
  assert(escaped === '&lt;img src=x onerror=alert(1)&gt;', 'Échappement correct des chevrons HTML');

  const sanitized = sanitizeInput('<script>steal()</script>Bonjour');
  assert(sanitized === 'Bonjour', 'Sanitization supprime les scripts injectés');

  // 4. VÉRIFICATION MAGIC BYTES & FICHIERS MALVEILLANTS
  console.log('\n--- 4. TEST MAGIC BYTES & BLOCAGE EXÉCUTABLES ---');
  // Fichier malware renommé
  const fakeFile = new File([new Uint8Array([0x4D, 0x5A])], 'virus.exe', { type: 'application/x-msdownload' });
  const fakeResult = await validateImageFile(fakeFile);
  assert(!fakeResult.valid, 'Fichier .exe immédiatement bloqué');

  // Fichier PNG sans les bons magic bytes
  const corruptedPng = new File([new Uint8Array([0x00, 0x00, 0x00, 0x00])], 'fake.png', { type: 'image/png' });
  const corruptedResult = await validateImageFile(corruptedPng);
  assert(!corruptedResult.valid, 'Fichier binaire corrompu / faux PNG rejeté');

  // Fichier WebP avec magic bytes valides
  const validWebpBuffer = new Uint8Array(32);
  // RIFF
  validWebpBuffer[0] = 0x52; validWebpBuffer[1] = 0x49; validWebpBuffer[2] = 0x46; validWebpBuffer[3] = 0x46;
  // WEBP
  validWebpBuffer[8] = 0x57; validWebpBuffer[9] = 0x45; validWebpBuffer[10] = 0x42; validWebpBuffer[11] = 0x50;
  const validWebpFile = new File([validWebpBuffer], 'good.webp', { type: 'image/webp' });
  const validResult = await validateImageFile(validWebpFile);
  assert(validResult.valid && validResult.detectedType === 'image/webp', 'Fichier WebP authentique validé par magic bytes');

  // 5. VÉRIFICATION MIGRATION SQL RLS
  console.log('\n--- 5. CONTRÔLE DE LA MIGRATION RLS FORTERESSE ---');
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261027_000001_security_fortress_rls.sql');
  assert(fs.existsSync(migrationPath), 'Fichier de migration RLS présent dans supabase/migrations/');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  assert(migrationSql.includes('ALTER TABLE public.patrons ENABLE ROW LEVEL SECURITY;'), 'RLS activé sur patrons');
  assert(migrationSql.includes('ALTER TABLE public.produits ENABLE ROW LEVEL SECURITY;'), 'RLS activé sur produits');
  assert(migrationSql.includes('ALTER TABLE public.ventes ENABLE ROW LEVEL SECURITY;'), 'RLS activé sur ventes');
  assert(migrationSql.includes('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;'), 'RLS activé sur storage.objects');
  assert(migrationSql.includes("bucket_id = 'efa-aconta-produits'"), 'Politique de bucket efa-aconta-produits configurée');

  console.log('\n======================================================');
  console.log('🎉 TOUS LES TESTS SÉCURITÉ FORTERESSE SONT VALIDÉS !');
  console.log('======================================================\n');
}

runSecurityTests().catch((err) => {
  console.error('❌ Échec du test sécurité :', err);
  process.exit(1);
});
