# 🏪 MES BOUTIQUES PRO — DOCUMENTATION TECHNIQUE & RÈGLES MÉTIER

> **EFA ACONTA** — Gestion Multi-Boutiques pour commerçants et entrepreneurs (Abonnement PRO).

---

## 📌 Sommaire
1. [Vue d'ensemble & Architecture](#1-vue-densemble--architecture)
2. [Schéma de données (Boutique / Patron)](#2-schéma-de-données-boutique--patron)
3. [Règle d'or : Quota partagé des 300 Articles](#3-règle-dor--quota-partagé-des-300-articles)
4. [Règle partagée : Quota des 10 Employés](#4-règle-partagée--quota-des-10-employés)
5. [Création des Sous-Boutiques (Max 3)](#5-création-des-sous-boutiques-max-3)
6. [Verrouillage d'Appareil (`deviceStoreId`)](#6-verrouillage-dappareil-devicestoreid)
7. [Login Employé & Interface Simplifiée SUB](#7-login-employé--interface-simplifiée-sub)
8. [Matrice des Droits & Navigation](#8-matrice-des-droits--navigation)
9. [Tests E2E & Validation](#9-tests-e2e--validation)

---

## 1. Vue d'ensemble & Architecture

Le module **Mes Boutiques** permet à un commerçant titulaire d'un abonnement **PRO** (6 ou 12 mois) de gérer jusqu'à **3 points de vente** avec un seul compte patron :
- **1 Boutique Principale (`type: 'MAIN'`)** : Le point de vente d'origine du patron.
- **Jusqu'à 2 Sous-Boutiques (`type: 'SUB'`)** : Points de vente secondaires (ex: "Boutique 2", "Boutique 3").

### Principe d'agrégation "Cluster"
Toutes les boutiques rattachées au même propriétaire partagent un même identifiant de cluster (`mainStoreId` ou `ownerId`).

```
                          ┌────────────────────────┐
                          │   Boutique Principale  │
                          │     (type: MAIN)       │
                          │   id: btq_main_001     │
                          └───────────┬────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
   ┌───────────────────────────┐             ┌───────────────────────────┐
   │        Boutique 2         │             │        Boutique 3         │
   │       (type: SUB)         │             │       (type: SUB)         │
   │  parentId: btq_main_001   │             │  parentId: btq_main_001   │
   └───────────────────────────┘             └───────────────────────────┘
```

---

## 2. Schéma de données (Boutique / Patron)

Dans la table `patrons` (IndexedDB / Supabase `efa_boutiques`) :

| Champ | Type | Description |
|---|---|---|
| `id` | `string` | Identifiant unique de la boutique (`btq_...`) |
| `nom_boutique` | `string` | Nom d'affichage de la boutique |
| `type` | `'MAIN' \| 'SUB'` | Type de boutique : Principale ou Sous-boutique |
| `parentId` | `string \| null` | `null` pour la boutique principale, `mainStoreId` pour les sous-boutiques |
| `ownerId` | `string` | ID de la boutique principale du propriétaire |
| `isProActive` | `boolean` | `true` si l'abonnement Pro (6 ou 12 mois) est actif |
| `proExpiresAt` | `string (ISO)` | Date d'expiration de l'abonnement Pro |
| `maxBoutiques` | `number` | Nombre maximum de boutiques autorisées (Défaut : 3 pour Pro) |
| `planArticleLimit` | `number` | Plafond cumulé d'articles pour le cluster (300 pour Pro) |
| `planEmployeeLimit` | `number` | Plafond cumulé d'employés pour le cluster (10 pour Pro) |

---

## 3. Règle d'or : Quota partagé des 300 Articles

Le quota de **300 articles** est **partagé** entre toutes les boutiques du propriétaire :
$$\sum_{\text{boutique } \in \text{ Cluster}} \text{articles}(\text{boutique}) \le 300$$

### Exemples de répartition :
- **1 boutique unique** : 300 articles dans la boutique principale.
- **3 boutiques** : 100 + 100 + 100 = 300, ou 150 + 50 + 100 = 300.

### Interface & Blocage :
- En haut de l'écran **Stock & Articles** :
  ```
  Articles utilisés : 187 / 300
  ```
- Au **301e article** (tentative d'ajout sur MAIN ou sur SUB), l'opération est **strictement bloquée** avec le message officiel :
  > **« Limite Pro atteinte : 300 articles pour toutes tes boutiques réunies. Supprime un article ou passe en Premium. »**

---

## 4. Règle partagée : Quota des 10 Employés

Même logique de partage pour les collaborateurs :
$$\sum_{\text{boutique } \in \text{ Cluster}} \text{employés}(\text{boutique}) \le 10$$

### Exemples de répartition :
- 3 en Principale + 3 en Boutique 2 + 4 en Boutique 3 = 10 employés.
- Affichage dans l'écran **Équipe** : `Employés utilisés : X / 10`.
- Au **11e employé**, blocage strict avec le message :
  > **« Limite Pro atteinte : 10 employés pour toutes tes boutiques réunies. »**

---

## 5. Création des Sous-Boutiques (Max 3)

- **Route** : `/dashboard/mes-boutiques`
- **Condition** : Accessible **uniquement** si `isProActive === true` et `currentStore.type === 'MAIN'`.
- Si `isProActive === false`, le bouton affiche un cadenas avec le badge :
  > **🔒 Débloque avec Pro**
- **Nom automatique** : `"Boutique 2"`, `"Boutique 3"`.
- Bouton `+ Ajouter une boutique` désactivé dès que le total atteint 3.
- Possibilité de supprimer une sous-boutique après confirmation par le code PIN patron.

---

## 6. Verrouillage d'Appareil (`deviceStoreId`)

Pour assigner un smartphone ou une tablette à une sous-boutique spécifique :

1. **Connexion Patron** : Le patron se connecte sur le téléphone dédié avec ses identifiants principaux habituels.
2. **Détection au démarrage** :
   - Si `isProActive === true`, que le cluster possède des sous-boutiques et que `localStorage.getItem('deviceStoreId') == null` :
   - Une modale plein écran s'affiche : **« Ce téléphone va afficher quelle boutique ? »**
   - 3 cartes cliquables : `[ Boutique Principale ]` `[ Boutique 2 ]` `[ Boutique 3 ]`.
3. **Verrouillage** :
   - Au clic sur *Boutique 2* :
     ```ts
     localStorage.setItem('deviceStoreId', 'id-boutique-2');
     localStorage.setItem('deviceStoreName', 'Boutique 2');
     ```
4. **Persistance** :
   - Au prochain démarrage, l'application lit `deviceStoreId` et charge directement les données de cette boutique.
   - Badge visible en haut : `📱 Appareil : Boutique 2` avec un bouton discret `[Changer]`.
   - Changer de boutique requiert obligatoirement la saisie du **code PIN patron**.

---

## 7. Login Employé & Interface Simplifiée SUB

Sur un appareil verrouillé en mode `SUB` (ex: Boutique 2) :
1. **Écran de sélection d'utilisateur** :
   - Liste **uniquement** les employés rattachés à cette sous-boutique (`where patron_id == deviceStoreId`).
   - L'employé (ex: Kofi) clique sur son profil.
   - Pavé numérique PIN à 4 chiffres.
2. **Interface Vendeur ultra-simplifiée** :
   - Onglets autorisés : **Vendre** + **Ce que j'ai vendu** (Historique personnel).
   - L'employé **ne peut pas changer de boutique** ni accéder aux statistiques globales ou aux paramètres.

---

## 8. Matrice des Droits & Navigation

| Fonctionnalité | MAIN (Patron Pro) | SUB (Patron) | SUB (Vendeur) | Non Pro (Essai/Populaire) |
|---|:---:|:---:|:---:|:---:|
| **Vendre** | ✅ | ✅ | ✅ | ✅ |
| **Mon Argent** | ✅ | ✅ | ❌ | ✅ |
| **Stock & Articles** | ✅ (Quota 300) | ✅ (Quota 300) | ❌ | ✅ (Quota plan) |
| **Historique Ventes** | ✅ (Cluster/Local) | ✅ (Local) | ✅ (Ses ventes) | ✅ |
| **Équipe / Employés** | ✅ (Quota 10) | ✅ (Quota 10) | ❌ | ✅ (Quota plan) |
| **Mes Boutiques** | ✅ | ❌ | ❌ | 🔒 Cadenas Pro |
| **Mon Abonnement** | ✅ | ❌ | ❌ | ✅ |
| **Ambassadrice** | ✅ | ❌ | ❌ | ✅ |
| **Paramètres Avancés** | ✅ | ❌ | ❌ | ✅ |

### Règle de non-régression
Si `isProActive === false` ou si `deviceStoreId === null` et que le patron n'a qu'une boutique : l'application fonctionne **strictement à l'identique**, sans aucun changement d'expérience utilisateur.

---

## 9. Tests E2E & Validation

Le fichier `scripts/test-mes-boutiques.ts` valide les scénarios de bout en bout :

```bash
npx tsx scripts/test-mes-boutiques.ts
```

### Résultats validés :
- ✅ **Test 1** : Création Boutique 2 & 3, blocage strict au 301e article avec message officiel sur MAIN et SUB.
- ✅ **Test 2** : Création de 10 employés répartis (3 + 3 + 4), blocage strict au 11e avec message officiel.
- ✅ **Test 3** : Verrouillage sur Boutique 2, isolation des 100 produits / 3 employés / 1 vente, refus d'accès aux routes d'administration pour le vendeur.
