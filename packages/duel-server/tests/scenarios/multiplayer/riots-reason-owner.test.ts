import { it } from 'vitest';
import { describeWithCores } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runLpPairScenario } from './player-all-lp-pairs.js';
import { RIOTS_REASON_OWNER_SCENARIOS } from './riots-reason-owner.js';
describeWithCores('live riots-reason-owner',liveNseat,()=>{
 for(const scenario of RIOTS_REASON_OWNER_SCENARIOS)it(scenario.id,()=>runLpPairScenario(scenario,
   scenario.tags.includes('stolen') ? script => script.replace(/(Debug.AddCard\(\d+,)0,0,(LOCATION_MZONE)/, '$11,0,$2') : undefined));
});
