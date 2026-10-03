import { it } from 'vitest';
import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runLpPairScenario } from './player-all-lp-pairs.js';
import { LOCAL_CONTROLLER_SUMMON_SCENARIOS } from './local-controller-summons.js';
describeWithCores('live controller and owner summon fields',liveNseat,()=>{
 for(const scenario of LOCAL_CONTROLLER_SUMMON_SCENARIOS)it(scenario.id,()=>runLpPairScenario(scenario));
});
