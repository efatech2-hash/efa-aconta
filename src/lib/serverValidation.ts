/**
 * VALIDATION STRICTE DU SERVEUR ET DES ACTIONS (ZOD)
 * Évite les injections, prix négatifs, stocks absurdes et manipulations de quotas
 */
import { z } from 'zod';

// 1. Schéma Produit
export const ProductSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  patron_id: z.string().min(1).max(100),
  nom: z
    .string()
    .trim()
    .min(1, 'Le nom du produit est requis')
    .max(150, 'Le nom ne peut pas dépasser 150 caractères')
    .transform((val) => val.replace(/<[^>]*>?/gm, '')), // Nettoyage XSS
  photo_url: z.string().max(2000).optional().nullable(),
  prix_achat: z
    .number()
    .min(0, "Le prix d'achat ne peut pas être négatif")
    .max(100_000_000, "Le prix d'achat dépasse la limite autorisée (100M)")
    .default(0),
  prix_vente: z
    .number()
    .min(0, 'Le prix de vente ne peut pas être négatif')
    .max(100_000_000, 'Le prix de vente dépasse la limite autorisée (100M)'),
  stock_qte: z
    .number()
    .int('La quantité doit être un entier')
    .min(0, 'Le stock ne peut pas être négatif')
    .max(1_000_000, 'Quantité de stock déraisonnable (max 1M)')
    .default(0),
  seuil_alerte: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(5),
  categorie: z
    .string()
    .max(100)
    .default('Général')
    .transform((val) => val.replace(/<[^>]*>?/gm, '')),
});

// 2. Schéma Vente
export const SaleSchema = z.object({
  id: z.string().min(1).optional(),
  patron_id: z.string().min(1).max(100),
  produit_id: z.string().min(1).max(100).optional().nullable(),
  produit_nom: z.string().max(150),
  qte: z
    .number()
    .int('La quantité doit être un nombre entier')
    .min(1, 'La quantité minimum vendue est 1')
    .max(100_000, 'Quantité de vente trop élevée'),
  montant_total: z
    .number()
    .min(0, 'Le montant total ne peut pas être négatif')
    .max(500_000_000, 'Montant de vente trop élevé'),
  client_nom: z.string().max(150).optional().nullable(),
  est_credit: z.boolean().default(false),
  reste_a_payer: z.number().min(0).default(0),
  vendu_par_id: z.string().max(100).optional().nullable(),
  vendu_par_nom: z.string().max(100).optional().nullable(),
});

// 3. Schéma Employé
export const EmployeeSchema = z.object({
  id: z.string().min(1).optional(),
  patron_id: z.string().min(1).max(100),
  nom: z
    .string()
    .trim()
    .min(1, "Le nom de l'employé est requis")
    .max(100, 'Nom trop long')
    .transform((val) => val.replace(/<[^>]*>?/gm, '')),
  prenom: z.string().max(100).optional().nullable(),
  telephone: z.string().max(30).optional().nullable(),
  code_pin: z
    .string()
    .regex(/^\d{4}$/, 'Le code PIN doit comporter exactement 4 chiffres'),
  role: z.enum(['patron', 'vendeuse', 'gestionnaire']).default('vendeuse'),
  status: z.enum(['active', 'inactive', 'deleted']).default('active'),
});

// 4. Schéma Connexion Super Admin
export const AdminLoginSchema = z.object({
  email: z.string().trim().email('Format email invalide').max(150),
  password: z.string().min(6, 'Le mot de passe doit comporter au moins 6 caractères').max(150),
});

// 5. Schéma Activation Boutique Admin
export const AdminActivateBoutiqueSchema = z.object({
  boutique_id: z.string().min(1, 'ID de boutique requis').max(100),
  duration_days: z.number().int().min(1).max(3650).default(365),
  plan: z.enum(['trial', 'free', 'populaire', 'pro', 'pro_annuel']).default('pro'),
  amount: z.number().min(0).max(10_000_000).default(90000),
});

// Helper de validation rapide
export function validatePayload<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMessages = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { success: false, errors: errorMessages };
  }
  return { success: true, data: result.data };
}
