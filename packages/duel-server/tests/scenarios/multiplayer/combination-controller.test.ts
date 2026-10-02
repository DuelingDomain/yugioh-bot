import { describeWithCores, needs } from '../../support/cores.js';
import { liveNseat } from '../../support/live-nseat.js';
import { runScenarios } from '../../support/runner.js';
import { COMBINATION_CONTROLLER_SCENARIOS } from './combination-controller.js';
import { domainVariant } from './domain-variants.js';
describeWithCores('live combination-controller', [liveNseat,...needs.domainMulti()], () => {
  runScenarios('multiplayer/combination-controller', COMBINATION_CONTROLLER_SCENARIOS);
  runScenarios('multiplayer/combination-controller-domain', COMBINATION_CONTROLLER_SCENARIOS.map(domainVariant).map(scenario => ({
    ...scenario,steps:scenario.steps.map(step => step.op !== 'expectBoard' ? step : {
      ...step,board:Object.fromEntries(Object.entries(step.board).map(([seat,state]) => [seat,{
        ...state,deckMaster:{inZone:true,returns:0,nextCost:0},
      }])),
    }),
  })));
});
