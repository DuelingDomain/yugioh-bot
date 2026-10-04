#include "scripted-duel.h"
#include "card.h"
#include "effect.h"
#include "interpreter.h"
#include "fold.h"

// Real prompts from each selection API. The test card uses only the public Lua APIs.
int action_apis() {
 constexpr uint32_t code=910555;
 for(int mode=0;mode<4;++mode) {
  const int n=mode==0?2:mode==1?3:4;
  const int actor=n-1;
  sd::types[code]=TYPE_MONSTER|TYPE_EFFECT;
  sd::scripts[code]="local s,id=GetID() function s.initial_effect(c) local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_IGNITION) e:SetRange(LOCATION_MZONE) e:SetOperation(function(e,tp) "
   "local actor=Duel.MPActionSeat("+std::to_string(actor)+") local dest=Duel.MPActionSeat(0) "
   "local g=Duel.SelectMatchingCard(actor,aux.TRUE,tp,LOCATION_MZONE,0,1,1,nil) "
   "local pick=g:Select(actor,1,1,nil) Duel.ConfirmCards(actor,pick) "
   "local c=Duel.GetFieldGroup(tp,LOCATION_GRAVE,0):GetFirst() local lock=Effect.GlobalEffect() lock:SetType(EFFECT_TYPE_FIELD) lock:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON) lock:SetProperty(EFFECT_FLAG_PLAYER_TARGET) lock:SetTargetRange(1,0) "
   "lock:SetTarget(function(e,c,sump,sumtype,sumpos,targetp) Debug.Message('CHK actor='..sump..' dest='..targetp) assert(sump=="+std::to_string(actor)+" and targetp==0) return true end) "
   "Duel.RegisterEffect(lock,"+std::to_string(actor)+") assert(not c:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP,dest)) lock:Reset() "
   "assert(c:IsCanBeSpecialSummoned(e,0,actor,false,false,POS_FACEUP,dest)) Debug.Message('CHK DONE') end) c:RegisterEffect(e) end";
  auto d=sd::create(mode==0?"":mode==1?"Debug.SetupDuelists(3,0,1,2)":mode==2?"Debug.SetupDuelists(4,0,1,2,3)":"Debug.SetupDuelists(4,0,1,0,1)");
  int observed=0;bool done=false;sd::on_line=[&](const std::string& s){if(s=="CHK DONE")done=true;else if(s=="CHK actor="+std::to_string(actor)+" dest=0")observed++;else EXPECT(false,"unexpected action callback %s",s.c_str());};
  for(int seat=0;seat<n;seat++){sd::lua(d,"Debug.SetPlayerInfo("+std::to_string(seat)+",8000,0,1)");for(int i=0;i<20;i++)sd::add(d,seat,5000,LOCATION_DECK);}
  sd::add(d,actor,code,LOCATION_MZONE,POS_FACEUP_ATTACK);
  sd::add(d,actor,5001,LOCATION_GRAVE,POS_FACEUP_ATTACK);
  bool activated=false;int selections=0,confirms=0;OCG_StartDuel(d);std::vector<sd::Msg> msgs;const sd::Msg* prompt=nullptr;
  for(int i=0;i<2000;i++) {
   auto status=sd::step(d,msgs,prompt);
   if(sd::stray_logs) break;
   for(const auto& m:msgs) if(m.id==MSG_CONFIRM_CARDS) {EXPECT(m.p[0]==actor,"ConfirmCards mode %d viewer=%d expected=%d",mode,m.p[0],actor);confirms++;}
   if(status==OCG_DUEL_STATUS_END)break;
   if(status!=OCG_DUEL_STATUS_AWAITING||!prompt)continue;
   auto& m=*prompt;
   if(m.id==MSG_SELECT_IDLECMD){if(done)break;if(m.p[0]==actor&&!activated){sd::answer32(d,5);activated=true;}else sd::answer32(d,7);}
   else if(m.id==MSG_SELECT_CHAIN)sd::answer32(d,-1);
   else if(m.id==MSG_SELECT_CARD){EXPECT(m.p[0]==actor,"selection mode %d actor=%d expected=%d",mode,m.p[0],actor);selections++;uint32_t answer[]={0,1,0};OCG_DuelSetResponse(d,answer,sizeof(answer));}
   else if(m.id==MSG_SELECT_YESNO||m.id==MSG_SELECT_EFFECTYN)sd::answer32(d,0);
   else {EXPECT(false,"unexpected API prompt %d",m.id);break;}
  }
  EXPECT(done&&observed>0&&selections==2&&confirms==1,"action APIs mode %d done=%d observed=%d selections=%d confirms=%d",mode,done,observed,selections,confirms);
  OCG_DestroyDuel(d);
 }
 EXPECT(sd::stray_logs==0,"action API Lua errors %d",sd::stray_logs);
 sd::on_line=nullptr;
 return failures?1:0;
}
