if not aux.MPForEachDuelist then return end
-- Infernoid Tierra: the four stages hit EVERY living duelist, each with its own choices (R1, Q3, Q10). An activation needs a stage that every living
-- duelist can take part in (the stock rule for two duelists). The cards of all duelists are sent together at the end of a stage, as in the stock script.
function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
	local ct=e:GetLabel()
	local con3,con5,con8,con10=nil
	if ct>=3 then
		con3=aux.MPAllDuelists(function(tp_i) return Duel.IsExistingMatchingCard(Card.IsAbleToGrave,tp_i,LOCATION_EXTRA,0,3,nil) end)
	end
	if ct>=5 then
		con5=aux.MPAllDuelists(function(tp_i) return Duel.IsPlayerCanDiscardDeck(tp_i,3) end)
	end
	if ct>=8 then
		con8=aux.MPAllDuelists(function(tp_i) return Duel.IsExistingMatchingCard(nil,tp_i,LOCATION_REMOVED,0,1,nil) end)
	end
	if ct>=10 then
		con10=aux.MPAnyDuelist(function(tp_i) return Duel.GetFieldGroupCount(tp_i,LOCATION_HAND,0)>0 end)
	end
	if chk==0 then return con3 or con5 or con8 or con10 end
	if con5 then Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,PLAYER_ALL,3) end
end
function s.op(e,tp,eg,ep,ev,re,r,rp)
	local ct=e:GetLabel()
	if ct>=3 then
		local sg=Group.CreateGroup()
		aux.MPForEachDuelist(function(tp_i)
			local g=Duel.GetMatchingGroup(Card.IsAbleToGrave,tp_i,LOCATION_EXTRA,0,nil)
			if #g>=3 then
				Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
				sg:Merge(g:Select(tp_i,3,3,nil))
			else sg:Merge(g) end
		end)
		if #sg>0 then
			Duel.SendtoGrave(sg,REASON_EFFECT)
		end
	end
	if ct>=5 then
		Duel.BreakEffect()
		aux.MPForEachDuelist(function(tp_i) Duel.DiscardDeck(tp_i,3,REASON_EFFECT) end)
	end
	if ct>=8 then
		Duel.BreakEffect()
		local sg=Group.CreateGroup()
		aux.MPForEachDuelist(function(tp_i)
			Duel.Hint(HINT_SELECTMSG,tp_i,HINTMSG_TOGRAVE)
			sg:Merge(Duel.SelectMatchingCard(tp_i,nil,tp_i,LOCATION_REMOVED,0,1,3,nil))
		end)
		if #sg>0 then
			Duel.SendtoGrave(sg,REASON_EFFECT|REASON_RETURN)
		end
	end
	if ct>=10 then
		Duel.BreakEffect()
		local sg=Group.CreateGroup()
		aux.MPForEachDuelist(function(tp_i) sg:Merge(Duel.GetFieldGroup(tp_i,LOCATION_HAND,0)) end)
		Duel.SendtoGrave(sg,REASON_EFFECT)
	end
end
