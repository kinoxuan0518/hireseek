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
	set js to "(function(){var iframe=document.querySelector('iframe');if(!iframe){return 'no_iframe';}var doc=iframe.contentDocument||iframe.contentWindow.document;var tabs=doc.querySelectorAll('.tab-item');var r='';for(var i=0;i<tabs.length;i++){r+=i+':'+tabs[i].innerText.trim()+'|curr='+tabs[i].classList.contains('curr')+'||';}r+='---\\n';var filter=doc.querySelector('.filter-wrap');if(filter){r+='filter_exists';}else{r+='filter_not_found';}return r;})()"
	set r to execute tab_ javascript js
	return r
end tell
