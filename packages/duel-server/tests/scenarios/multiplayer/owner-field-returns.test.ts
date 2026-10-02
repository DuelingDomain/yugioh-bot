import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { OWNER_FIELD_RETURN_SCENARIOS } from './owner-field-returns.js';

describeWithCores('live owner field returns', liveNseat, () => {
  runScenarios('multiplayer/owner-field-returns', OWNER_FIELD_RETURN_SCENARIOS);
});
