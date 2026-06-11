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
	set js1 to (do shell script "cat /Users/blacklake/hireclaw/workspace/scripts/click_lixiansheng.js")
	set r1 to execute tab_ javascript js1
	delay 2
	set js2 to "(function(){var input=document.querySelector('[contenteditable=true]');if(!input){return 'no_input';}input.innerHTML='你好，方便发我一份简历吗？我们根据简历来详细聊聊';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13,bubbles:true}));return 'sent';})()"
	set r2 to execute tab_ javascript js2
	return r1 & " " & r2
end tell