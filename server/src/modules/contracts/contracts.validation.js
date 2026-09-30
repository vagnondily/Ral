const { z } = require('zod');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const optionalText = z.string().trim().max(120).optional().or(z.literal('').transform(() => undefined));
const version = z.number().int().positive().optional();

// Budget item (poste) : ligne de coût × description × qté × coût unitaire,
// réparti en % par activité { "<activityId>": pct }.
const budgetItem = z.object({
  lineCode: z.string().regex(/^[IVX]+(-bis)?\.[a-z_]+$/i),
  description: z.string().trim().min(2).max(240),
  unitCount: z.number().nonnegative().max(1e9),
  unitCost: z.number().nonnegative().max(1e13),
  allocations: z.record(z.string().uuid(), z.number().min(0).max(1)).default({}),
});

const feePct = z.number().min(0).max(1);

// Zone géographique choisie dans le découpage administratif du tenant
// (pas de saisie libre) : on référence un nœud par son id.
const area = z.object({
  adminAreaId: z.string().uuid(),
  path: z.string().trim().max(300).optional(),
});

const contractShape = {
  partnerId: z.string().uuid('Choisissez un partenaire'),
  activityIds: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins une activité'),
  numeroFla: optionalText,
  numeroPo: optionalText,
  numeroVendor: optionalText,
  dateDebut: isoDate,
  dateFin: isoDate,
  managementFeePct: feePct.optional(),
  budget: z.array(budgetItem).max(500).default([]),
  areas: z.array(area).max(100).default([]),
};

const contractBody = z.object(contractShape)
  .refine((c) => c.dateFin > c.dateDebut, { message: 'La date de fin doit suivre la date de début', path: ['dateFin'] });

const createContractSchema = contractBody;
const updateContractSchema = z.object({ ...contractShape, version })
  .refine((c) => c.dateFin > c.dateDebut, { message: 'La date de fin doit suivre la date de début', path: ['dateFin'] });

const submitSchema = z.object({
  validatorId: z.string().uuid('Choisissez un valideur'),
  comment: z.string().trim().max(1000).optional(),
  version,
});

const decisionSchema = z.object({ comment: z.string().trim().max(1000).optional(), version });

// An amendment reuses the full contract shape (it is a "rajout" with full
// detail), plus a justification and a validator (segregation of duties).
const amendmentSchema = z.object({
  ...contractShape,
  justification: z.string().trim().min(10, 'Justification requise (10 caractères minimum)').max(2000),
  validatorId: z.string().uuid('Choisissez un valideur'),
}).refine((c) => c.dateFin > c.dateDebut, { message: 'La date de fin doit suivre la date de début', path: ['dateFin'] });

const renewSchema = z.object({ newDateFin: isoDate, numeroFla: optionalText });

const terminateSchema = z.object({
  reason: z.string().trim().min(10, 'Motif obligatoire (10 caractères minimum)').max(2000),
  effectiveDate: isoDate,
  version,
});

const listQuerySchema = z.object({
  status: z.enum(['brouillon', 'en_validation', 'actif', 'rejete', 'resilie']).optional(),
  q: z.string().trim().max(100).optional(),
});

module.exports = {
  createContractSchema, updateContractSchema, submitSchema, decisionSchema,
  amendmentSchema, renewSchema, terminateSchema, listQuerySchema,
};
