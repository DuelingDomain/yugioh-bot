import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { OWNER_ACTION_SCENARIOS } from './owner-actions.js';

describeWithCores('live owner actions', liveNseat, () => {
  runScenarios('multiplayer/owner-actions', OWNER_ACTION_SCENARIOS);
});
