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
	set jsFile to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/check_quota.js")
	set r to execute tab_ javascript jsFile
	delay 3
	
	set js2 to "(function(){var iframes=document.querySelectorAll('iframe');for(var i=0;i<iframes.length;i++){var txt=iframes[i].contentDocument.body.innerText;if(txt.length>200){var idx=txt.indexOf('打招呼');if(idx>=0){return txt.substring(Math.max(0,idx-80),idx+60);}return txt.substring(0,400);}}return 'no_data';})()"
	set r2 to execute tab_ javascript js2
	
	return r & " | " & r2
end tell