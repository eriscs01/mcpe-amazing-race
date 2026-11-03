// Course screens (spec §4): add a landmark, generate the course, list the stops, discard it.
// Rules and texts come from core; this file shows them and turns choices into actions.
import { showMenu } from './forms.js';
import { stopList } from '../../core/generation.js';
import { COPY_WORLD_REMINDER } from '../../core/setup.js';

import type { Player } from '@minecraft/server';

import type { Menu } from '../../core/menu.js';
import type { Session } from '../../core/session.js';

type Confirm = 'yes' | 'no';

const OVERWORLD = 'minecraft:overworld';

const confirmation = (title: string, body: string, yes: string): Menu<Confirm> => ({
  title,
  body,
  buttons: [{ command: 'yes', label: yes }, { command: 'no', label: 'Cancel' }],
});

/** The course is built in the Overworld, where the walk loads and probes it. */
function inOverworld(player: Player): boolean {
  if (player.dimension.id === OVERWORLD) return true;
  player.sendMessage('Course generation works in the Overworld. Go there and try again.');
  return false;
}

export function addLandmark(session: Session, player: Player): void {
  if (!inOverworld(player)) return;
  session.dispatch({ type: 'addPin', by: player.id, pos: player.location });
}

export function clearLandmarks(session: Session, player: Player): void {
  session.dispatch({ type: 'clearPins', by: player.id });
}

export async function generateCourse(session: Session, player: Player): Promise<void> {
  if (!session.state || !inOverworld(player)) return;
  const pins = session.state.pins.length;
  const body = `${COPY_WORLD_REMINDER}\n\nYour position becomes the start line. `
    + `${pins} landmark${pins === 1 ? '' : 's'} will be visited. `
    + 'Generating takes a few minutes; stay in the Overworld.';
  const choice = await showMenu(
    player,
    confirmation('Generate course', body, 'Generate here'),
    session.log,
  );
  if (choice !== 'yes') return;
  session.dispatch({ type: 'startGeneration', by: player.id, start: player.location });
}

export function buildArenas(session: Session, player: Player): void {
  session.dispatch({ type: 'buildArenas', by: player.id });
}

export async function listStops(session: Session, player: Player): Promise<void> {
  if (!session.state) return;
  const menu = { title: 'Stops', body: stopList(session.state), buttons: [] };
  await showMenu(player, menu, session.log);
}

export async function discardCourse(session: Session, player: Player): Promise<void> {
  const body = 'The stops are removed so settings can change. Landmarks and teams are kept. '
    + 'Arenas already built stay in the world.';
  const choice = await showMenu(
    player,
    confirmation('Discard course', body, 'Discard'),
    session.log,
  );
  if (choice === 'yes') session.dispatch({ type: 'discardCourse', by: player.id });
}
