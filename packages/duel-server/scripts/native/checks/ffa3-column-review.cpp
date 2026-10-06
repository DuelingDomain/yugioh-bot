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
 EXPECT(sd::stray_logs==0,"FFA4 Lua assertions must pass");
 OCG_DestroyDuel(d);
}
static void ffa3_bound_and_losing() {
 auto d=sd::create("Debug.SetupDuelists(3,0,1,2)",1,true);
 auto* engine=static_cast<duel*>(d);
 auto* lua=engine->lua;
 auto& f=sd::F(d);
 sd::lua(d,"source=Debug.AddCard(1,0,0,LOCATION_MZONE,1,POS_FACEUP_ATTACK); survivor=Debug.AddCard(2,2,2,LOCATION_MZONE,3,POS_FACEUP_ATTACK)");
 effect first(engine),second(engine);
 first.type=second.type=EFFECT_TYPE_ACTIVATE|EFFECT_TYPE_ACTIONS;
 first.column_peer=second.column_peer=true;
 uint8_t bound=1, response=2;
 lua->push_scope(0,&bound,false,false,&first);
 EXPECT(f.column_peer_of(0)==1,"first link must read peer 1");
 EXPECT(lua->current_scope()->touched && bound==1,"column reads must mark the probe without changing its binding");
 lua->push_scope(0,&response,false,false,&second);
 EXPECT(f.column_peer_of(0)==2,"nested response must read peer 2");
 lua->pop_scope();
 EXPECT(f.column_peer_of(0)==1,"return to first link must restore peer 1");
 f.player[1].eliminated=true;
 EXPECT(lua->scope_bound_opp()==1,"ordinary reads must retain departed peer");
 EXPECT(f.column_peer_of(0)==1,"column reads must retain departed peer");
 sd::lua(d,"Duel.MPWindow(0); assert(Duel.GetFieldGroupCount(0,0,LOCATION_MZONE)==0,'ordinary read must see the departed peer empty'); assert(source:GetColumnGroupCount()==0,'departed peer must not expose survivor cards'); Duel.MPWindowEnd()");
 lua->pop_scope();
 EXPECT(f.column_peer_of(0)==2,"outside the link the survivor becomes the peer");
 f.player[1].eliminated=false;
 f.player[1].pending_loss=true;
 uint8_t choices[MAX_DUELISTS];
 EXPECT(f.pick_opponents(0,choices)==1 && choices[0]==2,"pick must exclude the pending loser");
 EXPECT(f.column_peer_of(0)==2,"unbound column must use the same eligible survivor as the pick");
 // A pending loss must not redirect an already bound operation either.
 lua->push_scope(0,&bound,false,false,&first);
 EXPECT(f.column_peer_of(0)==1,"pending loss must preserve the bound peer");
 lua->pop_scope();
 EXPECT(sd::stray_logs==0,"FFA3 Lua assertions must pass");
 OCG_DestroyDuel(d);
}
int main() {
 ffa4_unbound();
 ffa3_bound_and_losing();
 std::printf("%s: %d failure(s)\n",failures ? "FAIL" : "PASS",failures);
 return failures ? 1 : 0;
}
