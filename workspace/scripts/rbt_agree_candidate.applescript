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
	set name to (do shell script "cat /tmp/rbt_target_name.txt")
	set js1 to "(function(){var items=document.querySelectorAll('.geek-item');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('" & name & "')!=-1){items[i].click();return 'clicked_"+name & "';}}return 'not_found_"+name & "';})()"
	set r1 to execute tab_ javascript js1
	delay 2
	
	-- Click agree
	set js2 to "(function(){var items=document.querySelectorAll('span,button,div');for(var i=0;i<items.length;i++){var t=items[i].innerText;if(t.indexOf('同意')!=-1&&items[i].offsetHeight>0&&t.length<5){items[i].click();return 'agreed';}}return 'no_agree';})()"
	set r2 to execute tab_ javascript js2
	delay 1
	
	return r1 & " " & r2
end tell