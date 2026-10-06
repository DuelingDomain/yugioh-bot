// Column review checks use the real core and Lua overlay.
#include "scripted-duel.h"
#include "interpreter.h"

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
int main() {
 ffa4_unbound();
 std::printf("%s: %d failure(s)\n",failures ? "FAIL" : "PASS",failures);
 return failures ? 1 : 0;
}
