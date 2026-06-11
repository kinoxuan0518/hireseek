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
	
	set js1 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/debug_yankejing_chat.js")
	set r1 to execute tab_ javascript js1
	delay 2
	
	set js2 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/deep_chat_scan.js")
	set r2 to execute tab_ javascript js2
	
	return r1 & " | " & r2
end tell