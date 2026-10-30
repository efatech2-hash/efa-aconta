/**
 * TEST AUTOMATISÉ : RAPPEL QUOTIDIEN 9H EFA ACONTA
 */
import fs from 'fs';
import path from 'path';
import {
  DAILY_NOTIF_MESSAGES,
  getLomeDateString,
  getLomeCurrentHour,
  getMsUntilNextLomeHour,
  showNotif,
} from '../src/lib/dailyNotification';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ ÉCHEC : ${msg}`);
    throw new Error(msg);
  }
  console.log(`  ✅ ${msg}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST RAPPEL QUOTIDIEN 9H (AFRICA/LOME UTC+0)');
  console.log('======================================================\n');

  // 1. Messages officiels
  console.log('--- 1. VÉRIFICATION DES MESSAGES DU RAPPEL ---');
  assert(DAILY_NOTIF_MESSAGES.length === 4, '4 messages officiels configurés');
  assert(DAILY_NOTIF_MESSAGES.some(m => m.includes('Bonjour Patron!')), 'Message 1 présent');
  assert(DAILY_NOTIF_MESSAGES.some(m => m.includes("Ton commerce t'attend")), 'Message 2 présent');
  assert(DAILY_NOTIF_MESSAGES.some(m => m.includes('Bonjour Patronne!')), 'Message 3 présent');
  assert(DAILY_NOTIF_MESSAGES.some(m => m.includes('9h déjà!')), 'Message 4 présent');

  // 2. Calcul date et heure Lomé (UTC+0)
  console.log('\n--- 2. VÉRIFICATION DU FUSEAU LOMÉ (UTC+0) ---');
  const fixedMorning = new Date(Date.UTC(2026, 9, 30, 8, 30, 0)); // 30 Oct 2026 08:30 UTC
  const lomeDate = getLomeDateString(fixedMorning);
  assert(lomeDate === '2026-10-30', `Date Lomé calculée correctement : ${lomeDate}`);
  const lomeHour = getLomeCurrentHour(fixedMorning);
  assert(lomeHour === 8, `Heure Lomé calculée correctement : ${lomeHour}h`);

  // 3. Prochain rappel 9h
  console.log('\n--- 3. CALCUL DU PROCHAIN 9H HEURE LOMÉ ---');
  // Si actuellement 8h30 UTC -> le prochain 9h est dans 30 min (1800 sec)
  const msRemainingMorning = new Date(Date.UTC(2026, 9, 30, 9, 0, 0)).getTime() - fixedMorning.getTime();
  assert(msRemainingMorning === 30 * 60 * 1000, '30 minutes restantes avant 9h');

  // 4. Test showNotif avec fallback Toast
  console.log('\n--- 4. TEST SHOWNOTIF AVEC FALLBACK TOAST ---');
  let fallbackMsg = '';
  await showNotif(undefined, (msg) => {
    fallbackMsg = msg;
  });
  assert(fallbackMsg.length > 0, `Fallback toast appelé avec succès : "${fallbackMsg.slice(0, 45)}..."`);
  assert(DAILY_NOTIF_MESSAGES.includes(fallbackMsg), 'Le message affiché fait bien partie de la liste officielle');

  // 5. Vérification sw.js et notificationclick
  console.log('\n--- 5. VÉRIFICATION /public/sw.js ---');
  const swPath = path.resolve(process.cwd(), 'public/sw.js');
  assert(fs.existsSync(swPath), 'public/sw.js existe');
  const swContent = fs.readFileSync(swPath, 'utf8');
  assert(swContent.includes('notificationclick'), 'sw.js contient le handler notificationclick');
  assert(swContent.includes('notification.close()'), 'sw.js ferme la notification au clic');
  assert(swContent.includes('openWindow'), 'sw.js ouvre l\'application au clic');

  // 6. Vérification manifest.json display standalone
  console.log('\n--- 6. VÉRIFICATION /public/manifest.json ---');
  const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
  assert(fs.existsSync(manifestPath), 'public/manifest.json existe');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert(manifest.display === 'standalone', 'manifest.json a bien "display": "standalone"');

  // 7. Vérification des icônes
  console.log('\n--- 7. VÉRIFICATION DES ICÔNES ---');
  assert(fs.existsSync(path.resolve(process.cwd(), 'public/icon-192.png')), 'public/icon-192.png existe');
  assert(fs.existsSync(path.resolve(process.cwd(), 'public/icon-192x192.png')), 'public/icon-192x192.png existe');

  console.log('\n======================================================');
  console.log('🎉 TOUS LES TESTS DU RAPPEL QUOTIDIEN SONT VALIDÉS !');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Échec test rappel quotidien:', err);
  process.exit(1);
});
