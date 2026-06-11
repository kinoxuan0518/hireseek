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
	set js to "(function(){var iframes=document.querySelectorAll('iframe');var r='';for(var i=0;i<iframes.length;i++){r+=i+':'+iframes[i].src.substring(0,80)+'|len='+iframes[i].contentDocument.body.innerText.length+'\\n';}return r;})()"
	set r to execute tab_ javascript js
	return r
end tell