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
	
	-- Read his message first
	set jsRead to "(function(){var msgs=document.querySelectorAll('.msg-text,.message-text,.chat-message');var r='';var all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){var t=all[i].innerText;if(t.indexOf('node.js')!=-1||t.indexOf('Java')!=-1){r+=t.substring(0,80)+'|';if(r.length>200)break;}}return String(r||'no_match');})()"
	set rRead to execute tab_ javascript jsRead
	
	-- Reply to him
	set js2 to "(function(){var input=document.querySelector('[contenteditable=true]');if(!input){return 'no_input';}input.innerHTML='Node.js 也可以的，我们的技术栈其实比较灵活。先发我一份简历看看？';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13,bubbles:true}));return 'sent';})()"
	set r2 to execute tab_ javascript js2
	
	return r1 & " read:" & rRead & " " & r2
end tell