# To do

Requests noted for later.

## Open

Nothing requested is outstanding. Possible follow-ups, none started:

- **The AI still founds colonies on arrival.** Found Colony is a separate action for the player only; AI empires use the one-step order.

## Done

- **Lowering a slider under a governor.** Lowering a slider sets a limit on that output: a fixed number that does not grow with the colony. The governor places the workers it turns away elsewhere. "Clear adjustments" lifts it.
- **Idle scouts.** A scout with no orders is in the idle list and the End Turn warning while there are unscanned systems it could reach. Warships are still left alone: standing guard is not idleness.
- **Idle warnings on the main page.** The turn report lists colonies with idle workers, colonies with an empty build queue (when something could be built), and colony ships with no orders; each entry jumps to it. Free systems in range with no colony ship on the way are mentioned but do not trigger the warning. End Turn asks for confirmation when anything is idle, with a "don't warn me again" option.
- **System view: capacity and bonuses.** Every scanned system shows its room for people and its planets' combined food and energy bonuses.
- **Found Colony as its own action.** Sending a colony ship to a free system is an ordinary move. Once there, the fleet panel offers "Found colony at ...", and the colony is founded at the end of that turn.
- **Hand-placed workers under a governor.** Raising a slider under Balanced, Growth, Industry or Research places extra workers there and keeps the governor, which goes on placing everyone else, including new population. "Clear adjustments" removes them.
