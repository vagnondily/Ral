const express = require('express');
const { Router } = require('express');
const asyncHandler = require('../../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../../middleware/auth');
const { badRequest } = require('../../middleware/errors');
const { buildTemplateWorkbook, parsePostesWorkbook } = require('./postesXlsx');
const { normalizeItems, summarize } = require('./reportMath');

/**
 * Shared Excel helpers for the postes / état des dépenses (facture + plan).
 * Fill offline with a validated template, import back through the SAME
 * business rules (normalizeItems) — nothing is persisted here; the parsed,
 * validated items go back to the client for review before a normal save.
 */
const router = Router();
router.use(requireAuth);
const WRITE = requireRole('admin', 'manager');

router.get('/template.xlsx', asyncHandler(async (req, res) => {
  const wb = buildTemplateWorkbook({
    title: 'Modèle — État des dépenses (postes)',
    subtitle: 'MEMS 2.0 · à importer dans une facture ou un plan de collecte',
  });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Modele_postes_MEMS2.xlsx"');
  await wb.xlsx.write(res);
  res.end();
}));

router.post('/import', WRITE, express.raw({ type: '*/*', limit: '20mb' }), asyncHandler(async (req, res) => {
  if (!req.body || !req.body.length) throw badRequest('Fichier vide.');
  let parsed;
  try {
    parsed = await parsePostesWorkbook(req.body);
  } catch (err) {
    if (err && err.code === 'NO_SHEET') throw badRequest('Le fichier ne contient pas de feuille « Postes ». Téléchargez et remplissez le modèle.');
    throw badRequest('Fichier Excel illisible ou format non reconnu (utilisez le modèle).');
  }
  if (!parsed.items.length) {
    throw badRequest(parsed.skipped.length
      ? `Aucun poste valide. ${parsed.skipped.length} ligne(s) ignorée(s) : ${parsed.skipped.slice(0, 3).map((s) => `L${s.row} — ${s.reason}`).join(' ; ')}`
      : 'Aucun poste trouvé dans la feuille « Postes ».');
  }
  // Re-check against the business rules (the same ones the API enforces on save).
  let items;
  try {
    items = normalizeItems(parsed.items);
  } catch (err) {
    throw badRequest(err.message);
  }
  res.json({ items, skipped: parsed.skipped, summary: summarize(items) });
}));

module.exports = router;
