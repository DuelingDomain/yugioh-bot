if not aux.MPForEachDuelist then return end
-- The activator draws 1 card (2 if its LP is 2000 or more above the LP of ANY one opponent) and every other duelist draws 1 (R1, Q3, Tag
-- partner included). The first duelist of the loop is the activator. The target needs every duelist to be able to draw.
function s.drtg(e,tp,eg,ep,ev,re,r,rp,chk)
	local ct=1
	local own=Duel.GetLP(tp)
	if aux.MPAnyOpponent(tp,function(tp_i) return own>=Duel.GetLP(tp_i)+2000 end) then ct=2 end
	if chk==0 then
		local first=true
		return aux.MPAllDuelists(function(tp_i)
			local n=first and ct or 1
			first=false
			return Duel.IsPlayerCanDraw(tp_i,n)
		end)
	end
	e:SetLabel(ct)
	Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,PLAYER_ALL,1)
end
function s.drop(e,tp,eg,ep,ev,re,r,rp)
	local ct=e:GetLabel()
	local first=true
	aux.MPForEachDuelist(function(tp_i)
		Duel.Draw(tp_i,first and ct or 1,REASON_EFFECT)
		first=false
	end)
end
