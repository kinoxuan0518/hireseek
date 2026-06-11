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
	
	-- Click 张佳琦
	set js1 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/click_zhangjiaqi.js")
	set r1 to execute tab_ javascript js1
	delay 2
	
	-- Check chat panel content
	set js2 to "(function(){var panel=document.querySelector('.chat-view')||document.querySelector('.message-panel')||document.querySelector('.chat-container');if(!panel){return 'no_chat_panel';}return String(panel.innerText.substring(0,300));})()"
	set r2 to execute tab_ javascript js2
	
	return r1 & " | " & r2
end tell