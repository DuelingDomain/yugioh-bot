import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { HYDOR_OWNER_SCENARIOS } from './hydor-owner.js';
describeWithCores('live hydor-owner', liveNseat, () => {
  runScenarios('multiplayer/hydor-owner', HYDOR_OWNER_SCENARIOS);
});
