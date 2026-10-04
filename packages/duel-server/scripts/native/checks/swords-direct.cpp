// Native controls for Swords FFA per-seat protection. Run each mode separately.
#include "scripted-duel.h"
#include "card.h"
#include "effect.h"
constexpr uint32_t PROTECTED = 0x7F000101;
constexpr uint32_t SWORDS = 72302403;
static OCG_Duel fixture(int n) {
 sd::stray_logs=0; sd::types[SWORDS]=TYPE_SPELL;
 auto d=sd::create(n==3 ? "Debug.SetupDuelists(3,0,1,2)" : "Debug.SetupDuelists(4,0,1,2,3)",1,true);
 sd::add(d,0,5000,LOCATION_MZONE,POS_FACEUP_ATTACK);
 sd::add(d,1,SWORDS,LOCATION_SZONE,POS_FACEUP);
 auto& f=sd::F(d);
 for(int q=0;q<n;++q) f.player[q].lp=8000;
 f.infos.turn_player=0; f.infos.phase=PHASE_MAIN1;
 f.player[0].list_mzone[0]->enable_field_effect(true);
 f.player[1].list_szone[0]->enable_field_effect(true);
 f.core.attacker=f.player[0].list_mzone[0]; f.core.battle_defender=1;
 EXPECT(f.is_player_affected_by_effect(1,PROTECTED),"Swords registers controller protection");
 return d;
}
static void target_mask(field& f) {
 card_vector targets; f.get_attack_target(f.core.attacker,&targets);
 EXPECT(!(f.core.attacker->direct_attack_mask&2),"protected seat is absent from direct mask");
 EXPECT(f.core.attacker->direct_attack_mask&4,"p2 remains directly attackable");
}
static void state(field& f,int n) {
 for(int q=0;q<n;++q) EXPECT(f.player[q].lp==8000,"seat %d LP remains 8000",q);
 EXPECT(f.player[1].list_szone[0] && f.player[1].list_szone[0]->data.code==SWORDS,"p1 retains Swords");
 EXPECT(sd::stray_logs==0,"no Lua errors: %d",sd::stray_logs);
}
int main(int argc,char**argv) {
 const std::string mode=argc>1?argv[1]:"mask";
 for(int n:{3,4}) {
  auto d=fixture(n);auto& f=sd::F(d);
  if(mode=="mask") target_mask(f);
  else if(mode=="only-open") {
   for(int q=2;q<n;++q) {sd::add(d,q,5000,LOCATION_MZONE,POS_FACEUP_DEFENSE);f.player[q].list_mzone[0]->enable_field_effect(true);}
   card_vector targets;f.get_attack_target(f.core.attacker,&targets);
   EXPECT(!f.core.attacker->direct_attackable && !f.core.attacker->direct_attack_mask,"only protected open seat: no direct attack");
  } else if(mode=="forced") {
   f.core.forced_attacker=f.core.attacker; f.core.forced_attack_target=nullptr;
   Processors::ForcedBattle arg{0};f.process(arg);
   EXPECT(f.core.battle_defender==2,"forced direct attack skips p1 and chooses p2, got %u",f.core.battle_defender);
   EXPECT(!(f.core.attacker->direct_attack_mask&2),"forced path uses protected mask");
  } else if(mode=="replay") {
   sd::add(d,1,5000,LOCATION_MZONE,POS_FACEUP_DEFENSE);auto* monster=f.player[1].list_mzone[0];monster->enable_field_effect(true);
   target_mask(f);
   f.remove_card(monster);f.add_card(1,monster,LOCATION_GRAVE,0);
   f.core.attack_target=nullptr;f.core.battle_defender=1;
   EXPECT(!f.confirm_attack_target(),"replay cannot confirm direct attack at protected p1");
   f.core.battle_defender=2;EXPECT(f.confirm_attack_target(),"replay can confirm p2");
  } else if(mode=="redirect") {
   sd::add(d,1,5000,LOCATION_MZONE,POS_FACEUP_DEFENSE);
   auto* old_target=f.player[1].list_mzone[0]; old_target->enable_field_effect(true);
   f.core.attack_target=old_target;
   sd::lua(d,"assert(not Duel.ChangeAttackTarget(nil)); assert(not Duel.ChangeAttackTarget(nil,true)); assert(Duel.MPAttackedSeat()==1)");
   EXPECT(f.core.battle_defender==1 && f.core.attack_target==old_target && !f.core.attack_player,"protected live defender: refuse both redirects and retain attack state");
   f.core.battle_defender=2;
   sd::add(d,2,5000,LOCATION_MZONE,POS_FACEUP_DEFENSE);f.player[2].list_mzone[0]->enable_field_effect(true);
   f.core.attack_target=f.player[2].list_mzone[0]; f.core.attack_player=false;
   card_vector v;f.get_attack_target(f.core.attacker,&v);
   EXPECT(!(f.core.attacker->direct_attack_mask&4),"p2 has a monster: ordinary direct mask is clear");
   sd::lua(d,"assert(Duel.ChangeAttackTarget(nil)); assert(Duel.MPAttackedSeat()==2)");
   EXPECT(f.core.battle_defender==2 && !f.core.attack_target && f.core.attack_player,"stock redirect keeps live p2 although it controls monsters");
   f.core.battle_defender=1;f.player[1].eliminated=true; f.core.attack_player=false;
   sd::lua(d,"assert(Duel.ChangeAttackTarget(nil)); assert(Duel.MPAttackedSeat()==2)");
   EXPECT(f.core.battle_defender==2,"eliminated defender falls back to first unprotected living opponent");
   sd::lua(d,"local e=Effect.GlobalEffect();e:SetType(EFFECT_TYPE_FIELD);e:SetCode(0x7F000101);e:SetProperty(EFFECT_FLAG_PLAYER_TARGET);e:SetTargetRange(1,0);Duel.RegisterEffect(e,2)");
   f.core.battle_defender=1;
   if(n==3) {
    sd::lua(d,"assert(not Duel.ChangeAttackTarget(nil)); assert(not Duel.ChangeAttackTarget(nil,true))");
    EXPECT(f.core.battle_defender==1,"no legal fallback: refuse without changing defender");
   } else {
    sd::lua(d,"assert(Duel.ChangeAttackTarget(nil)); assert(Duel.MPAttackedSeat()==3)");
    EXPECT(f.core.battle_defender==3,"eliminated defender fallback skips protected p2");
   }
   f.player[1].eliminated=false;
  } else if(mode=="leaves") {
   target_mask(f);auto* source=f.player[1].list_szone[0];source->enable_field_effect(false);f.remove_card(source);f.add_card(1,source,LOCATION_GRAVE,0);
   card_vector targets;f.get_attack_target(f.core.attacker,&targets);
   EXPECT(f.core.attacker->direct_attack_mask&2,"Swords leaves: p1 is open");
   EXPECT(!f.is_player_affected_by_effect(1,PROTECTED),"range removes protection");
   for(int q=0;q<n;++q) EXPECT(f.player[q].lp==8000,"seat %d LP stays 8000",q);
   EXPECT(f.player[1].list_grave.back()==source,"Swords is in p1 GY");
  } else {std::printf("Unknown mode\n");return 2;}
  if(mode!="leaves") state(f,n);
  OCG_DestroyDuel(d);
 }
 // The fork-private effect has no meaning in the stock paths.
 for(const auto& setup:{std::string{},std::string{"Debug.SetupDuelists(4,0,1,0,1)"}}) {
  auto d=sd::create(setup);auto& f=sd::F(d);sd::add(d,0,5000,LOCATION_MZONE,POS_FACEUP_ATTACK);auto* a=f.player[0].list_mzone[0];a->enable_field_effect(true);
  sd::lua(d,"local e=Effect.GlobalEffect();e:SetType(EFFECT_TYPE_FIELD);e:SetCode(0x7F000101);e:SetProperty(EFFECT_FLAG_PLAYER_TARGET);e:SetTargetRange(1,0);Duel.RegisterEffect(e,1)");
  card_vector v;f.get_attack_target(a,&v);EXPECT(a->direct_attackable,"stock layout ignores private effect");OCG_DestroyDuel(d);
 }
 std::printf("RESULT swords-%s %s: %d failure(s)\n",mode.c_str(),failures?"FAIL":"PASS",failures);
 return failures?1:0;
}
