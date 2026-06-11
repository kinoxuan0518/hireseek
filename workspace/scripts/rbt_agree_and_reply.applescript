on run argv
	set targetName to item 1 of argv
	
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
		
		-- Click candidate
		set js1 to "(function(){var items=document.querySelectorAll('.geek-item');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('" & targetName & "')!=-1){items[i].click();return 'clicked';}}return 'not_found';})()"
		set r1 to execute tab_ javascript js1
		delay 2
		
		-- Try to agree
		set js2 to "(function(){var items=document.querySelectorAll('span,button,div');for(var i=0;i<items.length;i++){var t=items[i].innerText;if(t.indexOf('同意')!=-1&&items[i].offsetHeight>0&&t.length<5){items[i].click();return 'agreed';}}return 'no_agree';})()"
		set r2 to execute tab_ javascript js2
		
		return r1 & " " & r2
	end tell
end run