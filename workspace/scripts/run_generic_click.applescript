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
	set jsFile to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/click_aymane.js")
	set r1 to execute tab_ javascript jsFile
	delay 2
	set js2 to "(function(){var items=document.querySelectorAll('span,button,div');for(var i=0;i<items.length;i++){var t=items[i].innerText;if(t.indexOf('同意')!=-1&&items[i].offsetHeight>0&&t.length<5){items[i].click();return 'agreed';}}return 'no_agree';})()"
	set r2 to execute tab_ javascript js2
	return r1 & " " & r2
end tell