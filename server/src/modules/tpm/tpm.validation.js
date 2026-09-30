const { z } = require('zod');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');

const createProviderSchema = z.object({
  name: z.string().min(2),
  contractRef: z.string().min(2).optional(),
  dailyRate: z.number().nonnegative(),
});

const createAgentSchema = z.object({
  name: z.string().min(2),
});

const upsertAssignmentSchema = z.object({
  siteId: z.string().uuid(),
  tpmProviderId: z.string().uuid().nullable().optional(),
  tpmAgentId: z.string().uuid().nullable().optional(),
});

const toggleMissionDaySchema = z.object({
  date: isoDate,
});

const monthQuerySchema = z.object({
  // Accepts "2026-11" or a full date; normalized to the 1st of the month.
  month: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Mois attendu au format AAAA-MM'),
});

module.exports = {
  createProviderSchema,
  createAgentSchema,
  upsertAssignmentSchema,
  toggleMissionDaySchema,
  monthQuerySchema,
};
