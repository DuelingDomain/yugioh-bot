if not aux.MPPick or Duel.MPMode()~=1 then return end
-- Pick the FFA LP recipient at activation, before the effect starts to resolve.
s.lptg=aux.MPPick(s.lptg)
