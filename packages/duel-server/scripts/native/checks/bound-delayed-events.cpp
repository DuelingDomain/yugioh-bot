// C4: a delayed opponent draw response must ignore another opponent's draw.
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"
static constexpr uint32_t code=91991;
static const char* script=R"LUA(local s,id=GetID()
function s.initial_effect(c)
 local e=Effect.CreateEffect(c) e:SetType(EFFECT_TYPE_ACTIVATE) e:SetCode(EVENT_FREE_CHAIN)
 e:SetCondition(function() if Duel.MPMode()==1 then Duel.MPNeedPick() end return true end)
 e:SetOperation(s.op) c:RegisterEffect(e)
end
function s.op(e,tp)
 local d=Effect.CreateEffect(e:GetHandler())
 d:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_TRIGGER_F) d:SetCode(EVENT_DRAW)
 d:SetCondition(function(e,tp,eg,ep) return ep==1-tp end)
 d:SetOperation(function(e,tp) Duel.Damage(1-tp,300,REASON_EFFECT) end)
 Duel.RegisterEffect(d,tp)
end
)LUA";
static void flow(int n,bool tag) {
 sd::types[code]=TYPE_SPELL;sd::scripts[code]=script;sd::stray_logs=0;
 OCG_Duel d=sd::create(n==2?"":n==3?"Debug.SetupDuelists(3,0,1,2)":tag?"Debug.SetupDuelists(4,0,1,0,1)":"Debug.SetupDuelists(4,0,1,2,3)");
 auto& f=sd::F(d);
 for(int p=0;p<n;++p)for(int i=0;i<30;++i)sd::add(d,p,5000,LOCATION_DECK);
 sd::add(d,0,code,LOCATION_HAND);OCG_StartDuel(d);
 std::vector<sd::Msg> msgs;const sd::Msg* pm=nullptr;bool activated=false,finished=false;int picks=0;
 for(int i=0;i<600;++i) {
  int st=sd::step(d,msgs,pm);if(st!=OCG_DUEL_STATUS_AWAITING)continue;if(!pm)break;
  switch(pm->id) {
  case MSG_SELECT_IDLECMD:
   if(pm->p[0]==n-1 && f.infos.turn_id==uint32_t(n)){finished=true;i=600;break;}
   if(!activated){sd::answer32(d,5);activated=true;}else sd::answer32(d,7);break;
  case MSG_SELECT_OPTION:++picks;sd::answer32(d,0);break;
  case MSG_SELECT_CHAIN:sd::answer32(d,-1);break;
  case MSG_SELECT_PLACE:{const uint8_t a[]={0,LOCATION_SZONE,0};OCG_DuelSetResponse(d,a,sizeof(a));break;}
  case MSG_SELECT_YESNO:case MSG_SELECT_EFFECTYN:sd::answer32(d,1);break;
  default:EXPECT(false,"draw n%d: unexpected prompt %u",n,pm->id);i=600;
  }
 }
 EXPECT(finished,"draw n%d: did not reach final seat",n);
 EXPECT(picks==(n>2&&!tag?1:0),"draw n%d: pick count %d",n,picks);
 for(int p=0;p<n;++p) {
  int lp=tag ? (p%2?7400:8000):p==1?7700:8000;
  EXPECT(f.lp_ref(p)==lp,"draw n%d seat%d: LP %d expected %d",n,p,f.lp_ref(p),lp);
  EXPECT(sd::mzone_count(d,p)==0&&sd::szone_count(d,p)==0,"draw n%d seat%d: field",n,p);
  EXPECT(f.player[p].list_grave.size()==unsigned(p==0),"draw n%d seat%d: grave",n,p);
  EXPECT(f.player[p].list_remove.empty(),"draw n%d seat%d: banished",n,p);
 }
 EXPECT(sd::stray_logs==0,"draw n%d: Lua errors %d",n,sd::stray_logs);OCG_DestroyDuel(d);
}
int main(){flow(2,false);flow(3,false);flow(4,false);flow(4,true);std::printf("%s bound-delayed-events: %d failures\n",failures?"FAIL":"PASS",failures);return failures?1:0;}
