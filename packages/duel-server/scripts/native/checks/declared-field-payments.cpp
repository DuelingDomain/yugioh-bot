// C3: keep both-field reads broad and save an opponent-only payment across Lua yield.
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"
#include "interpreter.h"
static constexpr uint32_t spell=91981, monster=91982, material=91983, spare=91984, extra=91985;
static uint32_t u32(const uint8_t* p) { uint32_t v; std::memcpy(&v,p,4); return v; }
static std::string script(const std::string& mode) {
 return R"LUA(local s,id=GetID()
local mode=")LUA"+mode+R"LUA("
function s.initial_effect(c)
 local e=Effect.CreateEffect(c)
 e:SetType(EFFECT_TYPE_ACTIVATE) e:SetCode(EVENT_FREE_CHAIN)
 e:SetCost(s.cost) e:SetOperation(function(e,tp) if mode=="one-mixed" then Debug.Message("CHK materials "..Duel.GetFieldGroupCount(tp,LOCATION_STZONE,LOCATION_STZONE|LOCATION_MZONE)) elseif mode=="one-symbolic" then Debug.Message("CHK materials "..(Duel.GetFieldGroupCount(tp,LOCATION_STZONE,LOCATION_STZONE)+Duel.GetFieldGroupCount(tp,LOCATION_MMZONE,LOCATION_MMZONE)+Duel.GetFieldGroupCount(tp,LOCATION_GRAVE,LOCATION_GRAVE)+Duel.GetFieldGroupCount(tp,LOCATION_HAND,LOCATION_HAND)+Duel.GetFieldGroupCount(tp,LOCATION_DECK,LOCATION_DECK)+Duel.GetFieldGroupCount(tp,LOCATION_EXTRA,LOCATION_EXTRA))) end Debug.Message("CHK done") end)
 c:RegisterEffect(e)
end
function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
 if mode=="one-symbolic" or mode=="one-mixed" then
  if chk==0 then return Duel.GetFieldGroupCount(tp,0,LOCATION_STZONE)>0 end
  return
 end
 if mode=="both-overlay" then
  if chk==0 then return #Duel.GetOverlayGroup(tp,1,1)>1 and Duel.GetOverlayCount(tp,1,1)>1 end
  Debug.Message("CHK materials "..Duel.GetOverlayCount(tp,1,1)) return
 end
 local own=mode=="both-counter" and 1 or 0
 local amount=own==1 and 2 or 1
 if mode=="one-overlay" then
  if chk==0 then return Duel.CheckRemoveOverlayCard(tp,0,1,1,REASON_COST) end
  Duel.RemoveOverlayCard(tp,0,1,1,1,REASON_COST)
 else
  if chk==0 then return Duel.IsCanRemoveCounter(tp,own,1,1,amount,REASON_COST) end
  Duel.RemoveCounter(tp,own,1,1,amount,REASON_COST)
 end
end
)LUA";
}
static void flow(int n,bool tag,const std::string& mode) {
 sd::types[spell]=TYPE_SPELL; sd::types[monster]=TYPE_MONSTER|TYPE_NORMAL;
 sd::scripts[spell]=script(mode); sd::scripts[monster]="local s,id=GetID() function s.initial_effect(c) end";
 sd::types[material]=TYPE_MONSTER|TYPE_NORMAL; sd::types[extra]=TYPE_MONSTER|TYPE_FUSION; sd::scripts[extra]=sd::scripts[monster];
 sd::types[spare]=TYPE_SPELL|TYPE_CONTINUOUS; sd::scripts[spare]=sd::scripts[monster];
 sd::scripts[material]=sd::scripts[monster]; sd::stray_logs=0;
 bool done=false; int reads=0;
 sd::on_line=[&](const std::string& l) { if(l=="CHK done")done=true; if(l.rfind("CHK materials ",0)==0)reads=std::stoi(l.substr(14)); };
 OCG_Duel d=sd::create(n==2?"":n==3?"Debug.SetupDuelists(3,0,1,2)":tag?"Debug.SetupDuelists(4,0,1,0,1)":"Debug.SetupDuelists(4,0,1,2,3)");
 auto& f=sd::F(d); auto* pd=static_cast<duel*>(d); int before[4]={}, overlays[4]={};
 for(int p=0;p<n;++p) {
  for(int i=0;i<30;++i)sd::add(d,p,5000,LOCATION_DECK);
  if(mode=="one-symbolic") {
   sd::add(d,p,material,LOCATION_GRAVE); sd::add(d,p,extra,LOCATION_EXTRA);
   if(p>0) { sd::add(d,p,spare,LOCATION_SZONE,POS_FACEUP_ATTACK); sd::add(d,p,material,LOCATION_HAND); }
  }
  if(mode=="one-mixed" && p>0) sd::add(d,p,spare,LOCATION_SZONE,POS_FACEUP_ATTACK);
  sd::add(d,p,monster,LOCATION_MZONE,POS_FACEUP_ATTACK); auto* c=f.player[p].list_mzone[0];
  before[p]=mode=="both-counter"?((p==1||(n>2&&p==(tag?3:2)))?(n==2?2:1):0):p;
  c->counters[1]={static_cast<uint16_t>(before[p]),0}; overlays[p]=p==0 && mode=="both-overlay"?1:p;
  for(int i=0;i<overlays[p];++i) {
   auto* m=pd->new_card(material); m->owner=p; m->current.controler=p; m->current.location=LOCATION_OVERLAY;
   m->overlay_target=c; c->xyz_materials.push_back(m);
  }
 }
 sd::add(d,0,spell,LOCATION_HAND); OCG_StartDuel(d);
 std::vector<sd::Msg> msgs; const sd::Msg* prompt=nullptr; bool activated=false; int picks=0;
 for(int i=0;i<400;++i) {
  int status=sd::step(d,msgs,prompt); if(status!=OCG_DUEL_STATUS_AWAITING)continue; if(!prompt)break;
  const auto* p=prompt->p;
  switch(prompt->id) {
  case MSG_SELECT_IDLECMD: if(activated){if(!done)++failures;i=400;break;} activated=true;sd::answer32(d,5);break;
  case MSG_SELECT_OPTION: ++picks;EXPECT(n>2&&!tag&&mode.rfind("one-",0)==0,"%s n%d: unexpected opponent pick",mode.c_str(),n);sd::answer32(d,0);break;
  case MSG_SELECT_CHAIN: sd::answer32(d,-1);break;
  case MSG_SELECT_PLACE: {const uint8_t a[]={0,LOCATION_SZONE,0};OCG_DuelSetResponse(d,a,sizeof(a));break;}
  case MSG_SELECT_COUNTER: {
   uint32_t count=u32(p+5); int wanted=p[3]|(p[4]<<8); std::vector<int16_t> amounts(count,0);
   for(uint32_t j=0;j<count;++j) {
    uint8_t seat=p[9+9*j+4];
    EXPECT(mode!="one-counter"||n==2||tag||seat==1,"one-counter n%d: offered seat %d after pick 1",n,seat);
    int available=p[9+9*j+7]|(p[9+9*j+8]<<8); amounts[j]=std::min(wanted,available);wanted-=amounts[j];
   }
   EXPECT(wanted==0,"%s n%d: incomplete counter payment",mode.c_str(),n);
   OCG_DuelSetResponse(d,amounts.data(),amounts.size()*2);break;
  }
  case MSG_SELECT_CARD: {
   uint32_t count=u32(p+10);
   for(uint32_t j=0;j<count;++j) { uint8_t seat=p[14+j*14+4]; EXPECT(n==2||tag||seat==1,"one-overlay n%d: offered seat %d after pick 1",n,seat); }
   uint32_t answer[]={0,1,0};OCG_DuelSetResponse(d,answer,sizeof(answer));break;
  }
  default: EXPECT(false,"%s n%d: unexpected prompt %u",mode.c_str(),n,prompt->id);done=true;
  }
 }
 EXPECT(done,"%s n%d: operation did not finish",mode.c_str(),n);
 EXPECT(picks==(n>2&&!tag&&mode.rfind("one-",0)==0?1:0),"%s n%d: wrong pick count %d",mode.c_str(),n,picks);
 if(mode=="one-symbolic") { int expected=3*n; for(int p=0;p<n;++p) if(!tag||p!=2) expected+=f.player[p].list_hand.size()+f.player[p].list_main.size()+f.player[p].list_extra.size(); EXPECT(reads==expected,"one-symbolic n%d: all shared-location count %d expected %d",n,reads,expected); }
 if(mode=="one-mixed") EXPECT(reads==n+(tag?2:1),"one-mixed n%d: shared spell/declared monster count %d expected %d",n,reads,n+(tag?2:1));
 if(mode=="both-overlay"){int total=0;for(int p=0;p<n;++p)total+=overlays[p];EXPECT(reads==total,"both-overlay n%d: read %d expected %d",n,reads,total);}
 for(int p=0;p<n;++p) {
  int ctr=mode=="both-counter"?0:mode=="one-counter"&&p==1?before[p]-1:before[p];
  int ov=mode=="one-overlay"&&p==1?overlays[p]-1:overlays[p];auto* c=f.player[p].list_mzone[0];
  EXPECT(c&&c->get_counter(1)==ctr,"%s n%d seat%d: counter count",mode.c_str(),n,p);
  EXPECT(c&&int(c->xyz_materials.size())==ov,"%s n%d seat%d: material count",mode.c_str(),n,p);
  EXPECT(sd::mzone_count(d,p)==1&&sd::szone_count(d,p)==((mode=="one-symbolic"||mode=="one-mixed")&&p>0?1:0),"%s n%d seat%d: field count",mode.c_str(),n,p);
  EXPECT(f.lp_ref(p)==8000,"%s n%d seat%d: LP",mode.c_str(),n,p);
  EXPECT(f.player[p].list_remove.empty(),"%s n%d seat%d: banished",mode.c_str(),n,p);
 }
 EXPECT(sd::stray_logs==0,"%s n%d: Lua errors %d",mode.c_str(),n,sd::stray_logs);
 sd::on_line=nullptr;OCG_DestroyDuel(d);
}
int main(){
 for(auto mode:{"both-counter","one-counter","both-overlay","one-overlay","one-symbolic","one-mixed"}){flow(2,false,mode);flow(3,false,mode);flow(4,false,mode);flow(4,true,mode);}
 std::printf("%s declared-field-payments: %d failures\n",failures?"FAIL":"PASS",failures);return failures?1:0;
}
