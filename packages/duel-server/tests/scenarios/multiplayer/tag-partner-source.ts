// A partner destination must use the activating duelist's private source cards.
import {activate,defineScenario,expectNotOffered,expectPrompt,type Scenario} from "../../support/dsl.js";
import {baseSetup,everySeat,SEATS,turnsBefore,type Seat} from "./seat-kit.js";
const ELF="Mystical Elf",FILES="The Kaiju Files",DOGORAN="Dogoran, the Mad Flame Kaiju",GAMECIEL="Gameciel, the Sea Turtle Kaiju",SOUL="Common Soul",DOLPHIN="Neo-Spacian Aqua Dolphin",OX="Battle Ox";

function source(actor: "p0"|"p1", files: boolean, positive: boolean): Scenario {
 const partner:Seat=actor==="p0"?"p2":"p3",card=files?FILES:SOUL;
 const own=files?{spells:[FILES],deck:positive?(actor==="p1"?[ELF,GAMECIEL]:[GAMECIEL]):[ELF]}:{hand:positive?[SOUL,DOLPHIN]:[SOUL]};
 const other=files?{monsters:[DOGORAN],deck:positive?[ELF]:[GAMECIEL]}:{monsters:[OX],hand:positive?[]:[DOLPHIN]};
 const spec:Parameters<typeof everySeat>[1]={};for(const seat of SEATS.tag)spec[seat]={hand:seat==="p1"&&actor==="p1"?[ELF]:[]};
 spec[actor]=files?{spells:[FILES],hand:actor==="p1"?[ELF]:[]}:positive?{spells:[SOUL],hand:actor==="p1"?[ELF]:[]}:{hand:actor==="p1"?[SOUL,ELF]:[SOUL]};
 spec[partner]=files?{monsters:[positive?GAMECIEL:DOGORAN],grave:positive?[DOGORAN]:[],hand:[]}:positive?{monsters:[OX,DOLPHIN],zones:{m0:{card:OX,attack:2300}},hand:[]}:{monsters:[OX],hand:[DOLPHIN]};
 return defineScenario({id:`tag-partner-source-${files?11163040:14772491}-${actor}-${positive?"actor-has-source":"only-partner-has-source"}`,title:`Tag: ${actor} uses its own ${files?"Deck":"hand"} for its partner's field`,source:"docs/adr/0002-multiplayer-duel-rules.md Q3 and Q6",rules:["R-COMMON-SEP-FIELDS","R-TAG-PARTNER"],tags:["multiplayer","tag","partner",`card:${files?11163040:14772491}`],setup:baseSetup("tag",{[actor]:own,[partner]:other}),steps:[...turnsBefore("tag",actor),...(positive?[activate(card,actor)]:[expectNotOffered("activate",card,actor)]),expectPrompt({by:actor,context:"action"}),everySeat("tag",spec)]});
}
export const TAG_PARTNER_SOURCE_SCENARIOS:Scenario[]=["p0","p1"].flatMap(actor=>[true,false].flatMap(files=>[source(actor as "p0"|"p1",files,true),source(actor as "p0"|"p1",files,false)]));
