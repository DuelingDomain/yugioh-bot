if not aux.MPKey then return end
-- The global summon check gets real seats. The later draw reads its own seat or team.
s.mp_clouds={}
s.mp_cloud_repeat={}
aux.AddValuesReset(function()
	s.mp_cloud_repeat={}
	for _,g in pairs(s.mp_clouds) do g:Clear() end
end)
function s.checkop(e,tp,eg,ep,ev,re,r,rp)
	for tc in aux.Next(eg) do
		if tc:IsFaceup() and tc:IsSetCard(SET_CLOUDIAN) then
			local key=aux.MPKey(tc:GetSummonPlayer())
			local g=s.mp_clouds[key]
			if not g then
				g=Group.CreateGroup()
				g:KeepAlive()
				s.mp_clouds[key]=g
			end
			if g:IsContains(tc) then s.mp_cloud_repeat[key]=true else g:AddCard(tc) end
		end
	end
end
function s.drcon(e,tp,eg,ep,ev,re,r,rp)
	local key=aux.MPKey(tp)
	local g=s.mp_clouds[key]
	return s.mp_cloud_repeat[key] or g and g:IsExists(s.filter,1,nil,g) or false
end
