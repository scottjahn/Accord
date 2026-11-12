import { validateContent, type Content } from '../sim';
import ai from './ai.json';
import buildings from './buildings.json';
import factions from './factions.json';
import galaxyPresets from './galaxy-presets.json';
import hulls from './hulls.json';
import minors from './minors.json';
import names from './names.json';
import planetTypes from './planets.json';
import rules from './rules.json';
import techs from './techs.json';

/**
 * Loads and validates the shipped game content. Throws listing every problem if
 * it is invalid. Each call returns its own copy, so a caller that changes a
 * value (a balance experiment, say) cannot affect anyone else.
 */
export function loadContent(): Content {
  const result = validateContent(structuredClone({
    factions,
    ai,
    buildings,
    hulls,
    minors,
    fields: techs.fields,
    research: techs.research,
    planetTypes,
    galaxyPresets,
    names,
    rules,
  }));
  if (!result.ok) throw new Error(`Invalid content:\n  ${result.error.join('\n  ')}`);
  return result.value;
}
