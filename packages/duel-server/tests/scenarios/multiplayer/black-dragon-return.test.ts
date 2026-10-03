import { describeWithCores, needs } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { BLACK_DRAGON_RETURN_SCENARIOS } from './black-dragon-return.js';
import { domainVariant } from './domain-variants.js';
describeWithCores('live Black Dragon Ninja returns', [liveNseat,...needs.domainMulti()], () => {
  runScenarios('multiplayer/black-dragon-return', BLACK_DRAGON_RETURN_SCENARIOS);
  runScenarios('multiplayer/black-dragon-return-domain', BLACK_DRAGON_RETURN_SCENARIOS.map(domainVariant).map(scenario => ({
    ...scenario,steps:scenario.steps.map(step => step.op !== 'expectBoard' ? step : {
      ...step,board:Object.fromEntries(Object.entries(step.board).map(([seat,state]) => [seat,{
        ...state,deckMaster:{inZone:true,returns:0,nextCost:0},
      }])),
    }),
  })));
});
