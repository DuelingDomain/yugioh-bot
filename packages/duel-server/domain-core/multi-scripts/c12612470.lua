
-- R-FFA-THREE-COLUMNS: choose the column opponent before cards or zones.
if aux.MPColumnEffects then
	s.initial_effect=aux.MPColumnEffects(s.initial_effect,{s.posop})
end
