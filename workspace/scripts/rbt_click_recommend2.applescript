tell application "Google Chrome"
	set tab_ to null
	repeat with w from 1 to count of windows
		repeat with t from 1 to count of tabs of window w
			if URL of tab t of window w contains "zhipin.com/web/chat" then
				set tab_ to tab t of window w
				exit repeat
			end if
		end repeat
		if tab_ is not null then exit repeat
	end repeat
	set js to "(function(){var el=document.querySelector('.menu-recommend');if(!el){return 'no_menu';}var a=el.querySelector('a');if(!a){return 'no_a';}a.click();return 'clicked_'+window.location.href;})()"
	set r to execute tab_ javascript js
	return r
end tell
