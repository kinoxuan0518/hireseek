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
	
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var cardItem=doc.querySelectorAll('.card-item').length;var ul=doc.querySelector('ul.recommend-card-list');var ulCards=ul?ul.querySelectorAll('li').length:0;var allLis=doc.querySelectorAll('li').length;return 'cardItem='+cardItem+'|ul_li='+ulCards+'|all_li='+allLis;})()"
	set r to execute tab_ javascript js
	return r
end tell