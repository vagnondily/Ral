const test = require('node:test');
const assert = require('node:assert/strict');
const { planIssues } = require('../scripts/perf/explainGuard');

// Plans réduits à l'essentiel (champs de EXPLAIN (ANALYZE, FORMAT JSON)).
const node = (type, extra = {}, plans) => ({ 'Node Type': type, 'Actual Rows': 1, 'Actual Loops': 1, ...extra, ...(plans ? { Plans: plans } : {}) });

test('ancienne résolution des régions : CTE de 19 370 zones relu pour chaque soumission → signalée', () => {
  // Nested Loop Left Join : 2 475 soumissions à l'extérieur, CTE Scan pcode_region à l'intérieur.
  const plan = [{ Plan: node('Sort', {}, [
    node('Nested Loop', { 'Join Type': 'Left', 'Actual Rows': 2475 }, [
      node('Index Scan', { 'Parent Relationship': 'Outer', 'Relation Name': 'monitoring_submissions', 'Actual Rows': 2475 }),
      node('CTE Scan', { 'Parent Relationship': 'Inner', 'CTE Name': 'pcode_region', 'Actual Rows': 19370, 'Actual Loops': 2475 }),
    ]),
  ]) }];
  const issues = planIssues(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'nested_loop_inner');
  assert.equal(issues[0].work, 19370 * 2475);
  assert.match(issues[0].message, /CTE Scan on pcode_region/);
});

test('faits site × mois : la série des mois (≤ 60 lignes) relue pour chaque site est permise', () => {
  const plan = [{ Plan: node('Nested Loop', { 'Actual Rows': 36000 }, [
    node('CTE Scan', { 'Parent Relationship': 'Outer', 'CTE Name': 'reg', 'Actual Rows': 3000 }),
    node('Function Scan', { 'Parent Relationship': 'Inner', 'Function Name': 'generate_series', 'Actual Rows': 12, 'Actual Loops': 3000 }),
  ]) }];
  assert.deepEqual(planIssues(plan), []);
  // Une fonction qui rend beaucoup de lignes à chaque boucle compte, elle.
  plan[0].Plan.Plans[1]['Actual Rows'] = 500;
  assert.equal(planIssues(plan)[0].rule, 'nested_loop_inner');
});

test('lecture par index dans une boucle : permise tant que le travail total reste borné', () => {
  const ok = [{ Plan: node('Nested Loop', {}, [
    node('Seq Scan', { 'Parent Relationship': 'Outer', 'Relation Name': 'sites', 'Actual Rows': 3000 }),
    node('Index Scan', { 'Parent Relationship': 'Inner', 'Relation Name': 'site_visits', 'Actual Rows': 3, 'Actual Loops': 3000 }),
  ]) }];
  assert.deepEqual(planIssues(ok), []);
});

test('parcours répété : une table relue plus de 1 000 fois, plus de 10 lignes par boucle (filtrées comprises) → signalé', () => {
  const plan = [{ Plan: node('Seq Scan', { 'Relation Name': 'sites', 'Actual Rows': 2 }, [
    node('Index Scan', { 'Parent Relationship': 'SubPlan', 'Relation Name': 'monitoring_submissions', 'Actual Rows': 2, 'Rows Removed by Filter': 40, 'Actual Loops': 3000 }),
  ]) }];
  const issues = planIssues(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'repeated_scan');
  assert.equal(issues[0].loops, 3000);
});

test('sous-requête corrélée qui relit une table de 3 000 lignes pour chaque ligne rendue → signalée', () => {
  const plan = [{ Plan: node('Limit', { 'Actual Rows': 300 }, [
    node('Index Scan', { 'Relation Name': 'monitoring_submissions', 'Actual Rows': 300 }, [
      node('Limit', { 'Parent Relationship': 'SubPlan', 'Actual Rows': 1, 'Actual Loops': 300 }, [
        node('Seq Scan', { 'Relation Name': 'sites', 'Actual Rows': 1, 'Rows Removed by Filter': 2999, 'Actual Loops': 300 }),
      ]),
    ]),
  ]) }];
  const issues = planIssues(plan);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].rule, 'subplan_reread');
  assert.equal(issues[0].work, 3000 * 300);
  // Une lecture par index (une ligne par boucle) reste permise.
  plan[0].Plan.Plans[0].Plans[0].Plans[0] = node('Index Scan', { 'Relation Name': 'sites', 'Actual Rows': 1, 'Actual Loops': 300 });
  assert.deepEqual(planIssues(plan), []);
});

test('petit ensemble relu pour chaque ligne (une dizaine de bureaux) : jointure linéaire, non signalée', () => {
  const plan = [{ Plan: node('Nested Loop', { 'Join Type': 'Left' }, [
    node('Index Scan', { 'Parent Relationship': 'Outer', 'Relation Name': 'monitoring_submissions', 'Actual Rows': 60000 }),
    node('Materialize', { 'Parent Relationship': 'Inner', 'Actual Rows': 12, 'Actual Loops': 60000 }, [
      node('Seq Scan', { 'Relation Name': 'field_offices', 'Actual Rows': 12 }),
    ]),
  ]) }];
  assert.deepEqual(planIssues(plan), []);
});

test('format accepté : tableau EXPLAIN, objet { Plan } ou nœud nu ; seuils réglables', () => {
  const inner = node('Seq Scan', { 'Parent Relationship': 'Inner', 'Relation Name': 'x', 'Actual Rows': 100, 'Actual Loops': 50 });
  const nl = node('Nested Loop', {}, [node('Result', { 'Parent Relationship': 'Outer' }), inner]);
  assert.deepEqual(planIssues(nl), []);
  assert.equal(planIssues({ Plan: nl }, { maxInnerRead: 1000, minInnerRows: 50 }).length, 1);
});
