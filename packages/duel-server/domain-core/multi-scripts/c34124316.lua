if not aux.MPForEachDuelist then return end
-- Both players means every living duelist, including each Tag member (R-COMMON-EACH-PLAYER). The stock operation reads the turn
-- player and "1-p" only, which leaves every other seat out. Each duelist reveals its own top 5 cards, starting with the turn player.
-- Every group is read before any card moves, as in the stock script. summon is the stock local function.
function s.operation(e,tp,eg,ep,ev,re,r,rp)
	local g=Duel.GetFieldGroup(tp,LOCATION_MZONE,LOCATION_MZONE)
	if Duel.Destroy(g,REASON_EFFECT)==0 then return end
	Duel.BreakEffect()
	local duelists={}
	local tohand_all=Group.CreateGroup()
	aux.MPForEachDuelistFromTurn(function(p)
		local summonable,nonsummonable=Duel.GetDecktopGroup(p,5):Split(s.spchk,nil,e,p)
		local ft=Duel.GetLocationCount(p,LOCATION_MZONE)
		if ft>1 and Duel.IsPlayerAffectedByEffect(p,CARD_BLUEEYES_SPIRIT) and #summonable>1 then
			nonsummonable:Merge(summonable)
			summonable:Clear()
		end
		tohand_all:Merge(nonsummonable)
		duelists[#duelists+1]=summonable
	end)
	local tohand,tograve=tohand_all:Split(Card.IsAbleToHand,nil)
	Duel.DisableShuffleCheck()
	local index=0
	aux.MPForEachDuelistFromTurn(function(p)
		index=index+1
		Duel.ConfirmDecktop(p,5)
		-- A Tag team has one field: count the free zones when its member summons, after the partner
		summon(duelists[index],e,p,tograve,Duel.GetLocationCount(p,LOCATION_MZONE))
	end)
	Duel.SpecialSummonComplete()
	if #tohand>0 then
		Duel.SendtoHand(tohand,nil,REASON_EFFECT)
		aux.MPForEachDuelist(function(p) Duel.ShuffleHand(p) end)
	end
	if #tograve>0 then
		Duel.SendtoGrave(tograve,REASON_EFFECT)
	end
	local fg=Duel.GetMatchingGroup(Card.IsFacedown,tp,LOCATION_MZONE,LOCATION_MZONE,nil)
	Duel.ShuffleSetCard(fg)
end
