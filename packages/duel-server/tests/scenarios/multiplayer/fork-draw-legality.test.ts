import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { FORK_DRAW_LEGALITY_SCENARIOS } from './fork-draw-legality.js';
describeWithCores('live Fork draw legality', liveNseat, () => runScenarios('multiplayer/fork-draw-legality', FORK_DRAW_LEGALITY_SCENARIOS));
