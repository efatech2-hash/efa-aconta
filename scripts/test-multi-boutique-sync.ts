import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { boutiqueToPatron } from '../src/lib/deviceAuth';
import {
  getMainPatronIdSync,
  buildCreditSupabasePayload,
  buildDepenseSupabasePayload,
} from '../src/lib/supabaseHelper';
import { generatePrefixedId } from '../src/lib/uuid';

dotenv.config();

const supabaseUrl = (process.env.VITE_SUPABASE_URL || 'https://ebqhujxkliutkkhgsekd.supabase.co').trim();
const supabaseKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();

function runUnitContractTests() {
  console.log('1. Running multi-store contract & schema column verification...');

  const mainBtqId = 'btq_test_main_' + Date.now().toString(36);
  const sub2Id = 'btq_sub_test2_' + Date.now().toString(36);
  const sub3Id = 'btq_sub_test3_' + Date.now().toString(36);

  const p1 = boutiqueToPatron({
    id: mainBtqId,
    nom_boutique: 'Boutique 1',
    proprietaire: 'Malik',
    patron_id: mainBtqId,
    plan: 'pro',
    status: 'active',
    created_at: new Date().toISOString(),
  });

  const p2 = boutiqueToPatron({
    id: sub2Id,
    nom_boutique: 'Boutique 2',
    proprietaire: 'Malik',
    patron_id: mainBtqId,
    plan: 'pro',
    status: 'active',
    created_at: new Date().toISOString(),
  });

  const p3 = boutiqueToPatron({
    id: sub3Id,
    nom_boutique: 'Boutique 3',
    proprietaire: 'Malik',
    patron_id: mainBtqId,
    plan: 'pro',
    status: 'active',
    created_at: new Date().toISOString(),
  });

  assert.equal(p1.type, 'MAIN');
  assert.equal(p2.type, 'SUB');
  assert.equal(p3.type, 'SUB');
  assert.equal(getMainPatronIdSync(p1), mainBtqId);
  assert.equal(getMainPatronIdSync(p2), mainBtqId);
  assert.equal(getMainPatronIdSync(p3), mainBtqId);

  const nowIso = new Date().toISOString();

  // Verify credits payload columns: montant_total, montant_paye, reste_a_payer, dernier_paiement (NO montant, NO created_at)
  const creditPayload = buildCreditSupabasePayload({
    id: generatePrefixedId('crd'),
    patron_id: getMainPatronIdSync(p2),
    boutique_id: p2.id,
    client_nom: 'Client Test Btq 2',
    montant_total: 15000,
    montant_paye: 5000,
    reste_a_payer: 10000,
    dernier_paiement: nowIso,
  });

  assert.equal(creditPayload.patron_id, mainBtqId);
  assert.equal(creditPayload.boutique_id, sub2Id);
  assert.equal(creditPayload.montant_total, 15000);
  assert.equal(creditPayload.montant_paye, 5000);
  assert.equal(creditPayload.reste_a_payer, 10000);
  assert.equal(creditPayload.dernier_paiement, nowIso);
  assert.equal('montant' in creditPayload, false, 'credits payload must NOT contain montant');
  assert.equal('created_at' in creditPayload, false, 'credits payload must NOT contain created_at');
  assert.equal('montant_initial' in creditPayload, false, 'credits payload must NOT contain montant_initial');

  // Verify depenses payload columns: montant, date (NO created_at)
  const depensePayload = buildDepenseSupabasePayload({
    id: generatePrefixedId('dep'),
    patron_id: getMainPatronIdSync(p3),
    boutique_id: p3.id,
    type: 'Transport',
    montant: 3500,
    description: 'Livraison Btq 3',
    cree_par: 'Malik',
    date: nowIso,
  });

  assert.equal(depensePayload.patron_id, mainBtqId);
  assert.equal(depensePayload.boutique_id, sub3Id);
  assert.equal(depensePayload.montant, 3500);
  assert.equal(depensePayload.date, nowIso);
  assert.equal('created_at' in depensePayload, false, 'depenses payload must NOT contain created_at');

  // Verify isolation across stores in local filter
  const allRows = [
    { id: 'v1', patron_id: mainBtqId, boutique_id: mainBtqId },
    creditPayload,
    depensePayload,
  ];
  const btq1Rows = allRows.filter((r) => r.boutique_id === mainBtqId);
  const btq2Rows = allRows.filter((r) => r.boutique_id === sub2Id);
  const btq3Rows = allRows.filter((r) => r.boutique_id === sub3Id);

  assert.equal(btq1Rows.length, 1);
  assert.equal(btq1Rows[0].id, 'v1');
  assert.equal(btq2Rows.length, 1);
  assert.equal(btq2Rows[0].id, creditPayload.id);
  assert.equal(btq3Rows.length, 1);
  assert.equal(btq3Rows[0].id, depensePayload.id);

  console.log('✅ Unit contract & multi-store isolation checks PASSED.');
  return { mainBtqId, sub2Id, sub3Id, creditPayload, depensePayload, nowIso };
}

async function runLiveSupabaseTest(seed: ReturnType<typeof runUnitContractTests>) {
  if (!supabaseKey || supabaseKey === 'dummy_supabase_anon_key_for_offline_and_scripts') {
    console.log('⚠️ VITE_SUPABASE_ANON_KEY absent in local shell environment — skipping live Supabase round-trip.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { mainBtqId, sub2Id, sub3Id, creditPayload, depensePayload, nowIso } = seed;
  const venteId = generatePrefixedId('vte');
  const hist1Id = generatePrefixedId('act');
  const hist2Id = generatePrefixedId('act');
  const hist3Id = generatePrefixedId('act');

  console.log('2. Running LIVE Supabase test (Boutique 1 vente, Boutique 2 credit, Boutique 3 depense)...');

  // Step A: Ensure principal patron_id exists in `patrons` before FK inserts
  const { error: patronErr } = await supabase
    .from('patrons')
    .upsert({ id: mainBtqId, nom: 'Malik Test', nom_boutique: 'Boutique 1 Test', created_at: nowIso }, { onConflict: 'id' });
  assert.equal(patronErr, null, `patrons upsert failed: ${patronErr?.message}`);

  // Step B: 1 vente on Boutique 1
  const venteRow = {
    id: venteId,
    ticket_id: generatePrefixedId('tck'),
    patron_id: mainBtqId,
    boutique_id: mainBtqId,
    produit_id: 'prod_test',
    produit_nom: 'Article Test Btq1',
    qte: 1,
    montant_total: 10000,
    client_nom: 'Client Btq1',
    est_credit: false,
    reste_a_payer: 0,
    vendu_par_id: mainBtqId,
    vendu_par_nom: 'Malik',
    date: nowIso,
    synced: true,
  };
  const { error: venteErr } = await supabase.from('ventes').upsert(venteRow, { onConflict: 'id' });
  assert.equal(venteErr, null, `ventes upsert failed: ${venteErr?.message}`);

  const { error: txErr } = await supabase.from('transactions').upsert({
    id: venteId,
    ticket_id: venteRow.ticket_id,
    patron_id: mainBtqId,
    boutique_id: mainBtqId,
    produit_id: 'prod_test',
    produit_nom: 'Article Test Btq1',
    qte: 1,
    quantite: 1,
    montant: 10000,
    montant_total: 10000,
    type: 'vente',
    vendu_par_nom: 'Malik',
    date: nowIso,
  }, { onConflict: 'id' });
  assert.equal(txErr, null, `transactions upsert failed: ${txErr?.message}`);

  // Step C: 1 credit on Boutique 2
  const { error: credErr } = await supabase.from('credits').upsert(creditPayload, { onConflict: 'id' });
  assert.equal(credErr, null, `credits upsert failed: ${credErr?.message}`);
  // Re-upsert same ID to verify 0 409 conflict
  const { error: credReErr } = await supabase.from('credits').upsert(creditPayload, { onConflict: 'id' });
  assert.equal(credReErr, null, `credits idempotent upsert failed: ${credReErr?.message}`);

  // Step D: 1 depense on Boutique 3
  const { error: depErr } = await supabase.from('depenses').upsert(depensePayload, { onConflict: 'id' });
  assert.equal(depErr, null, `depenses upsert failed: ${depErr?.message}`);

  // Step E: historique_actions for all 3 boutiques
  const { error: histErr } = await supabase.from('historique_actions').upsert([
    { id: hist1Id, patron_id: mainBtqId, boutique_id: mainBtqId, user_id: mainBtqId, action_type: 'vente', description: 'Test vente Btq1', montant: 10000, created_at: nowIso },
    { id: hist2Id, patron_id: mainBtqId, boutique_id: sub2Id, user_id: mainBtqId, action_type: 'credit', description: 'Test credit Btq2', montant: 10000, created_at: nowIso },
    { id: hist3Id, patron_id: mainBtqId, boutique_id: sub3Id, user_id: mainBtqId, action_type: 'depense', description: 'Test depense Btq3', montant: 3500, created_at: nowIso },
  ], { onConflict: 'id' });
  assert.equal(histErr, null, `historique_actions upsert failed: ${histErr?.message}`);

  // Step F: Query with .eq('boutique_id', ...) and confirm ZERO mixing
  const { data: b1Creds } = await supabase.from('credits').select('*').eq('boutique_id', mainBtqId);
  const { data: b2Creds } = await supabase.from('credits').select('*').eq('boutique_id', sub2Id);
  const { data: b2Deps } = await supabase.from('depenses').select('*').eq('boutique_id', sub2Id);
  const { data: b3Deps } = await supabase.from('depenses').select('*').eq('boutique_id', sub3Id);
  const { data: b1Hists } = await supabase.from('historique_actions').select('*').eq('boutique_id', mainBtqId);
  const { data: b2Hists } = await supabase.from('historique_actions').select('*').eq('boutique_id', sub2Id);
  const { data: b3Hists } = await supabase.from('historique_actions').select('*').eq('boutique_id', sub3Id);

  assert.equal(b1Creds?.length || 0, 0, 'Boutique 1 must NOT see Boutique 2 credit');
  assert.equal(b2Creds?.length || 0, 1, 'Boutique 2 must see its credit');
  assert.equal(b2Creds?.[0]?.patron_id, mainBtqId);
  assert.equal(b2Deps?.length || 0, 0, 'Boutique 2 must NOT see Boutique 3 depense');
  assert.equal(b3Deps?.length || 0, 1, 'Boutique 3 must see its depense');
  assert.equal(b3Deps?.[0]?.patron_id, mainBtqId);
  assert.equal(b1Hists?.length || 0, 1);
  assert.equal(b2Hists?.length || 0, 1);
  assert.equal(b3Hists?.length || 0, 1);

  // Cleanup test rows
  await supabase.from('historique_actions').delete().in('id', [hist1Id, hist2Id, hist3Id]);
  await supabase.from('depenses').delete().eq('id', depensePayload.id);
  await supabase.from('credits').delete().eq('id', creditPayload.id);
  await supabase.from('transactions').delete().eq('id', venteId);
  await supabase.from('ventes').delete().eq('id', venteId);
  await supabase.from('patrons').delete().eq('id', mainBtqId);

  console.log('✅ LIVE Supabase multi-boutique test PASSED with 0 mixing and 0 errors!');
}

const seed = runUnitContractTests();
runLiveSupabaseTest(seed).catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
