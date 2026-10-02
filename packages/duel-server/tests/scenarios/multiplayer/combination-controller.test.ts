import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { COMBINATION_CONTROLLER_SCENARIOS } from './combination-controller.js';
describeWithCores('live combination-controller', liveNseat, () => {
  runScenarios('multiplayer/combination-controller', COMBINATION_CONTROLLER_SCENARIOS);
});
