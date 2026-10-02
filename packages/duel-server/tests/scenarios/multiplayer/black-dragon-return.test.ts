import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { BLACK_DRAGON_RETURN_SCENARIOS } from './black-dragon-return.js';
describeWithCores('live Black Dragon Ninja returns', liveNseat, () => {
  runScenarios('multiplayer/black-dragon-return', BLACK_DRAGON_RETURN_SCENARIOS);
});
