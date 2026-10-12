// Column review checks use the real core and Lua overlay.
#include "scripted-duel.h"
#include "interpreter.h"
#include "effect.h"
#include "card.h"

static void ffa4_unbound() {
 auto d=sd::create("Debug.SetupDuelists(4,0,1,2,3)",1,true);
 sd::lua(d,"probe_card=Debug.AddCard(1,0,0,LOCATION_MZONE,3,POS_FACEUP_ATTACK)");
 auto* lua=static_cast<duel*>(d)->lua;
 lua->push_scope(1);
 sd::lua(d,R"(
 assert(not Duel.MPBound(), 'test must start unbound')
 assert(not probe_card:IsColumn(3,1,LOCATION_MZONE), 'FFA4 unbound Lua 1 must not become the facing seat')
 Duel.MPBindSeat(0)
 assert(probe_card:IsColumn(3,1,LOCATION_MZONE), 'explicit seat must keep its own sequence')
 Duel.MPBindSeat()
 )");
 lua->pop_scope();
 sd::lua(d,"peer_card=Debug.AddCard(2,1,1,LOCATION_MZONE,3,POS_FACEUP_ATTACK)");
 lua->push_scope(0);
 sd::lua(d,"assert(not probe_card:IsColumn(1,1,LOCATION_MZONE), 'FFA4 P0 unbound Lua 1 must reject seat 0')");
 sd::lua(d,"assert(not peer_card:IsColumn(3,1,LOCATION_MZONE), 'FFA4 P0 unbound Lua 1 must reject seat 1')");
 EXPECT(!lua->current_scope()->touched,"FFA4 unbound column rejection must not touch the opponent probe");
 lua->pop_scope();
 EXPECT(sd::stray_logs==0,"FFA4 Lua assertions must pass");
 OCG_DestroyDuel(d);
}
static void fixed_facing() {
 for(int n : {3,4}) {
  auto d=sd::create(n==3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)",1,true);
  auto* lua=static_cast<duel*>(d)->lua;
  auto& f=sd::F(d);
  for(int mask=0;mask<(1<<n);++mask) {
   for(uint8_t p=0;p<n;++p) f.player[p].eliminated=(mask&(1<<p))!=0;
   for(uint8_t p=0;p<n;++p) {
    const uint8_t q=p^1;
    const uint8_t want=q<n && f.is_alive(p) && f.is_alive(q) ? q : DUELIST_NONE;
    EXPECT(f.across_of(p)==want,"EMZ and Links must keep the original living facing seat");
    EXPECT(f.column_peer_of(p)==want,"columns must match the same fixed facing seat for every elimination mask");
   }
  }
  for(uint8_t p=0;p<n;++p) f.player[p].eliminated=false;
  uint8_t bound=2;
  lua->push_scope(0,&bound);
  EXPECT(f.column_peer_of(0)==1,"a non-facing activation binding must not change columns");
  EXPECT(bound==2 && !lua->current_scope()->touched,"a physical peer read must not request or alter an opponent pick");
  lua->pop_scope();
  f.player[1].eliminated=true;
  EXPECT(f.column_peer_of(0)==DUELIST_NONE,"the surviving seat must never face seat 2");
  EXPECT(sd::stray_logs==0,"fixed facing checks must have no Lua errors");
  OCG_DestroyDuel(d);
 }
}
static void full_column() {
 auto d=sd::create("Debug.SetupDuelists(3,0,1,2)",1,true);
 sd::lua(d,R"(
 local own=Debug.AddCard(1,0,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK)
 local emz=Debug.AddCard(1,0,0,LOCATION_MZONE,5,POS_FACEUP_ATTACK)
 local source=Debug.AddCard(1,0,0,LOCATION_SZONE,1,POS_FACEUP_ATTACK)
 Debug.AddCard(1,1,1,LOCATION_MZONE,3,POS_FACEUP_ATTACK)
 Debug.AddCard(1,1,1,LOCATION_SZONE,3,POS_FACEUP_ATTACK)
 assert(source:GetColumnGroupCount()==4, 'shared full column has four other cards')
 assert(source:IsAllColumn(), 'the shared EMZ is one physical position')
 assert(emz:GetColumnZone(LOCATION_MZONE)==0x80002, 'EMZ origin excludes both mirrored EMZ bits')
 local solo=Debug.AddCard(1,2,2,LOCATION_SZONE,1,POS_FACEUP_ATTACK)
 Debug.AddCard(1,2,2,LOCATION_MZONE,1,POS_FACEUP_ATTACK)
 Debug.AddCard(1,2,2,LOCATION_MZONE,5,POS_FACEUP_ATTACK)
 assert(solo:GetColumnGroupCount()==2, 'unpaired column has only own cards')
 assert(solo:IsAllColumn(), 'unpaired full column counts only own positions')
 )");
 EXPECT(sd::stray_logs==0,"full-column Lua assertions must pass");
 OCG_DestroyDuel(d);
}
int main() {
 ffa4_unbound();
 fixed_facing();
 full_column();
 std::printf("%s: %d failure(s)\n",failures ? "FAIL" : "PASS",failures);
 return failures ? 1 : 0;
}
