if not aux.MPKey then return end
function s.regop(e,tp,eg,ep,ev,re,r,rp)
	local lv={}
	for tc in aux.Next(eg) do
		if s.regfilter(tc) then
			local seat=tc:GetControler()
			local tlv=tc:GetLevel()
			if tlv>(lv[seat] or 0) then lv[seat]=tlv end
		end
	end
	local g=Group.CreateGroup()
	for seat=0,3 do
		if (lv[seat] or 0)>0 then Duel.RaiseEvent(g,EVENT_CUSTOM+id,re,r,rp,seat,lv[seat]) end
	end
end
