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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var navItems=doc.querySelectorAll('.ui-dropmenu,.dropdown,.job-item,.job-list a');var r='';for(var i=0;i<navItems.length;i++){var t=navItems[i].innerText;if(t.length>2){r+=i+':'+t.substring(0,60)+'\\n';}}return r||'none';})()"
	set r to execute tab_ javascript js
	return r
end tell