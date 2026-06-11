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
	
	set targetName to "闫可菁"
	
	set js1 to "(function(){var items=document.querySelectorAll('.geek-item');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('" & targetName & "')!=-1){items[i].click();return 'clicked';}}return 'not_found';})()"
	set r1 to execute tab_ javascript js1
	delay 2
	
	set js2 to "(function(){var panel=document.querySelector('.base-info-single-container');if(!panel){return 'no_panel';}return String(panel.innerText.substring(0,500));})()"
	set r2 to execute tab_ javascript js2
	
	return r1 & " | panel: " & r2
end tell