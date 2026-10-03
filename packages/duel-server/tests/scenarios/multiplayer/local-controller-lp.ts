import { activate, attack, endTurn, expectBoard, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
type Format = "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;
const CARDS = [[62472614,"Pestilence"],[20765952,"Mask of Dispel"],[56948373,"Mask of the Accursed"],[83584898,"Darkworld Shackles"],[19578592,"Axe of Fools"],[81385346,"Stamping Destruction"],[13574687,"Turbo Cannon"],[52038441,"Ghost Mourner & Moonlit Chill"],[75249652,"Blazing Mirror Force"]] as const;
function probe(format: Format, actor: 0 | 1, [code,card]: typeof CARDS[number]): Scenario {
 const n=format==="ffa3"?3:4, late=format==="tag"?(actor===0?3:2):n-1, other=actor===0?1:0;
 const setup: Scenario["setup"]={format}, board: BoardExpect={}, steps: Step[]=[];
 for(let i=0;i<n;i++){const hand=format==="tag"&&i>=2?["Silver Fang"]:[];setup[seat(i)]={hand:[...hand]};board[seat(i)]={lp:format==="tag"?16000:8000,hand:[...hand],monsters:[],spells:[],grave:[],banished:[]};}
 const damage=(target:number,amount:number)=>{for(let i=0;i<n;i++)if(i===target||(format==="tag"&&i%2===target%2))board[seat(i)]!.lp!-=amount;};
 const turn=(by:number)=>{steps.push(endTurn(seat(by)));(board[seat((by+1)%n)]!.hand as string[]).push("Mystical Elf");};
 if(code===75249652){
  setup[seat(actor)]!.spells=[{card,pos:"set"}]; setup[seat(actor)]!.monsters=[{card:"Beaver Warrior",pos:"def"}];setup[seat(other)]!.monsters=["Battle Ox"];setup[seat(late)]!.monsters=["Luster Dragon"];
  if(format==="ffa4")setup.p2!.monsters=["Silver Fang"];
  if(format==="tag"){const partner=actor+2;setup[seat(partner)]!.monsters=["Silver Fang"];board[seat(partner)]!.monsters=["Silver Fang"];}
  const turns=actor===0?n+1:n;for(let j=0;j<turns;j++)turn(j%n);
  steps.push(attack("Battle Ox",{card:"Beaver Warrior",owner:seat(actor)},seat(other)),activate(card,seat(actor)));
  board[seat(actor)]!.monsters=["Beaver Warrior"];board[seat(actor)]!.grave=[card];board[seat(other)]!.grave=["Battle Ox"];// R-FFA-OPP-RESPONSE: in FFA, the battle event binds destruction and damage to the attacker.
  if(format==="tag")board[seat(late)]!.grave=["Luster Dragon"];else board[seat(late)]!.monsters=["Luster Dragon"];if(format==="ffa4")board.p2!.monsters=["Silver Fang"];
  const amount=format==="tag"?1800:850;damage(actor,amount);damage(other,amount);
 }else if(code===52038441){
  setup[seat(actor)]!.hand=[card];setup[seat(late)]!.hand=[...(setup[seat(late)]!.hand as string[]),"Monster Reborn","Dark Hole"];setup[seat(late)]!.grave=["Beaver Warrior"];setup[seat(other)]!.grave=["Celtic Guardian"];board[seat(other)]!.grave=["Celtic Guardian"];
  for(let j=0;j<late;j++)turn(j);
  // Monster Reborn reads either GY. Choose the card without an opponent declaration.
  steps.push(activate("Monster Reborn",seat(late)),select({card:"Beaver Warrior",owner:seat(late)}),activate(card,seat(actor)),activate("Dark Hole",seat(late)));
  board[seat(actor)]!.grave=[card];board[seat(late)]!.grave=["Beaver Warrior","Monster Reborn","Dark Hole"];damage(late,1200);
 }else if(code===81385346||code===13574687){
  setup[seat(actor)]!.monsters=[code===81385346?"Luster Dragon":card];board[seat(actor)]!.monsters=[code===81385346?"Luster Dragon":card];
  const target=code===81385346?"Supply Squad":"Luster Dragon",zone=code===81385346?"spells":"monsters";
  setup[seat(late)]![zone]=[target];setup[seat(other)]![zone]=[code===81385346?"Supply Squad":"Beaver Warrior"];board[seat(other)]![zone]=[code===81385346?"Supply Squad":"Beaver Warrior"];
  if(code===81385346)setup[seat(actor)]!.hand=[card];if(actor===1)turn(0);
  steps.push(activate(card,seat(actor)),select({card:target,owner:seat(late)}));board[seat(late)]!.grave=[target];if(code===81385346)board[seat(actor)]!.grave=[card];damage(late,code===81385346?500:950);
 }else{
  setup[seat(actor)]!.hand=[card];const zone=code===20765952?"spells":"monsters",target=code===20765952?"Supply Squad":"Battle Ox";
  setup[seat(late)]![zone]=[target];setup[seat(other)]![zone]=[code===20765952?"Supply Squad":"Celtic Guardian"];board[seat(late)]![zone]=[target];board[seat(other)]![zone]=[code===20765952?"Supply Squad":"Celtic Guardian"];
  if(actor===1)turn(0);steps.push(activate(card,seat(actor)),select({card:target,owner:seat(late)}));board[seat(actor)]!.spells=[card];
  for(let j=0;j<n;j++)turn((actor+j)%n);damage(late,500);
 }
 steps.push(expectBoard(board));
 return defineScenario({id:`local-controller-lp-${code}-${format}-p${actor}`,title:`${card}: the real card controller receives the stated damage`,source:SOURCE + " [R-COMMON-CTRL]" + (format === "tag" ? " [R-TAG-LP]" : "") + (format === "tag" && code === 75249652 ? " [R-TAG-PARTNER]" : ""),rules:["R-COMMON-CTRL",...(format === "tag" ? ["R-TAG-LP"] : []),...(format === "tag" && code === 75249652 ? ["R-TAG-PARTNER"] : [])],tags:["multiplayer","local-controller-lp",format,`card:${code}`],setup,steps});
}
export const LOCAL_CONTROLLER_LP_SCENARIOS=CARDS.flatMap(card=>([["ffa3",0],["ffa4",0],["tag",0],["tag",1]] as const).map(([format,actor])=>probe(format,actor,card)));
