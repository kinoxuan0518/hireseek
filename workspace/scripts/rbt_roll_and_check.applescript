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
	
	-- scroll first
	set js to "(function(){var iframe=document.querySelector('iframe');var doc=iframe.contentDocument||iframe.contentWindow.document;var container=doc.querySelector('.list-body')||doc.querySelector('.card-wrap')||doc.body;var h1=container.scrollHeight;container.scrollTop=h1;return String(h1);})()"
	set r to execute tab_ javascript js
	delay 2
	
	-- check cards
	set js2 to "(function(){var cards=document.querySelector('iframe').contentDocument.querySelectorAll('.card-item');var count=cards.length;var last=cards.length>0?cards[cards.length-1].innerText.substring(0,50):'none';return 'total='+count+'|last='+last.replace(/\\n/g,' ');})()"
	set r2 to execute tab_ javascript js2
	
	return r & " " & r2
end tell