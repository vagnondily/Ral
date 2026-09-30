// Référentiel des districts par région (zones d'intervention du Sud/Sud-Est
// Madagascar), issu du référentiel district/région du programme. Sert à
// affecter les districts (et communes saisies librement) au prestataire dans
// le contrat.
export const REGIONS = [
  { region: 'Anosy', districts: ['Amboasary Sud', 'Amboasary-Atsimo', 'Betroka', 'Fort Dauphin', 'Taolagnaro'] },
  { region: 'Androy', districts: ['Ambovombe', 'Ambovombe-Androy', 'Antanimora', 'Antanimora Sud', 'Bekily', 'Beloha', 'Tsihombe'] },
  { region: 'Atsimo Andrefana', districts: ['Ampanihy', 'Ampanihy Ouest', 'Benenitra', 'Betioky Atsimo', 'Betioky Sud', 'Morombe', 'Sakaraha', 'Toliara II', 'Toliary-II'] },
  { region: 'Atsimo Atsinanana', districts: ['Farafangana', 'Midongy-Atsimo', 'Vangaindrano', 'Vondrozo'] },
  { region: 'Fitovinany', districts: ['Manakara', 'Manakara Atsimo'] },
  { region: 'Vatovavy', districts: ['Mananjary', 'Nosy-Varika'] },
];

export const DISTRICT_REGION = Object.fromEntries(
  REGIONS.flatMap((r) => r.districts.map((d) => [d, r.region]))
);
