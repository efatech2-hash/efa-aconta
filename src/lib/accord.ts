import type { Genre, Role } from './types';

export interface Accords {
  titrePatron: string; // 'Patronne' | 'Patron'
  titreVendeur: string; // 'Vendeuse' | 'Vendeur'
  roleAccorde: (role: Role) => string;
  bienvenue: string; // 'Bienvenue Patronne' | 'Bienvenue Patron'
  connecte: string; // 'Connectée' | 'Connecté'
  venduAccord: string; // 'vendue' | 'vendu'
  enregistreAccord: string; // 'enregistrée' | 'enregistré'
  inviteAccord: string; // 'invitée' | 'invité'
  abonneAccord: string; // 'abonnée' | 'abonné'
  pronom: string; // 'elle' | 'il'
  article: string; // 'la' | 'le'
}

export function getAccord(genre: Genre = 'femme'): Accords {
  const isFemme = genre === 'femme';
  return {
    titrePatron: isFemme ? 'Patronne' : 'Patron',
    titreVendeur: isFemme ? 'Vendeuse' : 'Vendeur',
    roleAccorde: (role: Role) => {
      if (role === 'patron') return isFemme ? 'Patronne' : 'Patron';
      return isFemme ? 'Vendeuse' : 'Vendeur';
    },
    bienvenue: isFemme ? 'Bienvenue Patronne' : 'Bienvenue Patron',
    connecte: isFemme ? 'Connectée' : 'Connecté',
    venduAccord: isFemme ? 'vendue' : 'vendu',
    enregistreAccord: isFemme ? 'enregistrée' : 'enregistré',
    inviteAccord: isFemme ? 'invitée' : 'invité',
    abonneAccord: isFemme ? 'abonnée' : 'abonné',
    pronom: isFemme ? 'elle' : 'il',
    article: isFemme ? 'la' : 'le',
  };
}
