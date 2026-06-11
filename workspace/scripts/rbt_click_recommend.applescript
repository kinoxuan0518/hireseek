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
	set js to "(function(){var items=document.querySelectorAll('a');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('推荐牛人')>=0){items[i].click();return 'clicked';}}return 'not_found';})()"
	set r to execute tab_ javascript js
	return r
end tell
