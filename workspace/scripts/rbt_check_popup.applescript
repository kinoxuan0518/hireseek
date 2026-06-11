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
	
	-- Check main page for popup
	set js to "(function(){var btns=document.querySelectorAll('button,div,span');var r='';for(var i=0;i<btns.length;i++){var t=btns[i].innerText;if(t.indexOf('发送')>=0||t.indexOf('立即沟通')>=0||t.indexOf('打招呼')>=0){if(btns[i].offsetHeight>0){r+=i+':'+t.substring(0,20)+' ';}}}return r||'no_visible_btn';})()"
	set r to execute tab_ javascript js
	return r
end tell