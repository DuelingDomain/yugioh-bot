if not aux.MPKey then return end
-- Raging Cloudian: the watcher (e2) is a global effect that is registered with Duel.RegisterEffect(e2,0). It runs with no scope: its player values
-- are real seats, and "tp" is the literal 0. The stock regop kept only a Cloudian of seat 0 in the group and raised the event for seat 0. The
-- Cloudian of every other duelist was lost, so its holder never got the Trap. This regop does the stock steps once for every seat 0..3 (as the
-- other global watchers do): it keeps the cards that seat controlled and raises the event for that seat. The Trap (s.target, s.operation) reads
-- the group with its own tp, so it already matches the right duelist. A seat with no card gives an empty filter. Two seats: the stock regop.
function s.regop(e,tp,eg,ep,ev,re,r,rp)
	for seat=0,3 do
		local tg=eg:Filter(s.cfilter,nil,e,seat)
		if #tg>0 then
			for tc in tg:Iter() do
				tc:RegisterFlagEffect(id,RESET_CHAIN,0,1)
			end
			local g=e:GetLabelObject():GetLabelObject()
			if Duel.GetCurrentChain()==0 then g:Clear() end
			g:Merge(tg)
			g:Remove(function(c) return c:GetFlagEffect(id)==0 end,nil)
			e:GetLabelObject():SetLabelObject(g)
			if Duel.GetFlagEffect(seat,id)==0 then
				Duel.RegisterFlagEffect(seat,id,RESET_CHAIN,0,1)
				Duel.RaiseEvent(eg,EVENT_CUSTOM+id,e,0,seat,seat,0)
			end
		end
	end
end
