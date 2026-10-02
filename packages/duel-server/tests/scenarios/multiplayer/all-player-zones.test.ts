import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { ALL_PLAYER_ZONES_SCENARIOS } from './all-player-zones.js';

describeWithCores('live all-player hand and field actions', liveNseat, () => {
  runScenarios('multiplayer/all-player-zones', ALL_PLAYER_ZONES_SCENARIOS);
});
