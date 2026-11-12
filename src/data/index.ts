import { validateContent, type Content } from '../sim';
import buildings from './buildings.json';
import factions from './factions.json';
import galaxyPresets from './galaxy-presets.json';
import hulls from './hulls.json';
import names from './names.json';
import planetTypes from './planets.json';
import rules from './rules.json';
import techs from './techs.json';

/** Loads and validates the shipped game content. Throws listing every problem if it is invalid. */
export function loadContent(): Content {
  const result = validateContent({
    factions,
    buildings,
    hulls,
    fields: techs.fields,
    research: techs.research,
    planetTypes,
    galaxyPresets,
    names,
    rules,
  });
  if (!result.ok) throw new Error(`Invalid content:\n  ${result.error.join('\n  ')}`);
  return result.value;
}
