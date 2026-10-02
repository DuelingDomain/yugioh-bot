if not aux.MPKey then return end
function s.check(e,tp,eg,ep,ev,re,r,rp)
	local gs={}
	for tc in aux.Next(eg) do
		if tc:IsFaceup() and tc:IsCode(CARD_HARPIE_LADY,CARD_HARPIE_LADY_SISTERS) then
			local seat=tc:GetControler()
			gs[seat]=gs[seat] or Group.CreateGroup()
			gs[seat]:AddCard(tc)
		end
	end
	for seat=0,3 do
		if gs[seat] and #gs[seat]>0 then Duel.RaiseEvent(gs[seat],EVENT_CUSTOM+id,re,r,rp,seat,0) end
	end
end
