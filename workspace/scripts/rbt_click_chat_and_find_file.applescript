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
	
	-- Click 闫可菁
	set js1 to "(function(){var items=document.querySelectorAll('.geek-item');for(var i=0;i<items.length;i++){if(items[i].innerText.indexOf('闫可菁')!=-1){items[i].click();return 'clicked';}}return 'not_found';})()"
	set r1 to execute tab_ javascript js1
	delay 2
	
	-- Look for file download buttons in the chat message area
	set js2 to "(function(){var btns=document.querySelectorAll('.resume-btn-file,.btn-file,[class*=file]');var r='files='+btns.length;for(var i=0;i<btns.length;i++){r+='|'+i+':'+btns[i].tagName+'|h='+btns[i].offsetHeight+'|t='+btns[i].innerText.substring(0,10);}r+='---';var f=document.querySelector('.attachment-iframe');r+='iframe='+(f?'Y':'N');return r;})()"
	set r2 to execute tab_ javascript js2
	
	return r1 & " | " & r2
end tell